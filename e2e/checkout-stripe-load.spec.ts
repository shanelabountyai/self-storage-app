import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'

// B-410 (3). What B-392's T2 was never taken over for, and what B-411 and
// B-412 each left to this row: the card form when Stripe.js never arrives, and
// where focus goes after "Check again". Both only render with a Stripe key, so
// no unit test and no route loop reaches them.
//
// **Self-skips without a TEST key, naming it** (B-120's second discipline).
// `payment-element.tsx` only calls `loadStripe` when the publishable key is
// set and `preparePayment` only builds an intent when the secret one is; no CI
// lane carries either today, and D-63 refuses a live key outside production —
// hence the prefix check rather than a bare "is it set".
const KEYS_PRESENT =
  !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_') &&
  !!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')

test('a card form that cannot load Stripe.js says so, and "Check again" keeps focus', async ({
  page,
}, testInfo) => {
  test.skip(
    !KEYS_PRESENT,
    'needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_test_) and STRIPE_SECRET_KEY (sk_test_) in this lane; see B-410',
  )
  // One project: the walk holds a sandbox unit, and nothing asserted here
  // depends on the viewport.
  test.skip(testInfo.project.name !== 'desktop-chrome', 'focus order is not viewport-dependent')
  // The two waits below are the product's own: ten seconds for Stripe.js, then
  // fifteen two-second polls before "Check again" is offered.
  test.setTimeout(120_000)

  await page.route('**/js.stripe.com/**', (route) => route.abort())

  const email = `e2e-stripe-load-${Date.now()}@demo.example.com`
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protection' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('checkbox', { name: /sign this agreement electronically/ }).check()
  await page.getByLabel('Type your full name to sign').fill('Ada Renter')
  await page.getByRole('button', { name: 'Sign and continue' }).click()

  const card = page.locator('section[aria-labelledby="pay-heading"]')
  const status = card.getByRole('status')

  // Pay pressed before Stripe.js has loaded: told, not ignored.
  await card.getByRole('button', { name: 'Pay and complete move-in' }).click()
  await expect(status).toContainText('The card form is still loading')

  // B-412. After the wait the message replaces the form, in the region that was
  // already mounted, and takes focus.
  await expect(status).toContainText("can't take card payments online just now", {
    timeout: 15_000,
  })
  await expect(status).toBeFocused()
  await expect(card.getByRole('button', { name: 'Try the card form again' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Pay and complete move-in' })).toHaveCount(0)

  // B-411. The confirming state is what the server renders once the payment is
  // paying. Set on this test's own row rather than by charging a card: a real
  // confirmation would be finalised by whatever webhook forwarder is running,
  // and the state under test is the one where it never is.
  const mine = { tenant: { email }, status: 'pending' as const }
  await expect.poll(() => prisma.payment.count({ where: mine })).toBe(1)
  const { id } = await prisma.payment.findFirstOrThrow({ where: mine, select: { id: true } })
  await prisma.payment.update({ where: { id }, data: { status: 'processing' } })
  try {
    await page.reload()
    const heading = page.getByRole('heading', { name: 'Confirming your payment' })
    await expect(heading).toBeFocused()

    const again = page.getByRole('button', { name: 'Check again' })
    await expect(again).toBeVisible({ timeout: 45_000 })
    await again.focus()
    await page.keyboard.press('Enter')
    // The button unmounts on press; focus must not fall to <body>.
    await expect(heading).toBeFocused()
    await expect(again).toHaveCount(0)
  } finally {
    // Nothing was charged, so no report should count this as money in flight.
    await prisma.payment.update({ where: { id }, data: { status: 'pending' } })
  }
})
