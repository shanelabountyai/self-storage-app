import { expect, test } from '@playwright/test'

// B-416 / B-442. The accessibility statement's entry about JavaScript, run
// rather than read. It asserts what `a11y.short.js.body` says: with JavaScript
// off, Rent now holds the unit and every checkout form posts on its own up to
// the payment step, which is the one screen that needs JavaScript (Stripe) and
// says so with the number to call. Sign-in's form is a real POST, not the
// `javascript:` placeholder B-442 removed.
test('with JavaScript off, the checkout reaches the payment step and says card needs JavaScript', async ({
  browser,
}, testInfo) => {
  // One project: the walk holds a sandbox unit, and nothing here is
  // viewport-dependent.
  test.skip(testInfo.project.name !== 'desktop-chrome', 'not viewport-dependent')

  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  const notice = page.locator('noscript p')
  await expect(notice).toHaveCount(0)

  // A refusal comes back on the same page, with the summary naming the field.
  // The phone passes the browser's `required` and fails the action's own check
  // (fewer than ten digits), so the refusal is the server's, not the browser's.
  const fillDetails = async (phone: string) => {
    await page.getByLabel('First name').fill('Ada')
    await page.getByLabel('Last name').fill('Renter')
    await page.getByLabel('Email', { exact: true }).fill(`e2e-no-js-${Date.now()}@demo.example.com`)
    await page.getByLabel('Mobile number').fill(phone)
    await page.getByLabel('Street address').fill('2400 South Congress Ave')
    await page.getByLabel('Zip code').fill('78704')
  }
  await fillDetails('555-0100')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(/area code/)

  await fillDetails('512-555-0100')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protection' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Lease' })).toBeVisible()
  await page.getByRole('checkbox', { name: /sign this agreement electronically/ }).check()
  await page.getByLabel('Type your full name to sign').fill('Ada Renter')
  await page.getByRole('button', { name: 'Sign and continue' }).click()
  await expect(page.getByRole('heading', { name: 'Payment', exact: true })).toBeVisible()

  // The one step that needs JavaScript says so, with the number.
  await expect(notice).toContainText('JavaScript')
  // SC 2.4.4: the link is named, and it dials.
  await expect(notice.getByRole('link', { name: /^Call / })).toHaveAttribute('href', /^tel:\+?\d+/)

  // Sign-in is named in the statement too: a real form, not the placeholder.
  await page.goto('/login')
  await expect(page.locator('form', { hasText: 'Sign in' }).first()).not.toHaveAttribute(
    'action',
    /^javascript:/,
  )
  await context.close()
})
