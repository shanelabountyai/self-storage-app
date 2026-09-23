import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
import { mintPayLink } from '../apps/web/lib/portal/pay-links'
import { dictionaryFor, translate, type Locale } from '../apps/web/lib/i18n'
import { SITE } from '../apps/web/lib/site-config'
import { assertNoAxeViolations } from './a11y-helpers'
import { createPayReceiptFixture } from './pay-receipt-fixture'

// PRD 05 CN-4 (B-051). The pay link's boundaries, from the outside.
//
// No valid token is minted here: doing so needs a real lease with a balance,
// and the demo lifecycle fixtures are shared with the admin and portal specs.
// The behaviour that matters at this layer is what an INVALID token does — that
// it is never a dead end, never enumerable, and never a way into the portal —
// and that is exactly what can be driven without touching anyone's fixtures.
// The valid-token path is covered against disposable rows in
// tests/pay-links-db.test.ts.

test('an expired or unknown pay link lands on the login, never a dead end', async ({ page }) => {
  await page.goto('/pay/not-a-real-token-at-all')

  // CN-4: "an expired link lands on the portal login with the payment screen as
  // post-login destination — never a dead end."
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // B-356. Only an expired link opens the magic-link form; a bare login keeps it shut.
  await page.goto('/login')
  await expect(page.locator('details')).not.toHaveAttribute('open')
})

test('a bad token says the same thing whatever kind of bad it is', async ({ page }) => {
  // Nothing to enumerate: a revoked link, an expired one and one that never
  // existed are indistinguishable from outside.
  await page.goto('/pay/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  const first = page.url()
  await page.goto('/pay/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')
  expect(page.url()).toBe(first)
})

test('the pay route never grants the portal', async ({ page }) => {
  // The whole security shape of this item: a pay link is not a session, so
  // visiting one must leave the rest of the portal exactly as closed as before.
  await page.goto('/pay/not-a-real-token-at-all')
  await page.goto('/portal')
  await expect(page).toHaveURL(/\/login/)
})

test('the login it lands on has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/pay/not-a-real-token-at-all')
  await expect(page.getByRole('main')).toBeVisible()

  await assertNoAxeViolations(page)
})

test('a mixed-case token reaches the pay route instead of being lower-cased away (B-283)', async ({
  request,
}) => {
  // Every real token is mixed-case base64url. From B-066 until B-283 the
  // proxy's casing rule 308'd each one to a lower-cased token that matched
  // nothing — and the tests above kept passing, because every token they
  // drive is one no real link could carry.
  const token = 'Cd06dbYepmgJHQ_tvbynDLo6NzaiTRi3jUuwv28sLvY'
  const response = await request.get(`/pay/${token}`, { maxRedirects: 0 })
  expect(response.status()).not.toBe(308)
  expect(response.headers()['location'] ?? '').not.toContain(token.toLowerCase())
})

// B-314. `/pay/[token]/done` needs a real payLink and a real Payment — the
// balance-owed pay screen at `/pay/[token]` itself needs a live Stripe
// PaymentIntent too, which is out of reach here, but the done screen only
// needs a payment row to read back. A disposable fixture per B-120: its own
// facility and tenant, created here and deleted in `afterAll`, never the
// shared demo lease the other tests in this file deliberately avoid touching.
test.describe('the receipt screen', () => {
  // B-336. More than one test shares this fixture now, and under
  // `fullyParallel` each worker would run `beforeAll` and collide on the slug.
  test.describe.configure({ mode: 'serial' })
  const PASSWORD = 'e2e-pay-link-password'

  let tenantId = ''
  let leaseId = ''
  let token = ''
  let paymentId = ''

  let cleanup = async () => {}

  test.beforeAll(async ({}, testInfo) => {
    const fixture = await createPayReceiptFixture(`e2e-pay-link-${testInfo.project.name}`, PASSWORD)
    ;({ tenantId, leaseId, token, paymentId, cleanup } = fixture)
  })

  test.afterAll(async () => {
    await cleanup()
  })

  // B-314 finding 1 / SC 2.4.1: `<main>` on this route had no `tabIndex`, so
  // the skip link's fragment navigation moved the sequential focus position
  // without moving actual focus — the exact failure
  // `tests/refusal-fragment.test.ts` describes for an unfocusable target.
  test('the skip link actually moves focus to the receipt', async ({ page }) => {
    await page.goto(`/pay/${token}/done?payment=${paymentId}`)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main')).toBeFocused()
  })

  // B-336. Covered by an exception until now, whose reason — "needs a live
  // link" — was never true of this route: it needs only the payment row above.
  test('the receipt has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto(`/pay/${token}/done?payment=${paymentId}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await assertNoAxeViolations(page)
  })

  // B-336. A reminder opened after its seven days used to land on a bare,
  // English `/login` bound for `/portal`. It now says why, in the reminder's
  // language, and signs the tenant in to pay the same lease (CN-4).
  for (const locale of ['en', 'es'] as const satisfies readonly Locale[]) {
    test(`an expired link explains itself in ${locale} and signs in to that lease's payment`, async ({
      page,
    }) => {
      const dict = dictionaryFor(locale)
      await prisma.tenant.update({ where: { id: tenantId }, data: { preferredLocale: locale } })
      const expired = await mintPayLink({ tenantId, leaseId, ttlDays: -1 })
      if (!expired) throw new Error('mint failed')

      await page.goto(`/pay/${expired.token}`)
      await expect(page).toHaveURL(
        `/login?from=${encodeURIComponent(`/portal/pay?lease=${leaseId}`)}&reason=pay_link_expired`,
      )
      await expect(page.locator('html')).toHaveAttribute('lang', locale)
      const message = page.getByText(translate(dict, 'login.payLinkExpired'))
      await expect(message).toBeVisible()
      await expect(message.getByRole('link', { name: SITE.phone.display })).toHaveAttribute(
        'href',
        `tel:${SITE.phone.href}`,
      )
      // a11y-state: /login | pay link expired
      // a11y-state: /login | pay link expired, Spanish
      await assertNoAxeViolations(page, {
        state: locale === 'en' ? 'pay link expired' : 'pay link expired, Spanish',
      })
      // B-356. Checkout sets no password, so the magic-link route is open
      // without a click, and still returns to this lease's payment.
      const magic = page.locator('details')
      await expect(magic).toHaveAttribute('open', '')
      await expect(magic.locator('input[name="from"]')).toHaveValue(`/portal/pay?lease=${leaseId}`)

      await page.getByLabel(translate(dict, 'auth.email')).first().fill(`e2e-pay-link-${test.info().project.name}@example.com`)
      await page.getByLabel(translate(dict, 'auth.password')).fill(PASSWORD)
      await page.getByRole('button', { name: translate(dict, 'login.submit') }).click()
      await expect(page).toHaveURL(`/portal/pay?lease=${leaseId}`)
    })
  }
})
