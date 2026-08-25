import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'
import { DEMO_POS_TENANT_EMAIL } from '../apps/web/scripts/demo-credentials'
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
  })

  test('taking cash records a receipt number and works out the change', async ({ page }) => {
    await page.goto(`/admin/pos?q=${DEMO_POS_TENANT_EMAIL}`)
    await page.getByRole('link', { name: 'Alex Active' }).first().click()

    await page.getByLabel('Amount ($)').fill('20')
    await page.getByLabel('Cash tendered ($)').fill('50')
    await page.getByRole('button', { name: 'Record payment' }).click()

    const status = page.getByRole('main').getByRole('status').first()
    await expect(status).toContainText(/Receipt #\d+/)
    await expect(status).toContainText('Change due: $30.00')
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
    await expect(page.getByRole('main').getByRole('status').first()).toContainText(/Receipt #\d+/)

    await page.goto('/admin/pos/summary')
    await expect(page.getByRole('heading', { level: 1, name: 'Daily payments' })).toBeVisible()
    // The cash payment taken above is on today's slip, attributed to the
    // signed-in staffer rather than to nobody.
    await expect(page.getByText('Demo Owner').first()).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Taken by' })).toBeVisible()
  })
})
