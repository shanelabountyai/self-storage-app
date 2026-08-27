import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  haltedLeases,
  planEffectiveness,
  plansAndHoldsReport,
} from '../apps/web/lib/admin/plans-holds-report'
import { delinquencyDetail, agingByFacility } from '../apps/web/lib/admin/delinquency-detail'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-195 / PRD 02 §4.7 US-39.4, §4.6 US-25, §4.5 US-42, against real rows.
//
// The defect this file exists for: the aging report bucketed every balance
// with no awareness of holds at all, so a lease halted behind a bankruptcy
// four months ago and a lease the ladder is actively chasing summed into one
// figure that described neither — and no screen anywhere could answer "who is
// on a plan at my site".
//
// The three fixtures are the three cases that must never be confused: a lease
// under a plan hold WITH a plan, a lease under a bankruptcy hold with NO plan,
// and a lease under no hold at all.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ASOF = d('2026-04-20')
const APRIL = { start: d('2026-04-01'), end: d('2026-05-01') }
const MARCH = { start: d('2026-03-01'), end: d('2026-04-01') }

let facilityId = ''
let staffId = ''
let planLeaseId = ''
let bankruptLeaseId = ''
let chasedLeaseId = ''
let planId = ''
let invoiceCounter = 0

function actor(permissions: PermissionKey[] = ['reports:financial', 'reports:operational']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

/// A lease with one $200 invoice due 2026-03-01, unpaid unless `paidCents`
/// says otherwise, and the matching ledger entries — the ledger is what the
/// aging report reads (PRD 01 §7.3).
async function makeLease(label: string, paidCents = 0) {
  const tenant = await prisma.tenant.create({
    data: {
      email: `plans-${label}-${suffix}@example.com`,
      firstName: 'Ada',
      lastName: `Halted ${suffix}`,
    },
  })
  const unitType = await prisma.unitType.create({
    data: { facilityId, name: `10x10 ${label} ${suffix}`, widthFt: 10, lengthFt: 10 },
  })
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId: unitType.id, number: `${label}-${suffix.slice(0, 3)}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: tenant.id,
      unitId: unit.id,
      status: 'active',
      startDate: d('2026-01-01'),
      billingDay: 1,
      monthlyRateCents: 20_000,
    },
  })

  invoiceCounter += 1
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId: lease.id,
      number: `P${suffix}${String(invoiceCounter).padStart(4, '0')}`,
      kind: 'rent',
      status: paidCents > 0 ? 'partially_paid' : 'open',
      issueDate: d('2026-03-01'),
      dueDate: d('2026-03-01'),
      periodStart: d('2026-03-01'),
      periodEnd: d('2026-04-01'),
      subtotalCents: 20_000,
      taxCents: 0,
      totalCents: 20_000,
      amountPaidCents: paidCents,
      lineItems: {
        create: [{ type: 'rent', description: 'Rent', amountCents: 20_000, unitAmountCents: 20_000 }],
      },
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId: lease.id,
      invoiceId: invoice.id,
      type: 'charge',
      amountCents: 20_000,
      description: 'Rent invoice',
      occurredAt: d('2026-03-01'),
    },
  })
  if (paidCents > 0) {
    await prisma.ledgerEntry.create({
      data: {
        facilityId,
        leaseId: lease.id,
        invoiceId: invoice.id,
        type: 'payment',
        amountCents: -paidCents,
        description: 'Payment',
        occurredAt: d('2026-04-05'),
      },
    })
  }
  return { leaseId: lease.id, invoiceId: invoice.id }
}

async function placeHold(leaseId: string, type: string, effectiveFrom: Date) {
  return prisma.leaseHold.create({
    data: { leaseId, type, effectiveFrom, reason: `${type} for the test`, placedByStaffId: staffId },
  })
}

describeDb('plans & holds report (B-195)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Plans Test ${suffix}`,
        slug: `plans-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `plans-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    // 1. On a plan. $200 owed, $50 of it paid since — so the plan has retired
    //    $50 of the $200 it froze, and $150 is still deferred.
    const onPlan = await makeLease('plan', 5_000)
    planLeaseId = onPlan.leaseId
    const planHold = await placeHold(planLeaseId, 'payment_plan', d('2026-04-10'))
    const plan = await prisma.paymentPlan.create({
      data: {
        leaseId: planLeaseId,
        holdId: planHold.id,
        status: 'active',
        totalCents: 20_000,
        invoiceIds: [onPlan.invoiceId],
        createdByStaffId: staffId,
        createdAt: d('2026-04-10'),
        installments: {
          create: [
            { position: 1, dueDate: d('2026-04-15'), amountCents: 5_000 },
            { position: 2, dueDate: d('2026-05-15'), amountCents: 15_000 },
          ],
        },
      },
    })
    planId = plan.id

    // 2. Halted with nothing agreed in return — the case that matters most.
    const bankrupt = await makeLease('bank')
    bankruptLeaseId = bankrupt.leaseId
    await placeHold(bankruptLeaseId, 'bankruptcy', d('2026-01-05'))

    // 3. No hold at all — the chased half of the split. Deliberately not a
    //    narrow hold type instead: every type in the catalog that a staffer
    //    would reach for here declares `halt_dunning`, so "chased" means "no
    //    hold in force", and a fixture pretending otherwise would be asserting
    //    a catalog entry rather than this report.
    chasedLeaseId = (await makeLease('open')).leaseId
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.$disconnect()
  })

  describe('who is halted', () => {
    it('lists every lease under a hold that stops collections, longest first', async () => {
      const rows = await haltedLeases([facilityId], ASOF)
      expect(rows.map((row) => row.leaseId)).toEqual([bankruptLeaseId, planLeaseId])
      // 2026-01-05 → 2026-04-20 is 105 days; 2026-04-10 → 2026-04-20 is 10.
      expect(rows[0].daysHalted).toBe(105)
      expect(rows[1].daysHalted).toBe(10)
    })

    it('names the reason, because "halted" on its own is the same dead end', async () => {
      const rows = await haltedLeases([facilityId], ASOF)
      expect(rows[0].holdLabels).toEqual(['Bankruptcy'])
      expect(rows[1].holdLabels).toEqual(['Payment plan'])
    })

    it('says when a halted lease has no plan agreed in return', async () => {
      const rows = await haltedLeases([facilityId], ASOF)
      expect(rows[0].plan).toBeNull()
      expect(rows[1].plan).not.toBeNull()
    })

    it('reports the plan against the invoices, not a stored flag', async () => {
      const rows = await haltedLeases([facilityId], ASOF)
      const plan = rows.find((row) => row.leaseId === planLeaseId)!.plan!
      expect(plan.id).toBe(planId)
      expect(plan.totalCents).toBe(20_000)
      // $50 paid settles installment 1 exactly, so the next due is number 2.
      expect(plan.collectedCents).toBe(5_000)
      expect(plan.nextInstallment?.position).toBe(2)
      expect(plan.nextInstallment?.amountCents).toBe(15_000)
      // Installment 1 is covered and 2 is not yet due on 2026-04-20.
      expect(plan.missedCount).toBe(0)
    })

    it('counts a passed installment as missed once its date is behind us', async () => {
      const rows = await haltedLeases([facilityId], d('2026-05-20'))
      const plan = rows.find((row) => row.leaseId === planLeaseId)!.plan!
      expect(plan.missedCount).toBe(1)
      expect(plan.nextInstallment?.position).toBe(2)
    })

    it('defers the lease balance, so it ties out against the aging report', async () => {
      const rows = await haltedLeases([facilityId], ASOF)
      expect(rows.find((row) => row.leaseId === planLeaseId)!.deferredCents).toBe(15_000)
      expect(rows.find((row) => row.leaseId === bankruptLeaseId)!.deferredCents).toBe(20_000)
    })

    it('leaves a lease under no hold out of the list entirely', async () => {
      const rows = await haltedLeases([facilityId], ASOF)
      expect(rows.find((row) => row.leaseId === chasedLeaseId)).toBeUndefined()
    })

    it('drops the hold from the list the moment it is lifted', async () => {
      const hold = await prisma.leaseHold.findFirstOrThrow({
        where: { leaseId: bankruptLeaseId, liftedAt: null },
      })
      await prisma.leaseHold.update({
        where: { id: hold.id },
        data: { liftedAt: d('2026-04-15'), liftReason: 'stay dissolved' },
      })
      try {
        const rows = await haltedLeases([facilityId], ASOF)
        expect(rows.map((row) => row.leaseId)).toEqual([planLeaseId])
      } finally {
        await prisma.leaseHold.update({
          where: { id: hold.id },
          data: { liftedAt: null, liftReason: null },
        })
      }
    })
  })

  describe('the aging split (US-39.4)', () => {
    it('never sums halted and chased into one figure that means neither', async () => {
      const report = await delinquencyDetail(actor(), ASOF)
      const facility = agingByFacility(report.rows).find((row) => row.facilityId === facilityId)!

      // $150 on a plan + $200 bankrupt = $350 halted; $200 still chased.
      expect(facility.split.halted.totalCents).toBe(35_000)
      expect(facility.split.chased.totalCents).toBe(20_000)
      expect(facility.split.total.totalCents).toBe(55_000)
      expect(facility.split.total).toEqual(facility.aging)
    })

    it('flags each row with why it is halted and for how long', async () => {
      const report = await delinquencyDetail(actor(), ASOF)
      const bankrupt = report.rows.find((row) => row.leaseId === bankruptLeaseId)!
      expect(bankrupt.halted).toBe(true)
      expect(bankrupt.haltReasons).toEqual(['Bankruptcy'])
      expect(bankrupt.daysHalted).toBe(105)

      const chased = report.rows.find((row) => row.leaseId === chasedLeaseId)!
      expect(chased.halted).toBe(false)
      expect(chased.haltReasons).toEqual([])
      expect(chased.daysHalted).toBeNull()
    })

    it('rolls the split up the same way it rolls the totals up', async () => {
      const report = await delinquencyDetail(actor(), ASOF)
      const byFacility = agingByFacility(report.rows)
      expect(byFacility.reduce((sum, row) => sum + row.split.halted.totalCents, 0)).toBe(
        report.split.halted.totalCents,
      )
      expect(report.split.total).toEqual(report.aging)
      expect(report.haltedExposureCents).toBe(report.split.halted.totalCents)
    })
  })

  describe('do the plans work', () => {
    it('counts a plan in the month it was agreed, with what it promised', async () => {
      const april = (await planEffectiveness([facilityId], APRIL.start, APRIL.end)).get(facilityId)!
      expect(april.agreedCount).toBe(1)
      expect(april.agreedCents).toBe(20_000)
      expect(april.collectedCents).toBe(5_000)
    })

    it('counts nothing in a month the plan did not touch', async () => {
      const march = await planEffectiveness([facilityId], MARCH.start, MARCH.end)
      expect(march.get(facilityId)).toBeUndefined()
    })

    it('counts a break in the month it broke, not the month it was agreed', async () => {
      await prisma.paymentPlan.update({
        where: { id: planId },
        data: { status: 'broken', brokenAt: d('2026-05-02') },
      })
      try {
        const april = (await planEffectiveness([facilityId], APRIL.start, APRIL.end)).get(
          facilityId,
        )!
        expect(april.brokenCount).toBe(0)
        expect(april.agreedCount).toBe(1)

        const may = (await planEffectiveness([facilityId], d('2026-05-01'), d('2026-06-01'))).get(
          facilityId,
        )!
        expect(may.agreedCount).toBe(0)
        expect(may.brokenCount).toBe(1)
        // $200 promised, $50 retired — $150 is what broke.
        expect(may.brokenCents).toBe(15_000)
      } finally {
        await prisma.paymentPlan.update({
          where: { id: planId },
          data: { status: 'active', brokenAt: null },
        })
      }
    })
  })

  describe('who may read it', () => {
    it('rolls the facility total up from its own rows', async () => {
      const report = await plansAndHoldsReport(actor(), APRIL.start, APRIL.end, ASOF)
      const facility = report.facilities.find((row) => row.facilityId === facilityId)!
      expect(facility.deferredCents).toBe(
        facility.rows.reduce((sum, row) => sum + row.deferredCents, 0),
      )
      expect(facility.rows).toHaveLength(2)
      expect(report.asOf).toEqual(ASOF)
    })

    it('shows nothing to a staffer with only the operational report key', async () => {
      const report = await plansAndHoldsReport(
        actor(['reports:operational']),
        APRIL.start,
        APRIL.end,
        ASOF,
      )
      expect(report.facilities.find((row) => row.facilityId === facilityId)).toBeUndefined()
    })
  })
})
