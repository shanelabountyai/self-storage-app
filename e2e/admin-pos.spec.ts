import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'
import {
  DEMO_BUSINESS_ACCOUNT_NAME,
  DEMO_POS_TENANT_EMAIL,
} from '../apps/web/scripts/demo-credentials'
import { assertNoAxeViolations } from './a11y-helpers'

// PRD 02 §4.8 US-32 (B-039). The counter: take a payment, or start a walk-in
// move-in. Drawer sessions are B-078 and deliberately absent.
//
// Payments here are REAL and permanent — they move a ledger balance and are
// never rolled back. So they are aimed at DEMO_POS_TENANT_EMAIL, whose
// balance nothing else asserts on, rather than at the past-due demo tenant
// the portal and tenant-profile suites depend on.

test.describe('POS role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/admin/pos')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  for (const route of ['/admin/pos', '/admin/pos/summary']) {
    test(`${route} has no WCAG 2.1 AA violations`, async ({ page }) => {
      await page.goto(route)
      await expect(page.getByRole('main')).toBeVisible()

      await assertNoAxeViolations(page)
    })
  }

  test('offers a walk-in move-in priced at the in-store rate', async ({ page }) => {
    await page.goto('/admin/pos')
    await expect(page.getByRole('heading', { name: 'Walk-in move-in' })).toBeVisible()
    await expect(page.getByText(/in store/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start move-in' }).first()).toBeVisible()
    // B-375: a wall of filled primary buttons is a wall of equal emphasis.
    await expect(page.locator('form button.bg-primary', { hasText: 'Start move-in' })).toHaveCount(0)
  })

  test('taking cash records a receipt number and works out the change', async ({ page }) => {
    await page.goto(`/admin/pos?q=${DEMO_POS_TENANT_EMAIL}`)
    await page.getByRole('link', { name: 'Alex Active' }).first().click()

    await page.getByLabel('Amount ($)').fill('20')
    await page.getByLabel('Cash tendered ($)').fill('50')
    await page.getByRole('button', { name: 'Record payment' }).click()

    // B-281. Ends on a printable receipt, with focus moved to its heading
    // rather than left on the button that is no longer there.
    await page.waitForURL(/\/admin\/pos\/done\?payment=/)
    await expect(page.getByRole('heading', { level: 1, name: /Receipt #\d+/ })).toBeFocused()
    await expect(page.getByText('Change due: $30.00')).toBeVisible()
    await expect(page.getByRole('row', { name: /Paid by/ })).toContainText('Cash')
    await expect(page.getByRole('row', { name: /Cash tendered/ })).toContainText('$50.00')

    // a11y-state: /admin/pos/done | cash receipt
    await assertNoAxeViolations(page)
  })

  // B-280. Read-only on purpose: the demo account's balance is asserted by the
  // portal suites, so this finds the account and never takes money against it.
  // B-320: with Card among its methods — the payer's card, on the card screen.
  test('finds a business account by name and offers it as one payment, card included', async ({
    page,
  }) => {
    await page.goto(`/admin/pos?q=${encodeURIComponent(DEMO_BUSINESS_ACCOUNT_NAME)}`)
    await page.getByRole('link', { name: DEMO_BUSINESS_ACCOUNT_NAME }).click()

    const picker = page.getByLabel('Unit or account')
    await expect(picker).toBeVisible()
    await expect(
      picker.getByRole('option', { name: new RegExp(`^${DEMO_BUSINESS_ACCOUNT_NAME} — `) }),
    ).toHaveCount(1)
    await expect(page.getByLabel('Method').locator('option[value="card"]')).toHaveCount(1)

    await assertNoAxeViolations(page)
  })

  // B-319. Read-only: nothing here is submitted against the account. The
  // Method select used to remount at Cash whenever the picker crossed between
  // an account and a unit, leaving a typed check number behind it.
  // B-320 took away the reset this used to end on: an account takes a card
  // now, so Card survives the crossing like every other method.
  test('Method survives a change of payer, Card included', async ({ page }) => {
    // The account's payer holds no unit, so the page with BOTH an account and a
    // unit on it is one of the two "Alex Active" tenants whose units it pays for.
    await page.goto('/admin/pos?q=Alex%20Active')
    const hrefs = await page
      .getByRole('link', { name: 'Alex Active' })
      .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href))
    const picker = page.getByLabel('Unit or account')
    for (const href of hrefs) {
      await page.goto(href)
      if ((await picker.locator('optgroup[label="Unit"] option').count()) > 0) break
    }
    const method = page.getByLabel('Method')
    const accountValue = await picker
      .getByRole('option', { name: new RegExp(`^${DEMO_BUSINESS_ACCOUNT_NAME} — `) })
      .getAttribute('value')
    const unitValue = await picker.locator('optgroup[label="Unit"] option').first().getAttribute('value')

    await picker.selectOption(accountValue!)
    await method.selectOption('check')
    await page.getByLabel('Check number').fill('1041')
    await picker.selectOption(unitValue!)
    await expect(method).toHaveValue('check')
    await picker.selectOption(accountValue!)
    await expect(method).toHaveValue('check')

    await picker.selectOption(unitValue!)
    await method.selectOption('card')
    await picker.selectOption(accountValue!)
    await expect(method).toHaveValue('card')
    await expect(page.getByRole('status').filter({ hasText: 'Method changed' })).toHaveCount(0)
  })

  test('cash with a check number is refused on the Method field', async ({ page }) => {
    await page.goto(`/admin/pos?q=${DEMO_POS_TENANT_EMAIL}`)
    await page.getByRole('link', { name: 'Alex Active' }).first().click()

    // B-334 hides the number under Cash, so the number is typed under Check
    // and then carried across the switch — the mis-pick this refusal exists for.
    await page.getByLabel('Method').selectOption('check')
    await page.getByLabel('Check number').fill('1041')
    await page.getByLabel('Method').selectOption('cash')
    await page.getByLabel('Amount ($)').fill('25')
    await page.getByLabel('Cash tendered ($)').fill('25')
    await page.getByRole('button', { name: 'Record payment' }).click()

    await expect(page.getByRole('main').getByRole('alert')).toContainText(/check number is filled in/i)
    await expect(page.getByLabel('Method')).toHaveAttribute('aria-invalid', 'true')
    await expect(page).toHaveURL(/\/admin\/pos(?!\/done)/)
  })

  // B-334. Read-only: nothing is submitted.
  test('the tender fields follow Method', async ({ page }) => {
    await page.goto(`/admin/pos?q=${DEMO_POS_TENANT_EMAIL}`)
    await page.getByRole('link', { name: 'Alex Active' }).first().click()

    const form = page.getByRole('form', { name: 'Take a payment' })
    const cases: [string, string[]][] = [
      ['cash', ['Cash tendered ($)']],
      ['check', ['Check number']],
      ['money_order', ['Money order number']],
      ['card', []],
    ]
    for (const [value, shown] of cases) {
      await form.getByLabel('Method').selectOption(value)
      for (const label of ['Cash tendered ($)', 'Check number', 'Money order number']) {
        await expect(form.getByRole('textbox', { name: label, exact: true })).toHaveCount(
          shown.includes(label) ? 1 : 0,
        )
      }
    }
  })

  test('a check with no number is refused', async ({ page }) => {
    await page.goto(`/admin/pos?q=${DEMO_POS_TENANT_EMAIL}`)
    await page.getByRole('link', { name: 'Alex Active' }).first().click()

    await page.getByLabel('Method').selectOption('check')
    await page.getByLabel('Amount ($)').fill('25')
    await page.getByRole('button', { name: 'Record payment' }).click()

    await expect(page.getByRole('main').getByRole('alert')).toContainText(/check or money-order number/i)
  })

  test('cash short of the amount tendered is refused', async ({ page }) => {
    await page.goto(`/admin/pos?q=${DEMO_POS_TENANT_EMAIL}`)
    await page.getByRole('link', { name: 'Alex Active' }).first().click()

    await page.getByLabel('Amount ($)').fill('40')
    await page.getByLabel('Cash tendered ($)').fill('10')
    await page.getByRole('button', { name: 'Record payment' }).click()

    await expect(page.getByRole('main').getByRole('alert')).toContainText(/less than the amount/i)
  })

  test('the deposit slip lists the day’s payments with who took them', async ({ page }) => {
    // Takes its own payment rather than relying on the cash test above.
    //
    // `fullyParallel` gives no ordering between the two, so this only ever
    // passed because payments here are real and permanent and previous runs
    // had left some behind. Re-seeding the demo data wipes them
    // (`payment.deleteMany`), and the test then failed with nothing to list —
    // which reads as a broken deposit slip and is not one.
    await page.goto(`/admin/pos?q=${DEMO_POS_TENANT_EMAIL}`)
    await page.getByRole('link', { name: 'Alex Active' }).first().click()
    await page.getByLabel('Amount ($)').fill('5')
    await page.getByLabel('Cash tendered ($)').fill('5')
    await page.getByRole('button', { name: 'Record payment' }).click()
    await page.waitForURL(/\/admin\/pos\/done\?payment=/)

    await page.goto('/admin/pos/summary')
    await expect(page.getByRole('heading', { level: 1, name: 'Daily payments' })).toBeVisible()
    // The cash payment taken above is on today's slip, attributed to the
    // signed-in staffer rather than to nobody.
    await expect(page.getByText('Demo Owner').first()).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Taken by' })).toBeVisible()
  })
})

// B-230 / PRD 02 §4.8 US-32, PRD 01 US-601. Card at the counter.
//
// The counter used to refuse a card outright and send the tenant to the online
// payment screen — a deflection to email aimed at precisely the person standing
// at the desk wanting their gate to reopen.
//
// Read-only against shared demo data (B-120's rule): nothing here submits a
// charge. With no Stripe key configured in e2e the screen raises no intent and
// writes no `Payment` row, so it cannot disturb the past-due tenant the portal
// suites depend on.
test.describe('card at the counter', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('choosing Card carries the typed amount to the card screen', async ({ page }) => {
    await page.goto(`/admin/pos?q=${DEMO_POS_TENANT_EMAIL}`)
    await page.getByRole('link', { name: 'Alex Active' }).first().click()

    await page.getByLabel('Method').selectOption('card')
    await page.getByLabel('Amount ($)').fill('35')
    await page.getByRole('button', { name: 'Record payment' }).click()

    // The amount travels, so the tenant says what they are paying once. The
    // old refusal read as a dead end precisely because it did not.
    await page.waitForURL(/\/admin\/pos\/card\?lease=[^&]+&amount=35\.00/)
    await expect(page.getByRole('heading', { level: 1, name: 'Take a card payment' })).toBeVisible()
    // Scoped to the summary list, not the page: the Payment Element's own
    // "Pay $35.00" button carries the same string, and matching either would
    // be a test that passes whether or not the figure the staffer reads out
    // is right.
    const summary = page.getByRole('main').getByRole('definition').filter({ hasText: '$35.00' })
    await expect(page.getByText('Charging today')).toBeVisible()
    await expect(summary).toHaveCount(1)
  })

  // B-320. Read-only like the rest of this block: no key, so no intent.
  test('an account paying by Card lands on the card screen keyed by the account', async ({
    page,
  }) => {
    await page.goto(`/admin/pos?q=${encodeURIComponent(DEMO_BUSINESS_ACCOUNT_NAME)}`)
    await page.getByRole('link', { name: DEMO_BUSINESS_ACCOUNT_NAME }).click()
    const picker = page.getByLabel('Unit or account')
    await picker.selectOption(
      (await picker
        .getByRole('option', { name: new RegExp(`^${DEMO_BUSINESS_ACCOUNT_NAME} — `) })
        .getAttribute('value'))!,
    )
    await page.getByLabel('Method').selectOption('card')
    await page.getByLabel('Amount ($)').fill('35')
    await page.getByRole('button', { name: 'Record payment' }).click()

    await page.waitForURL(/\/admin\/pos\/card\?account=[^&]+&amount=35\.00/)
    await expect(page.getByRole('heading', { level: 1, name: 'Take a card payment' })).toBeVisible()
    await expect(page.getByText('Balance on this account')).toBeVisible()
    await expect(page.getByRole('main')).toContainText(DEMO_BUSINESS_ACCOUNT_NAME)
  })

  test('the tenant profile can take a payment for a lease that owes something', async ({ page }) => {
    // dana@demo.example.com uniquely: two "Dana Delinquent" tenants exist, one
    // per demo facility, and only this one has a real ledger charge — so only
    // this one renders the control at all, which is the behaviour under test.
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await page.waitForURL(/\/admin\/tenants\/[^/?]+$/)

    await page.getByRole('link', { name: /^Take payment/ }).first().click()
    await page.waitForURL(/\/admin\/pos\/card\?lease=/)
    await expect(page.getByRole('heading', { level: 1, name: 'Take a card payment' })).toBeVisible()
    // The facility comes from the LEASE, not the admin facility switcher — the
    // profile lists leases across every site a staffer can see, and a charge
    // raised against the switcher's facility is money in the wrong deposit.
    await expect(page.getByText('Balance on this unit')).toBeVisible()
  })

  test('/admin/pos/card has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await page.waitForURL(/\/admin\/tenants\/[^/?]+$/)
    await page.getByRole('link', { name: /^Take payment/ }).first().click()
    await page.waitForURL(/\/admin\/pos\/card\?lease=/)
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })
})
