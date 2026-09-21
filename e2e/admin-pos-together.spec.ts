import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
import { signInAsDemoOwner } from './sign-in'
import { assertNoAxeViolations, expectAnnounced, expectPreexisting } from './a11y-helpers'

// B-358 / SC 2.4.3 Focus Order (A), 4.1.3 Status Messages (AA). The counter's
// "Pay A and B together" button removes itself when pressed — the `units:`
// subject has no overflow warning — so focus has to go somewhere on purpose
// (the Unit select now holding the choice) and the form's one status region
// has to say what just happened. Also closes B-339's "no e2e coverage" gap for
// the warning region and the amount field's `aria-describedby`.
//
// **The fixture is this spec's own, per B-120 discipline (1)**, found-or-
// rebuilt by slug as `admin-ledger-corrections.spec.ts` does. Nothing here
// posts a payment, so no run leaves it in a state the next one did not expect;
// the rebuild is only so a changed fixture shape takes effect.

const SLUG = 'e2e-b358-counter-together'
const TENANT_EMAIL = 'together@b358.example.com'

let tenantId = ''
let facilityId = ''

test.describe.configure({ mode: 'serial' })

test.describe('pay several units together at the counter (B-358)', () => {
  test.beforeAll(async ({}, testInfo) => {
    // One project only: a fixed-slug fixture in the one shared database, and
    // focus and announcement are not viewport-dependent.
    if (testInfo.project.name !== 'desktop-chrome') return

    facilityId = (
      await prisma.facility.upsert({
        where: { slug: SLUG },
        update: {},
        create: {
          name: 'E2E — Counter together',
          slug: SLUG,
          addressLine1: '1 Together Way',
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
    await prisma.tenant.deleteMany({ where: { email: TENANT_EMAIL } })

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${SLUG}`, widthFt: 10, lengthFt: 10 },
    })
    tenantId = (
      await prisma.tenant.create({
        data: { email: TENANT_EMAIL, firstName: 'Tia', lastName: 'Together' },
        select: { id: true },
      })
    ).id

    // Both past due, so B-358's lockout sentence is in the warning. A fixed
    // August due date stays past due on every later run.
    for (const [number, cents] of [
      ['B358-A', 10_000],
      ['B358-B', 8_000],
    ] as const) {
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number },
      })
      const lease = await prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: unit.id,
          status: 'active',
          startDate: new Date('2026-01-01'),
          billingDay: 1,
          monthlyRateCents: cents,
        },
      })
      const invoice = await prisma.invoice.create({
        data: {
          facilityId,
          leaseId: lease.id,
          number: `B358-${number}`,
          status: 'open',
          kind: 'rent',
          issueDate: new Date('2026-08-01'),
          dueDate: new Date('2026-08-01'),
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-09-01'),
          subtotalCents: cents,
          totalCents: cents,
          amountPaidCents: 0,
        },
      })
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId: lease.id,
          invoiceId: invoice.id,
          type: 'charge',
          amountCents: cents,
          description: 'Rent — August 2026',
          occurredAt: new Date('2026-08-01'),
        },
      })
    }
  })

  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  // a11y-state: /admin/pos | several units paid together
  test('the together button hands focus to the Unit select and says what it did', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'owns a shared-database fixture')

    await page.context().addCookies([
      { name: 'storage_facility', value: facilityId, url: 'http://localhost:3000' },
    ])
    await page.goto(`/admin/pos?tenant=${tenantId}`)

    const form = page.getByRole('form', { name: 'Take a payment' })
    const unit = form.getByLabel('Unit', { exact: true })
    // The counter's own region, not AdminForm's submit-result one beside it.
    const region = form.locator('p[role="status"][id]')
    await unit.selectOption({ label: 'B358-A — $100.00 due' })
    await expectPreexisting(region)

    // B-339's warning, in the region the amount field is described by.
    const amount = form.getByLabel('Amount ($)')
    await amount.fill('180')
    await expect(region).toContainText('Unit B358-B also owes $80.00')
    await expect(region).toContainText(
      'Credit on B358-A does not take B358-B off its past-due schedule, so B358-B can still be locked out.',
    )
    const regionId = await region.getAttribute('id')
    expect((await amount.getAttribute('aria-describedby'))?.split(' ')).toContain(regionId)

    await form.getByRole('button', { name: /^Pay B358-A and B358-B together/ }).click()

    await expectAnnounced(region, 'Now paying B358-A and B358-B together.')
    await expect(unit).toBeFocused()
    await expect(unit).toHaveValue(/^units:/)
    await assertNoAxeViolations(page)
  })
})
