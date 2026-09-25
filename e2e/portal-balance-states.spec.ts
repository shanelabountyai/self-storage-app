import { expect, test, type Locator } from '@playwright/test'
import { prisma } from '../packages/db'
import { hashPassword } from '../apps/web/lib/auth/password'
import { nextBillingDate } from '../apps/web/lib/portal/dashboard'
import { formatRate } from '../apps/web/lib/format'
import { assertNoAxeViolations } from './a11y-helpers'
import { signInAsTenant } from './sign-in'

// B-393 / PRD 01 US-702 "a bill that is not late does not look late". Every
// demo tenant is past due or owes nothing, so the other two panels need their
// own tenants. A fixed-slug facility of their own (B-120's first discipline):
// nothing else asserts against it, and it is set inactive afterwards so it
// never becomes a second Austin facility in the reports (B-358's lesson).
const SLUG = 'e2e-b393-balance-states'
const PASSWORD = 'balance-states-e2e-1'
const RATE = 12_900
/// Rent plus a $5 protection premium: what the invoice totals, and deliberately
/// not the monthly rate the card's header prints beside the unit size.
const PROTECTION = 500
const BILL = RATE + PROTECTION

type State = 'past' | 'due' | 'autopay'
const email = (state: State) => `${SLUG}-${state}@example.com`

/// The card's words with its links taken out: "the amount appears once" is
/// about the statement, and the Pay control names the amount by design (2.4.4).
async function amountCount(card: Locator, amount: string): Promise<number> {
  let text = await card.innerText()
  for (const link of await card.getByRole('link').allInnerTexts()) text = text.replace(link, '')
  return text.split(amount).length - 1
}

// Serial: under `fullyParallel` each worker runs `beforeAll`, and two racing
// rebuilds of the same fixed-slug fixture collide on the unit type's name.
test.describe.configure({ mode: 'serial' })

test.describe('the portal balance panel names which bill it is', () => {
  test.beforeAll(async ({}, testInfo) => {
    // One project: a fixed-slug fixture in the one shared database, and none of
    // this is viewport-dependent.
    if (testInfo.project.name !== 'desktop-chrome') return

    const facilityId = (
      await prisma.facility.upsert({
        where: { slug: SLUG },
        update: { status: 'active' },
        create: {
          name: 'E2E — Balance states',
          slug: SLUG,
          addressLine1: '1 Balance Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
        select: { id: true },
      })
    ).id

    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${SLUG}`, widthFt: 10, lengthFt: 10 },
    })
    const passwordHash = await hashPassword(PASSWORD)
    const nextDue = nextBillingDate(1, new Date())

    // Past due: a fixed August invoice, part paid, so the late figure ($95) is
    // not the bill the Next payment line still states.
    const fixtures: { state: State; dueDate: Date; owedCents: number }[] = [
      { state: 'past', dueDate: new Date('2026-08-01'), owedCents: 9_500 },
      { state: 'due', dueDate: nextDue, owedCents: BILL },
      { state: 'autopay', dueDate: nextDue, owedCents: BILL },
    ]
    for (const { state, dueDate, owedCents } of fixtures) {
      // Reused, not deleted: a tenant who has signed in may be referenced by
      // rows this spec does not own. `email` is not unique, so no upsert.
      const tenant =
        (await prisma.tenant.findFirst({ where: { email: email(state) }, select: { id: true } })) ??
        (await prisma.tenant.create({
          data: {
            email: email(state),
            firstName: 'Bea',
            lastName: `Balance ${state}`,
            passwordHash,
            emailVerifiedAt: new Date(),
            stripeDefaultPaymentMethodId: state === 'autopay' ? 'pm_e2e_b393' : null,
          },
          select: { id: true },
        }))
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: `B393-${state}` },
      })
      const lease = await prisma.lease.create({
        data: {
          facilityId,
          tenantId: tenant.id,
          unitId: unit.id,
          status: 'active',
          startDate: new Date('2026-01-01'),
          billingDay: 1,
          monthlyRateCents: RATE,
          protectionCents: PROTECTION,
          autopayEnabled: state === 'autopay',
        },
      })
      const invoice = await prisma.invoice.create({
        data: {
          facilityId,
          leaseId: lease.id,
          number: `B393-${state}`,
          status: state === 'past' ? 'partially_paid' : 'open',
          kind: 'rent',
          issueDate: dueDate,
          dueDate,
          periodStart: dueDate,
          periodEnd: new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth() + 1, 1)),
          subtotalCents: BILL,
          totalCents: BILL,
          amountPaidCents: BILL - owedCents,
        },
      })
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId: lease.id,
          invoiceId: invoice.id,
          type: 'charge',
          amountCents: owedCents,
          description: 'Rent',
          occurredAt: dueDate,
        },
      })
    }
  })

  test.afterAll(async ({}, testInfo) => {
    if (testInfo.project.name !== 'desktop-chrome') return
    await prisma.facility.updateMany({ where: { slug: SLUG }, data: { status: 'inactive' } })
  })

  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'fixed-slug fixture, one project')
  })

  const card = (page: import('@playwright/test').Page) =>
    page.getByRole('region', { name: /B393-/ })

  test('past due says since when, and keeps Pay as the button', async ({ page }) => {
    await signInAsTenant(page, email('past'), PASSWORD)
    await page.goto('/portal')
    const amount = formatRate(9_500)
    await expect(card(page)).toContainText(`${amount} past due since August 1.`)
    await expect(card(page).getByRole('link', { name: `Pay ${amount} now` })).toBeVisible()
    expect(await amountCount(card(page), amount)).toBe(1)
  })

  // a11y-state: /portal | balance due, not late
  test('an issued bill not yet due is one line, not a balance and a next payment', async ({ page }) => {
    await signInAsTenant(page, email('due'), PASSWORD)
    await page.goto('/portal')
    const amount = formatRate(BILL)
    await expect(card(page)).toContainText(new RegExp(`\\${amount} due \\w+ \\d+\\.`))
    await expect(card(page)).not.toContainText('past due')
    await expect(card(page).getByRole('link', { name: `Pay ${amount} now` })).toBeVisible()
    expect(await amountCount(card(page), amount)).toBe(1)
    await assertNoAxeViolations(page, { state: 'balance due, not late' })
  })

  // a11y-state: /portal | autopay scheduled
  test('autopay says it will charge, and Pay becomes a Pay early link', async ({ page }) => {
    await signInAsTenant(page, email('autopay'), PASSWORD)
    await page.goto('/portal')
    const amount = formatRate(BILL)
    await expect(card(page)).toContainText(new RegExp(`Autopay will charge \\${amount} on \\w+ \\d+\\.`))
    await expect(card(page).getByRole('link', { name: `Pay ${amount} early` })).toBeVisible()
    await expect(card(page).getByRole('link', { name: `Pay ${amount} now` })).toHaveCount(0)
    expect(await amountCount(card(page), amount)).toBe(1)
    await assertNoAxeViolations(page, { state: 'autopay scheduled' })
  })
})
