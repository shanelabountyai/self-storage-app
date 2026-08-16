import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { dailyPaymentsSummary, facilityDayBounds, recordCounterPayment } from '../apps/web/lib/admin/pos'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-039 / PRD 02 §4.8 US-32.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let otherFacilityId = ''
let tenantId = ''
let leaseId = ''
let otherLeaseId = ''
let counterStaffId = ''
let managerStaffId = ''

function staffActor(staffUserId: string, roleKey: 'counter' | 'manager', facility: string): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId: facility,
        roleKey,
        rank: roleKey === 'manager' ? 20 : 10,
        permissions: new Set<PermissionKey>(['tenants:view', 'payments:take']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('counter payments', () => {
  beforeAll(async () => {
    const [facility, other] = await Promise.all([
      prisma.facility.create({
        data: {
          name: `POS Test ${suffix}`,
          slug: `pos-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
          cashApprovalThresholdCents: 50_000,
        },
      }),
      prisma.facility.create({
        data: {
          name: `POS Other ${suffix}`,
          slug: `pos-other-${suffix}`,
          addressLine1: '2 Storage Way',
          city: 'Dallas',
          state: 'TX',
          postalCode: '75201',
          timezone: 'America/Chicago',
        },
      }),
    ])
    facilityId = facility.id
    otherFacilityId = other.id

    const [counter, manager] = await Promise.all([
      prisma.staffUser.create({
        data: { email: `pos-counter-${suffix}@example.com`, firstName: 'Cal', lastName: 'Counter' },
      }),
      prisma.staffUser.create({
        data: { email: `pos-manager-${suffix}@example.com`, firstName: 'Mel', lastName: 'Manager' },
      }),
    ])
    counterStaffId = counter.id
    managerStaffId = manager.id

    const tenant = await prisma.tenant.create({
      data: { email: `pos-tenant-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: 'A-1' },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 1,
      },
    })
    leaseId = lease.id

    const otherUnitType = await prisma.unitType.create({
      data: { facilityId: otherFacilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const otherUnit = await prisma.unit.create({
      data: { facilityId: otherFacilityId, unitTypeId: otherUnitType.id, number: 'B-1' },
    })
    const other2 = await prisma.lease.create({
      data: {
        facilityId: otherFacilityId,
        tenantId,
        unitId: otherUnit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 10_000,
        billingDay: 1,
      },
    })
    otherLeaseId = other2.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    const ids = [facilityId, otherFacilityId]
    await prisma.ledgerEntry.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.payment.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.receiptCounter.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.lease.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.unit.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.unitType.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  const counterActor = () => staffActor(counterStaffId, 'counter', facilityId)
  const managerActor = () => staffActor(managerStaffId, 'manager', facilityId)

  describe('attribution', () => {
    it('names the staffer who took cash, from the session and not the form', async () => {
      const result = await recordCounterPayment(counterActor(), {
        facilityId,
        tenantId,
        leaseId,
        method: 'cash',
        amountCents: 5_000,
        tenderedCents: 10_000,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } })
      expect(payment.receivedByStaffId).toBe(counterStaffId)
      expect(payment.changeCents).toBe(5_000)
      expect(payment.status).toBe('succeeded')
    })

    it('posts the payment to the ledger as a negative amount', async () => {
      const result = await recordCounterPayment(counterActor(), {
        facilityId,
        tenantId,
        leaseId,
        method: 'check',
        amountCents: 2_500,
        checkNumber: '1041',
      })
      if (!result.ok) throw new Error('unreachable')

      const entry = await prisma.ledgerEntry.findFirstOrThrow({
        where: { paymentId: result.paymentId },
      })
      expect(entry.leaseId).toBe(leaseId)
      expect(entry.amountCents).toBe(-2_500)
      expect(entry.description).toContain(`#${result.receiptNumber}`)
    })

    it('refuses to post against a lease at another facility', async () => {
      // The lease id comes from a form; posting to the wrong one is the same
      // mis-crediting bug B-035 fixed on the webhook side.
      const result = await recordCounterPayment(counterActor(), {
        facilityId,
        tenantId,
        leaseId: otherLeaseId,
        method: 'cash',
        amountCents: 1_000,
        tenderedCents: 1_000,
      })
      expect(result).toEqual({ ok: false, problem: 'lease_not_found' })
    })

    it('refuses a facility the actor is not assigned to', async () => {
      await expect(
        recordCounterPayment(counterActor(), {
          facilityId: otherFacilityId,
          tenantId,
          leaseId: otherLeaseId,
          method: 'cash',
          amountCents: 1_000,
          tenderedCents: 1_000,
        }),
      ).rejects.toThrow(ForbiddenError)
    })

    it('refuses a hand-typed card payment rather than inventing money', async () => {
      const result = await recordCounterPayment(counterActor(), {
        facilityId,
        tenantId,
        leaseId,
        method: 'card',
        amountCents: 1_000,
      })
      expect(result).toEqual({ ok: false, problem: 'card_not_supported' })
    })
  })

  describe('manager approval over the cash threshold', () => {
    it('stops counter staff at the threshold', async () => {
      const result = await recordCounterPayment(counterActor(), {
        facilityId,
        tenantId,
        leaseId,
        method: 'cash',
        amountCents: 50_000,
        tenderedCents: 50_000,
      })
      expect(result).toEqual({ ok: false, problem: 'needs_manager' })
    })

    it('lets a manager take the same amount', async () => {
      const result = await recordCounterPayment(managerActor(), {
        facilityId,
        tenantId,
        leaseId,
        method: 'cash',
        amountCents: 50_000,
        tenderedCents: 50_000,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } })
      expect(payment.receivedByStaffId).toBe(managerStaffId)
    })

    it('does not gate a large cheque, only cash', async () => {
      const result = await recordCounterPayment(counterActor(), {
        facilityId,
        tenantId,
        leaseId,
        method: 'check',
        amountCents: 200_000,
        checkNumber: '2048',
      })
      expect(result.ok).toBe(true)
    })
  })

  describe('gapless receipt numbering', () => {
    it('starts at 1 and increments per facility', async () => {
      const fresh = await prisma.facility.create({
        data: {
          name: `POS Fresh ${suffix}`,
          slug: `pos-fresh-${suffix}`,
          addressLine1: '3 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      })
      const unitType = await prisma.unitType.create({
        data: { facilityId: fresh.id, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
      })
      const unit = await prisma.unit.create({
        data: { facilityId: fresh.id, unitTypeId: unitType.id, number: 'C-1' },
      })
      const lease = await prisma.lease.create({
        data: {
          facilityId: fresh.id,
          tenantId,
          unitId: unit.id,
          status: 'active',
          startDate: new Date(),
          monthlyRateCents: 9_000,
          billingDay: 1,
        },
      })

      const actor = staffActor(counterStaffId, 'counter', fresh.id)
      const first = await recordCounterPayment(actor, {
        facilityId: fresh.id,
        tenantId,
        leaseId: lease.id,
        method: 'cash',
        amountCents: 1_000,
        tenderedCents: 1_000,
      })
      const second = await recordCounterPayment(actor, {
        facilityId: fresh.id,
        tenantId,
        leaseId: lease.id,
        method: 'cash',
        amountCents: 1_000,
        tenderedCents: 1_000,
      })
      if (!first.ok || !second.ok) throw new Error('unreachable')

      // Per facility: this facility's first receipt is #1 regardless of how
      // many the other facility has issued.
      expect(first.receiptNumber).toBe(1)
      expect(second.receiptNumber).toBe(2)

      await prisma.ledgerEntry.deleteMany({ where: { facilityId: fresh.id } })
      await prisma.payment.deleteMany({ where: { facilityId: fresh.id } })
      await prisma.receiptCounter.deleteMany({ where: { facilityId: fresh.id } })
      await prisma.lease.delete({ where: { id: lease.id } })
      await prisma.unit.delete({ where: { id: unit.id } })
      await prisma.unitType.delete({ where: { id: unitType.id } })
      // Not the facility: taking a payment audit-logs it, and
      // AuditLog.facilityId is onDelete: Restrict by design — a facility with
      // audit history cannot be hard-deleted (same wall access-service-db and
      // facility-settings-db already hit).
    })

    it('leaves no hole when a payment fails after the number is drawn', async () => {
      // The reason this is not a Postgres sequence: a sequence does not roll
      // back, so an aborted transaction burns a number and the receipt book
      // has a hole no one can explain.
      const before = await prisma.receiptCounter.findUniqueOrThrow({ where: { facilityId } })

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`
            INSERT INTO "receipt_counter" ("facilityId", "nextNumber", "updatedAt")
            VALUES (${facilityId}, 2, NOW())
            ON CONFLICT ("facilityId")
            DO UPDATE SET "nextNumber" = "receipt_counter"."nextNumber" + 1, "updatedAt" = NOW()
          `
          throw new Error('payment failed after the number was drawn')
        }),
      ).rejects.toThrow('payment failed')

      const after = await prisma.receiptCounter.findUniqueOrThrow({ where: { facilityId } })
      expect(after.nextNumber).toBe(before.nextNumber)

      // And the next real payment takes the number the failed one would have.
      const result = await recordCounterPayment(counterActor(), {
        facilityId,
        tenantId,
        leaseId,
        method: 'cash',
        amountCents: 500,
        tenderedCents: 500,
      })
      if (!result.ok) throw new Error('unreachable')
      expect(result.receiptNumber).toBe(before.nextNumber)
    })

    it('hands concurrent counter staff distinct, consecutive numbers', async () => {
      const before = await prisma.receiptCounter.findUniqueOrThrow({ where: { facilityId } })

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          recordCounterPayment(counterActor(), {
            facilityId,
            tenantId,
            leaseId,
            method: 'cash',
            amountCents: 100,
            tenderedCents: 100,
          }),
        ),
      )

      const numbers = results.map((r) => (r.ok ? r.receiptNumber : -1)).sort((a, b) => a - b)
      expect(new Set(numbers).size, 'two receipts shared a number').toBe(5)
      expect(numbers).toEqual([
        before.nextNumber,
        before.nextNumber + 1,
        before.nextNumber + 2,
        before.nextNumber + 3,
        before.nextNumber + 4,
      ])
    })
  })

  describe('daily summary', () => {
    it('totals the day by method and names who took each payment', async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
      const summary = await dailyPaymentsSummary(managerActor(), facilityId, today)

      expect(summary.rows.length).toBeGreaterThan(0)
      expect(summary.totalCents).toBe(summary.rows.reduce((sum, row) => sum + row.amountCents, 0))

      const cash = summary.totalsByMethod.find((entry) => entry.method === 'cash')
      expect(cash).toBeDefined()
      expect(cash!.totalCents).toBe(
        summary.rows.filter((r) => r.method === 'cash').reduce((s, r) => s + r.amountCents, 0),
      )

      // The deposit slip has to list who took the money and the cheque numbers.
      expect(summary.rows.every((row) => row.staffName !== null)).toBe(true)
      const check = summary.rows.find((row) => row.method === 'check')
      expect(check?.checkNumber).toBeTruthy()
    })

    it('reports an empty day rather than failing', async () => {
      const summary = await dailyPaymentsSummary(managerActor(), facilityId, '2020-01-01')
      expect(summary.rows).toEqual([])
      expect(summary.totalCents).toBe(0)
    })

    it('refuses a facility the actor cannot see', async () => {
      await expect(
        dailyPaymentsSummary(managerActor(), otherFacilityId, '2026-01-01'),
      ).rejects.toThrow(ForbiddenError)
    })
  })
})

describe('facilityDayBounds', () => {
  it('spans one facility-local day, not a UTC one', () => {
    // Austin in August is UTC-5, so the local day starts at 05:00 UTC.
    const { start, end } = facilityDayBounds('2026-08-05', 'America/Chicago')
    expect(start.toISOString()).toBe('2026-08-05T05:00:00.000Z')
    expect(end.toISOString()).toBe('2026-08-06T05:00:00.000Z')
  })

  it('stays a real calendar day across a DST change', () => {
    // US DST ended 2026-11-01: the local day is 25 hours long, and a fixed
    // 24-hour window would file an hour of payments under the wrong day.
    const { start, end } = facilityDayBounds('2026-11-01', 'America/Chicago')
    expect(start.toISOString()).toBe('2026-11-01T05:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-02T06:00:00.000Z')
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000)
  })
})
