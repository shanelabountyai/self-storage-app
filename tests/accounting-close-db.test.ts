import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { PermissionKey } from '@storage/db/rbac-catalog'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import {
  closePeriod,
  driftFor,
  periodsFor,
  reopenPeriod,
  PERIOD_WINDOW_MONTHS,
} from '../apps/web/lib/admin/accounting-close'

// PRD 02 §8, US-40 (B-084 part 1). The close, against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let leaseId = ''
let tenantId = ''
let staffId = ''
let unitTypeId = ''

/// A month safely in the past, so `canClosePeriod` never refuses on the clock
/// and the tests do not change behaviour depending on when they run.
const YEAR = 2026
const MONTH = 5

function actor(permissions: PermissionKey[] = ['accounting:close', 'reports:financial', 'reports:operational']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'regional',
        rank: 30,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

/// One charge and one payment inside May 2026, facility-local.
async function postMayActivity(chargeCents: number, paidCents: number): Promise<void> {
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `INV-${suffix}-${randomUUID().slice(0, 6)}`,
      kind: 'rent',
      status: 'open',
      periodStart: new Date('2026-05-01T05:00:00Z'),
      periodEnd: new Date('2026-05-31T05:00:00Z'),
      issueDate: new Date('2026-05-05T05:00:00Z'),
      dueDate: new Date('2026-05-05T05:00:00Z'),
      subtotalCents: chargeCents,
      taxCents: 0,
      totalCents: chargeCents,
      amountPaidCents: paidCents,
      lineItems: {
        create: [
          {
            type: 'rent',
            description: 'Rent — May 2026',
            quantity: 1,
            unitAmountCents: chargeCents,
            amountCents: chargeCents,
          },
        ],
      },
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      invoiceId: invoice.id,
      type: 'charge',
      amountCents: chargeCents,
      description: 'Rent — May 2026',
      occurredAt: new Date('2026-05-05T05:00:00Z'),
    },
  })
  if (paidCents > 0) {
    // A real `Payment` with a real allocation, not only a ledger row. The
    // revenue report reads COLLECTED from allocations joined to
    // `Payment.receivedAt` — it has to, because an invoice paid across two
    // months settles its categories in the facility's allocation order and
    // neither month's share can be worked out from that month alone. A fixture
    // that posted only a ledger entry would report zero collected and look like
    // a broken close.
    const payment = await prisma.payment.create({
      data: {
        facilityId,
        tenantId,
        amountCents: paidCents,
        method: 'card',
        status: 'succeeded',
        receivedAt: new Date('2026-05-10T05:00:00Z'),
        allocations: { create: [{ invoiceId: invoice.id, amountCents: paidCents }] },
      },
    })
    await prisma.ledgerEntry.create({
      data: {
        facilityId,
        leaseId,
        invoiceId: invoice.id,
        paymentId: payment.id,
        type: 'payment',
        amountCents: -paidCents,
        description: 'Payment — May 2026',
        occurredAt: new Date('2026-05-10T05:00:00Z'),
      },
    })
  }
}

