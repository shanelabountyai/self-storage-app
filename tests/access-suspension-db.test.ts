import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  evaluateAccessSuspensions,
  restoreAccessIfSettled,
} from '../apps/web/lib/access/delinquency-gate'
import { placeHold } from '../apps/web/lib/admin/holds'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-098 / PRD 02 US-45, decided as D-16. The rule against real grants.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let unitTypeId = ''
let grantId = ''
let staffId = ''
let invoiceCounter = 0

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const collected: { itemId: string; ok: boolean; message?: string }[] = []
const recordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => {
  collected.push(outcome)
}

function manager(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['tenants:view', 'tenants:edit']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

/// An unpaid rent invoice due on `dueDate`, with a matching ledger charge so
/// the balance and the age agree — which is how the real system looks.
async function overdueRent(dueDate: Date, totalCents = 12_900): Promise<void> {
  invoiceCounter += 1
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `AS${String(invoiceCounter).padStart(5, '0')}`,
      kind: 'rent',
      status: 'open',
      issueDate: dueDate,
      dueDate,
      periodStart: dueDate,
      periodEnd: new Date(dueDate.getTime() + 30 * 86_400_000),
      subtotalCents: totalCents,
      totalCents,
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: 'charge',
      amountCents: totalCents,
      description: 'Rent',
      occurredAt: dueDate,
      invoiceId: invoice.id,
    },
  })
}

async function settleUp(): Promise<void> {
  const balance = await prisma.ledgerEntry.aggregate({
    where: { leaseId },
    _sum: { amountCents: true },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: 'payment',
      amountCents: -(balance._sum.amountCents ?? 0),
      description: 'Payment',
    },
  })
  await prisma.invoice.updateMany({
    where: { leaseId },
    data: { status: 'paid', amountPaidCents: 12_900 },
  })
}

async function grantState(): Promise<string> {
  const grant = await prisma.accessGrant.findUniqueOrThrow({ where: { id: grantId } })
  return grant.state
}

