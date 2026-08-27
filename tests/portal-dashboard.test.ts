import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { nextBillingDate, portalDashboardForTenant } from '../apps/web/lib/portal/dashboard'

// B-034 / PRD 01 §4.7 US-702. lib/portal/dashboard.ts imports nothing from
// `@/auth` (only prisma and lib/access/provision.ts), so it — unlike the
// login actions B-033 ran into — is directly importable and testable here.

describe('nextBillingDate', () => {
  it('stays in the current month when the billing day has not passed', () => {
    const from = new Date(Date.UTC(2026, 6, 10)) // July 10
    expect(nextBillingDate(15, from)).toEqual(new Date(Date.UTC(2026, 6, 15)))
  })

  it('lands on today when today is the billing day', () => {
    const from = new Date(Date.UTC(2026, 6, 15))
    expect(nextBillingDate(15, from)).toEqual(new Date(Date.UTC(2026, 6, 15)))
  })

  it('rolls into next month once the billing day has passed', () => {
    const from = new Date(Date.UTC(2026, 6, 16))
    expect(nextBillingDate(15, from)).toEqual(new Date(Date.UTC(2026, 7, 15)))
  })

  it('rolls a December billing day into January of the next year', () => {
    const from = new Date(Date.UTC(2026, 11, 20))
    expect(nextBillingDate(1, from)).toEqual(new Date(Date.UTC(2027, 0, 1)))
  })
})

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let unitId = ''