describeDb('the monthly close', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Close ${suffix}`,
        slug: `close-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `close-${suffix}@example.com`, firstName: 'Ren', lastName: 'Regional' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    await prisma.unitTypeRate.create({
      data: {
        facilityId,
        unitTypeId,
        streetRateCents: 15_000,
        webRateCents: 12_900,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `CL-${suffix.slice(0, 4)}`, status: 'occupied' },
    })
    const tenant = await prisma.tenant.create({
      data: { email: `close-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId: tenant.id,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-04-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.accountingPeriod.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { leaseId } } })
    await prisma.invoice.deleteMany({ where: { leaseId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.accountingPeriod.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { leaseId } } })
    await prisma.invoice.deleteMany({ where: { leaseId } })
    await prisma.$disconnect()
  })

  it('files the figures and stores the facility-local window it used', async () => {
    await postMayActivity(100_000, 90_000)
    expect((await closePeriod(actor(), facilityId, YEAR, MONTH)).ok).toBe(true)

    const period = await prisma.accountingPeriod.findUniqueOrThrow({
      where: { facilityId_year_month: { facilityId, year: YEAR, month: MONTH } },
    })
    expect(period.closedAt).not.toBeNull()
    expect(period.closedByStaffId).toBe(staffId)
    // Local midnight in Chicago (CDT in May) is 05:00Z, not 00:00Z. A UTC
    // boundary would push a payment taken at 8pm on the 31st into June.
    expect(period.startsAt.toISOString()).toBe('2026-05-01T05:00:00.000Z')
    expect(period.endsAt.toISOString()).toBe('2026-06-01T05:00:00.000Z')

    const snapshot = period.snapshot as Record<string, Record<string, number>>
    expect(snapshot.periodDerived.billedCents).toBe(100_000)
    expect(snapshot.periodDerived.collectedCents).toBe(90_000)
  })

  it('freezes AR aging, which nothing else can answer for a past month', async () => {
    // The strongest reason this feature exists: `delinquencyReport` takes no
    // date, so once May has passed there is no way to ask what May's aging was
    // except to have written it down.
    await postMayActivity(100_000, 0)
    await closePeriod(actor(), facilityId, YEAR, MONTH)

    const period = await prisma.accountingPeriod.findUniqueOrThrow({
      where: { facilityId_year_month: { facilityId, year: YEAR, month: MONTH } },
    })
    const snapshot = period.snapshot as Record<string, Record<string, number>>
    expect(snapshot.pointInTime.arTotalCents).toBeGreaterThan(0)
    expect(snapshot.pointInTime.rentableUnits).toBeGreaterThan(0)
  })

  it('refuses to close the same month twice', async () => {
    await closePeriod(actor(), facilityId, YEAR, MONTH)
    const second = await closePeriod(actor(), facilityId, YEAR, MONTH)
    expect(second.ok).toBe(false)
    expect(second.ok === false && second.reason).toContain('already closed')
  })

  it('refuses a month that has not finished in the facility’s timezone', async () => {
    const result = await closePeriod(
      actor(),
      facilityId,
      YEAR,
      MONTH,
      // 11pm on 31 May, Chicago time. The month is not over there.
      new Date('2026-06-01T04:00:00Z'),
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('has not finished')
  })

  it('detects a voided invoice as drift, and reports the direction', async () => {
    await postMayActivity(100_000, 90_000)
    await closePeriod(actor(), facilityId, YEAR, MONTH)
    expect(await driftFor(actor(), facilityId, YEAR, MONTH)).toEqual([])

    // Somebody voids a May invoice in June — the case the whole check exists
    // for, and one the ledger alone would not shout about.
    await prisma.invoice.updateMany({ where: { leaseId }, data: { status: 'void' } })

    const drift = await driftFor(actor(), facilityId, YEAR, MONTH)
    expect(drift).not.toBeNull()
    const billed = drift!.find((row) => row.key === 'billedCents')
    expect(billed).toBeDefined()
    expect(billed!.filedValue).toBe(100_000)
    expect(billed!.deltaValue).toBeLessThan(0)
  })

  it('returns no drift for a month that was never closed, rather than an empty list', async () => {
    // An empty list reads as "checked, all fine". Null is "there is nothing to
    // check against", which is a different statement.
    expect(await driftFor(actor(), facilityId, YEAR, 4)).toBeNull()
  })

  it('reopening clears the snapshot and keeps it in the audit log', async () => {
    await postMayActivity(100_000, 90_000)
    await closePeriod(actor(), facilityId, YEAR, MONTH)

    const result = await reopenPeriod(actor(), facilityId, YEAR, MONTH, 'May rent was double-billed')
    expect(result.ok).toBe(true)

    const period = await prisma.accountingPeriod.findUniqueOrThrow({
      where: { facilityId_year_month: { facilityId, year: YEAR, month: MONTH } },
    })
    expect(period.closedAt).toBeNull()
    // Cleared, not kept: an open month must not display withdrawn figures as
    // though they were still authoritative.
    expect(period.snapshot).toBeNull()

    const entry = await prisma.auditLog.findFirst({
      where: {
        action: 'period.reopened',
        entityId: `${facilityId}:${YEAR}-05`,
      },
      orderBy: { occurredAt: 'desc' },
    })
    expect(entry).not.toBeNull()
    expect(entry!.reasonCode).toBe('May rent was double-billed')
    // The withdrawn figures survive here and nowhere else.
    expect((entry!.before as Record<string, Record<string, number>>).periodDerived.billedCents).toBe(
      100_000,
    )
  })

  it('refuses to reopen without a reason', async () => {
    await closePeriod(actor(), facilityId, YEAR, MONTH)
    const result = await reopenPeriod(actor(), facilityId, YEAR, MONTH, '   ')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('Say why')

    const period = await prisma.accountingPeriod.findUniqueOrThrow({
      where: { facilityId_year_month: { facilityId, year: YEAR, month: MONTH } },
    })
    expect(period.closedAt).not.toBeNull()
  })

  it('refuses to reopen a month that is not closed', async () => {
    const result = await reopenPeriod(actor(), facilityId, YEAR, MONTH, 'a reason')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('nothing to reopen')
  })

  it('can be closed again after a reopen, filing the corrected figures', async () => {
    await postMayActivity(100_000, 90_000)
    await closePeriod(actor(), facilityId, YEAR, MONTH)
    await reopenPeriod(actor(), facilityId, YEAR, MONTH, 'restating')

    await prisma.invoice.updateMany({ where: { leaseId }, data: { status: 'void' } })
    expect((await closePeriod(actor(), facilityId, YEAR, MONTH)).ok).toBe(true)

    const period = await prisma.accountingPeriod.findUniqueOrThrow({
      where: { facilityId_year_month: { facilityId, year: YEAR, month: MONTH } },
    })
    const snapshot = period.snapshot as Record<string, Record<string, number>>
    expect(snapshot.periodDerived.billedCents).toBe(0)
    // And the re-filed month is clean again.
    expect(await driftFor(actor(), facilityId, YEAR, MONTH)).toEqual([])
  })

  it('lists a fixed window of months, including ones nobody has closed', async () => {
    const periods = await periodsFor(actor(), facilityId, new Date('2026-08-15T12:00:00Z'))
    expect(periods).toHaveLength(PERIOD_WINDOW_MONTHS)
    // Newest first, and the current month is present but not closable.
    expect(periods[0]).toMatchObject({ year: 2026, month: 8, ended: false, closedAt: null })
    expect(periods[1]).toMatchObject({ year: 2026, month: 7, ended: true })
  })

  it('refuses a manager — closing is held above facility settings', async () => {
    const manager: Actor = {
      kind: 'staff',
      staffUserId: staffId,
      assignments: [
        {
          facilityId,
          roleKey: 'manager',
          rank: 20,
          permissions: new Set<PermissionKey>(['facility:settings', 'reports:financial']),
          limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
        },
      ],
    }
    await expect(closePeriod(manager, facilityId, YEAR, MONTH)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(periodsFor(manager, facilityId)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