describeDb('access suspension', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Access Test',
        slug: `access-susp-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `access-susp-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const staff = await prisma.staffUser.create({
      data: { email: `access-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'AS-1' } })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: d('2026-08-01'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id

    const grant = await prisma.accessGrant.create({
      data: { facilityId, tenantId, state: 'active', stateCause: 'system:move_in' },
    })
    grantId = grant.id
  })

  afterEach(async () => {
    collected.length = 0
    await prisma.leaseHold.deleteMany({ where: { leaseId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.update({
      where: { id: grantId },
      data: { state: 'active', stateCause: 'system:move_in' },
    })
    await prisma.facility.update({
      where: { id: facilityId },
      data: { accessSuspendDaysPastDue: 6, accessRestoreAtOrBelowCents: 0 },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  it('leaves a tenant five days past due alone', async () => {
    await overdueRent(d('2026-09-01'))
    await evaluateAccessSuspensions(facilityId, d('2026-09-06'), recordItem)
    expect(await grantState()).toBe('active')
  })

  it('suspends at the sixth day, and says so in US-45’s own words', async () => {
    await overdueRent(d('2026-09-01'))
    await evaluateAccessSuspensions(facilityId, d('2026-09-07'), recordItem)

    expect(await grantState()).toBe('suspended')
    expect(collected[0].message).toBe('Access suspended, 6 days past due, 2026-09-07')
  })

  it('audits the suspension with the triggering invoice and the day count', async () => {
    await overdueRent(d('2026-09-01'))
    await evaluateAccessSuspensions(facilityId, d('2026-09-07'), recordItem)

    // Newest first: the grant is shared across the tests in this file and
    // `audit_log` is append-only, so an unordered read could return an earlier
    // test's suspension with a different day count.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'access.suspended', entityId: grantId },
      orderBy: { occurredAt: 'desc' },
    })
    const context = audit.after as { daysPastDue: number; triggeringInvoiceNumber: string | null }
    expect(context.daysPastDue).toBe(6)
    // "Why was I locked out" has to be answerable from the record.
    expect(context.triggeringInvoiceNumber).toBeTruthy()
    expect(audit.actorType).toBe('system')
  })

  it('enqueues a suspend command to the gate rather than only flipping a column', async () => {
    await overdueRent(d('2026-09-01'))
    await evaluateAccessSuspensions(facilityId, d('2026-09-07'), recordItem)

    const command = await prisma.gateCommand.findFirstOrThrow({ where: { facilityId } })
    expect(command.type).toBe('suspend_access')
  })

  it('notifies the tenant exactly once', async () => {
    await overdueRent(d('2026-09-01'))
    await evaluateAccessSuspensions(facilityId, d('2026-09-07'), recordItem)

    // One event, emitted by `transitionGrant`. B-098 deliberately does not emit
    // a second — the figures the notice needs are recomputed at send time.
    const events = await prisma.domainEvent.findMany({
      where: { facilityId, name: 'access.suspended' },
    })
    expect(events).toHaveLength(1)
    expect(events[0].entityType).toBe('AccessGrant')
  })

  it('emits access.restored on a restore, not access.granted', async () => {
    // Before B-098 a restore emitted `granted`, so CN-11's restore notice had
    // no event to fire on.
    await overdueRent(d('2026-09-01'))
    await evaluateAccessSuspensions(facilityId, d('2026-09-07'), recordItem)
    await settleUp()
    await restoreAccessIfSettled(tenantId, facilityId, d('2026-09-07'))

    expect(await prisma.domainEvent.count({ where: { facilityId, name: 'access.restored' } })).toBe(1)
    expect(await prisma.domainEvent.count({ where: { facilityId, name: 'access.granted' } })).toBe(0)
  })

  it('does not suspend twice on the next night', async () => {
    await overdueRent(d('2026-09-01'))
    await evaluateAccessSuspensions(facilityId, d('2026-09-07'), recordItem)
    await evaluateAccessSuspensions(facilityId, d('2026-09-08'), recordItem)

    expect(await prisma.gateCommand.count({ where: { facilityId } })).toBe(1)
  })

  it('is blocked outright by a hold, however far past due', async () => {
    await overdueRent(d('2026-08-01'))
    await placeHold(manager(), leaseId, { type: 'military_scra', reason: 'Deployment orders.' })

    await evaluateAccessSuspensions(facilityId, d('2026-10-01'), recordItem)

    expect(await grantState()).toBe('active')
    expect(collected.some((item) => item.message?.includes('on hold'))).toBe(true)
  })

  it('restores automatically once the balance reaches zero', async () => {
    await overdueRent(d('2026-09-01'))
    await evaluateAccessSuspensions(facilityId, d('2026-09-07'), recordItem)
    expect(await grantState()).toBe('suspended')

    await settleUp()
    await evaluateAccessSuspensions(facilityId, d('2026-09-08'), recordItem)

    expect(await grantState()).toBe('active')
  })

  it('restores inline the moment a payment settles, not on the next nightly pass', async () => {
    // US-45's ~2-minute SLA. This is the path the Stripe webhook and the
    // counter both call.
    await overdueRent(d('2026-09-01'))
    await evaluateAccessSuspensions(facilityId, d('2026-09-07'), recordItem)
    await settleUp()

    expect(await restoreAccessIfSettled(tenantId, facilityId, d('2026-09-07'))).toBe(true)
    expect(await grantState()).toBe('active')
  })

  it('does not restore on a partial payment', async () => {
    await overdueRent(d('2026-09-01'))
    await evaluateAccessSuspensions(facilityId, d('2026-09-07'), recordItem)

    await prisma.ledgerEntry.create({
      data: { facilityId, leaseId, type: 'payment', amountCents: -5_000, description: 'Part payment' },
    })

    expect(await restoreAccessIfSettled(tenantId, facilityId, d('2026-09-07'))).toBe(false)
    expect(await grantState()).toBe('suspended')
  })

  it('does nothing on a payment from a tenant who was never suspended', async () => {
    await overdueRent(d('2026-09-01'))
    await settleUp()
    expect(await restoreAccessIfSettled(tenantId, facilityId, d('2026-09-07'))).toBe(false)
    expect(await grantState()).toBe('active')
  })

  it('honours a facility that has disabled the rule', async () => {
    await prisma.facility.update({
      where: { id: facilityId },
      data: { accessSuspendDaysPastDue: 0 },
    })
    await overdueRent(d('2026-08-01'))

    await evaluateAccessSuspensions(facilityId, d('2026-10-01'), recordItem)

    expect(await grantState()).toBe('active')
  })

  it('does not age on a fee invoice alone', async () => {
    // B-047's fee invoices are due the day they are raised. Letting one drive
    // the clock would suspend access over a $20 fee raised this morning.
    invoiceCounter += 1
    const fee = await prisma.invoice.create({
      data: {
        facilityId,
        leaseId,
        number: `AF${String(invoiceCounter).padStart(5, '0')}`,
        kind: 'fee',
        status: 'open',
        issueDate: d('2026-08-01'),
        dueDate: d('2026-08-01'),
        periodStart: d('2026-08-01'),
        periodEnd: d('2026-08-02'),
        subtotalCents: 2_000,
        totalCents: 2_000,
      },
    })
    await prisma.ledgerEntry.create({
      data: {
        facilityId,
        leaseId,
        type: 'charge',
        amountCents: 2_000,
        description: 'Late fee',
        occurredAt: d('2026-08-01'),
        invoiceId: fee.id,
      },
    })

    await evaluateAccessSuspensions(facilityId, d('2026-10-01'), recordItem)

    expect(await grantState()).toBe('active')
  })
})