describeDb('portalDashboardForTenant', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Portal Dashboard Test',
        slug: `portal-dash-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `portal-dash-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: 'A-1' },
    })
    unitId = unit.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  it('returns no leases for a tenant with none', async () => {
    const other = await prisma.tenant.create({
      data: { email: `portal-dash-none-${suffix}@example.com`, firstName: 'Bo', lastName: 'Renter' },
    })
    expect(await portalDashboardForTenant(other.id)).toEqual([])
    await prisma.tenant.delete({ where: { id: other.id } })
  })

  it('sums the ledger, reads autopay off the saved payment method, and finds no gate code with no encryption key', async () => {
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        protectionCents: 1_200,
        billingDay: 10,
      },
    })

    await prisma.ledgerEntry.createMany({
      data: [
        { facilityId, leaseId: lease.id, type: 'charge', amountCents: 12_900, description: 'Rent' },
        { facilityId, leaseId: lease.id, type: 'payment', amountCents: -5_000, description: 'Partial payment' },
      ],
    })

    const [summary] = await portalDashboardForTenant(tenantId, new Date(Date.UTC(2026, 6, 1)))

    expect(summary.leaseId).toBe(lease.id)
    expect(summary.balanceCents).toBe(7_900)
    expect(summary.nextDueDate).toEqual(new Date(Date.UTC(2026, 6, 10)))
    expect(summary.autopayEnabled).toBe(false)
    // No AccessGrant row exists for this tenant/facility yet — an unrelated
    // tenant with no move-in provisioning must read as "not suspended", not
    // throw.
    expect(summary.accessSuspended).toBe(false)
    // No ACCESS_CODE_ENCRYPTION_KEY in the test environment (by design — see
    // lib/access/secret.ts) — codeForLease() degrades to null rather than
    // throwing, same as it does against real unconfigured deployments.
    expect(summary.gateCode).toBeNull()

    await prisma.ledgerEntry.deleteMany({ where: { leaseId: lease.id } })
    await prisma.lease.delete({ where: { id: lease.id } })
  })

  it('reads autopay on and a suspended grant as the panel needs to see them', async () => {
    // B-036 changed what "autopay on" means. It was "this tenant has a card
    // saved", which was wrong in both directions — a renter who opted out at
    // checkout still read as On, and one who opted in read as Off because
    // nothing ever recorded the choice. It is now the lease's own flag, and a
    // saved card is only the thing it charges.
    await prisma.tenant.update({ where: { id: tenantId }, data: { stripeDefaultPaymentMethodId: 'pm_test' } })
    const grant = await prisma.accessGrant.create({
      data: { facilityId, tenantId, state: 'suspended', stateCause: 'system:delinquency' },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId,
        status: 'delinquent',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 10,
        autopayEnabled: true,
      },
    })

    const [summary] = await portalDashboardForTenant(tenantId)

    expect(summary.autopayEnabled).toBe(true)
    expect(summary.autopayNeedsCard, 'a card is on file, so nothing is missing').toBe(false)
    expect(summary.accessSuspended).toBe(true)

    await prisma.lease.delete({ where: { id: lease.id } })
    await prisma.accessGrant.delete({ where: { id: grant.id } })
    await prisma.tenant.update({ where: { id: tenantId }, data: { stripeDefaultPaymentMethodId: null } })
  })

  // B-142. Used to be invisible on this screen — two taps deep behind the
  // portal's "Manage" disclosure.
  it('surfaces a pending move-out and a pending transfer hold, and nulls both otherwise', async () => {
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 10,
      },
    })

    const [bare] = await portalDashboardForTenant(tenantId)
    expect(bare.pendingMoveOutDate).toBeNull()
    expect(bare.pendingTransfer).toBeNull()

    const moveOutDate = new Date(Date.UTC(2026, 8, 30))
    await prisma.lease.update({ where: { id: lease.id }, data: { moveOutDate } })

    const toUnitType = await prisma.unitType.create({
      data: { facilityId, name: `10x15 ${suffix}`, widthFt: 10, lengthFt: 15 },
    })
    const toUnit = await prisma.unit.create({ data: { facilityId, unitTypeId: toUnitType.id, number: 'A-2' } })
    const expiresAt = new Date(Date.UTC(2026, 8, 1, 17, 0))
    const hold = await prisma.reservation.create({
      data: {
        facilityId,
        unitTypeId: toUnitType.id,
        unitId: toUnit.id,
        tenantId,
        status: 'held',
        firstName: 'Ada',
        lastName: 'Renter',
        email: `portal-dash-${suffix}@example.com`,
        quotedRateCents: 15_900,
        moveInDate: new Date(Date.UTC(2026, 8, 15)),
        expiresAt,
        tokenHash: `dash-${suffix}`,
        source: 'transfer',
      },
    })

    const [withPending] = await portalDashboardForTenant(tenantId, new Date(Date.UTC(2026, 7, 1)))
    expect(withPending.pendingMoveOutDate).toEqual(moveOutDate)
    expect(withPending.pendingTransfer).toEqual({
      toUnitNumber: 'A-2',
      transferDate: new Date(Date.UTC(2026, 8, 15)),
      expiresAt,
    })

    await prisma.reservation.delete({ where: { id: hold.id } })
    await prisma.unit.delete({ where: { id: toUnit.id } })
    await prisma.unitType.delete({ where: { id: toUnitType.id } })
    await prisma.lease.delete({ where: { id: lease.id } })
  })

  // B-191 / PRD 05 CN-24. The card used to be populated only while the plan
  // was `active`, and to call the first not-yet-paid installment "your next
  // installment". Both were wrong in the same direction: a tenant was told
  // LESS the worse things got.
  it('keeps reporting a plan that has broken, and never calls a missed payment the next one', async () => {
    const staff = await prisma.staffUser.create({
      data: { email: `portal-dash-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId,
        status: 'active',
        startDate: new Date(Date.UTC(2026, 5, 1)),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    const hold = await prisma.leaseHold.create({
      data: {
        leaseId: lease.id,
        type: 'payment_plan',
        reason: 'Plan agreed',
        effectiveFrom: new Date(Date.UTC(2026, 7, 1)),
        placedByStaffId: staff.id,
      },
    })
    const plan = await prisma.paymentPlan.create({
      data: {
        leaseId: lease.id,
        holdId: hold.id,
        totalCents: 120_000,
        invoiceIds: [],
        createdByStaffId: staff.id,
        installments: {
          create: [
            { position: 1, dueDate: new Date(Date.UTC(2026, 8, 15)), amountCents: 60_000 },
            { position: 2, dueDate: new Date(Date.UTC(2026, 9, 15)), amountCents: 60_000 },
          ],
        },
      },
    })

    // Nothing paid, and the first installment's date has gone: it is MISSED,
    // and the second is what is actually next.
    const asOf = new Date(Date.UTC(2026, 8, 20))
    const [active] = await portalDashboardForTenant(tenantId, asOf)
    expect(active.paymentPlan).toEqual({
      status: 'active',
      next: { dueDate: new Date(Date.UTC(2026, 9, 15)), amountCents: 60_000 },
      missed: { dueDate: new Date(Date.UTC(2026, 8, 15)), amountCents: 60_000 },
    })

    await prisma.paymentPlan.update({
      where: { id: plan.id },
      data: { status: 'broken', brokenAt: asOf },
    })
    const [broken] = await portalDashboardForTenant(tenantId, asOf)
    expect(broken.paymentPlan?.status).toBe('broken')

    // A plan that closed out cleanly does go quiet here — a permanent route to
    // its history is B-193's, not this card's.
    await prisma.paymentPlan.update({ where: { id: plan.id }, data: { status: 'completed' } })
    const [completed] = await portalDashboardForTenant(tenantId, asOf)
    expect(completed.paymentPlan).toBeNull()

    await prisma.paymentPlan.delete({ where: { id: plan.id } })
    await prisma.leaseHold.delete({ where: { id: hold.id } })
    await prisma.lease.delete({ where: { id: lease.id } })
    await prisma.staffUser.delete({ where: { id: staff.id } })
  })
})
