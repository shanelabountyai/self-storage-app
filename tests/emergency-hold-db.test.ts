import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { DEFAULT_LATE_FEE_STEPS } from '../packages/core/billing'
import type { TimelineStep } from '../packages/core/delinquency'
import {
  liftEndedEmergencyHolds,
  placeEmergencyHold,
} from '../apps/web/lib/admin/emergency-hold'
import { activeHolds } from '../apps/web/lib/admin/holds'
import { saveTimeline } from '../apps/web/lib/admin/delinquency-timeline'
import { assessLateFees } from '../apps/web/lib/billing/late-fees'
import { runDelinquencyTimeline } from '../apps/web/lib/delinquency/engine'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-420 / PRD 02 US-42 "an emergency hold covers a region", against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const noop = () => {}

/// Two sites in one county and one in another, one active lease each, every
/// lease a month past due. The county carries the run's suffix: facilities
/// are never deleted here (B-185), so a plain "Travis" would match every
/// earlier run's rows.
const sites: { id: string; leaseId: string; county: string }[] = []
let staffId = ''

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId: null,
        roleKey: 'owner',
        rank: 40,
        permissions: new Set<PermissionKey>(['tenants:edit', 'facility:settings']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

const step = (dayOffset: number, label: string): TimelineStep => ({
  dayOffset,
  label,
  automatedActions: [],
  noticeTemplateKey: null,
  deliveryMethods: [],
  staffTaskLabel: null,
  requiredProofFields: [],
})

describeDb('the regional emergency hold', () => {
  beforeAll(async () => {
    const staff = await prisma.staffUser.create({
      data: { email: `eh-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
    for (const [index, county] of [`Travis-${suffix}`, `Travis-${suffix}`, `Hays-${suffix}`].entries()) {
      const facility = await prisma.facility.create({
        data: {
          name: `Emergency ${county} ${index} ${suffix}`,
          slug: `eh-${index}-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          county: county.toUpperCase(),
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      })
      const tenant = await prisma.tenant.create({
        data: { email: `eh-t-${index}-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
      })
      const unitType = await prisma.unitType.create({
        data: { facilityId: facility.id, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
      })
      const unit = await prisma.unit.create({
        data: { facilityId: facility.id, unitTypeId: unitType.id, number: `EH-${index}` },
      })
      const lease = await prisma.lease.create({
        data: {
          facilityId: facility.id,
          tenantId: tenant.id,
          unitId: unit.id,
          status: 'active',
          startDate: d('2026-08-01'),
          billingDay: 1,
          monthlyRateCents: 12_900,
        },
      })
      const invoice = await prisma.invoice.create({
        data: {
          facilityId: facility.id,
          leaseId: lease.id,
          number: `EH${index}${suffix}`,
          kind: 'rent',
          status: 'open',
          issueDate: d('2026-09-01'),
          dueDate: d('2026-09-01'),
          periodStart: d('2026-09-01'),
          periodEnd: d('2026-10-01'),
          subtotalCents: 12_900,
          totalCents: 12_900,
        },
      })
      await prisma.ledgerEntry.create({
        data: {
          facilityId: facility.id,
          leaseId: lease.id,
          invoiceId: invoice.id,
          type: 'charge',
          amountCents: 12_900,
          description: 'Rent',
          occurredAt: d('2026-09-01'),
        },
      })
      sites.push({ id: facility.id, leaseId: lease.id, county })
    }
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.facility.updateMany({ where: { id: { in: sites.map((s) => s.id) } }, data: { county: null } })
    await prisma.$disconnect()
  })

  it('places one hold per occupying lease in the county, and one audit row for the action', async () => {
    const result = await placeEmergencyHold(actor(), {
      // Lower-cased on purpose: the match is case-insensitive.
      county: { state: 'tx', county: `travis-${suffix}` },
      effectiveFrom: d('2026-09-10'),
      effectiveTo: d('2026-09-20'),
      reason: 'Flooding — county under evacuation order.',
    })
    expect(result).toMatchObject({ ok: true, facilities: 2, leases: 2 })

    for (const site of sites) {
      const holds = await activeHolds(site.leaseId, d('2026-09-15'))
      expect(holds.map((hold) => hold.type)).toEqual(site.county.startsWith('Travis') ? ['emergency'] : [])
    }
    const audit = await prisma.auditLog.findMany({
      where: { action: 'hold.emergency_placed', after: { path: ['facilityIds'], array_contains: [sites[0].id] } },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0].after).toMatchObject({ leases: 2 })
  })

  it('charges no late fee inside the window', async () => {
    for (const step of DEFAULT_LATE_FEE_STEPS) {
      await prisma.lateFeeRule.create({ data: { facilityId: sites[0].id, ...step, effectiveFrom: d('2020-01-01') } })
    }
    await assessLateFees(sites[0].id, d('2026-09-15'), noop)
    expect(await prisma.invoice.count({ where: { leaseId: sites[0].leaseId, kind: 'fee' } })).toBe(0)
  })

  it('takes the hold window off the lien day count once the hold has passed', async () => {
    await saveTimeline(actor(), sites[0].id, {
      label: 'Test',
      qualifyingAmount: 'full_balance',
      steps: [step(10, 'Late'), step(25, 'Pre-lien')],
    })
    // 2026-10-02 is 31 days past a 1 September due date; the 10 held days
    // (10th–20th) leave 21, so day 10 is due and day 25 is not. Two nights,
    // because B-161 walks one rung a night: without the exclusion the second
    // night fires day 25.
    await runDelinquencyTimeline(sites[0].id, d('2026-10-01'), noop)
    const second = await runDelinquencyTimeline(sites[0].id, d('2026-10-02'), noop)
    expect(second.stepsExecuted).toBe(0)
    const runs = await prisma.delinquencyStepRun.findMany({ where: { leaseId: sites[0].leaseId } })
    expect(runs.map((one) => one.dayOffset)).toEqual([10])
  })

  it('closes the hold after its end date and raises one task per facility', async () => {
    await liftEndedEmergencyHolds(sites[0].id, d('2026-09-21'), noop)
    const hold = await prisma.leaseHold.findFirstOrThrow({ where: { leaseId: sites[0].leaseId, type: 'emergency' } })
    expect(hold.liftedAt).not.toBeNull()
    expect(hold.liftReason).toBe('emergency_ended')
    const tasks = await prisma.task.findMany({ where: { facilityId: sites[0].id, type: 'emergency_hold_ended' } })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].detail).toContain('1 lease resumes')
    // Idempotent: a second night finds nothing to close and raises nothing.
    await liftEndedEmergencyHolds(sites[0].id, d('2026-09-22'), noop)
    expect(await prisma.task.count({ where: { facilityId: sites[0].id, type: 'emergency_hold_ended' } })).toBe(1)
    // The other Travis site is still open until its own night runs.
    expect(await prisma.leaseHold.count({ where: { leaseId: sites[1].leaseId, liftedAt: null } })).toBe(1)
  })

  it('refuses a county nobody is in, and a window that ends before it starts', async () => {
    expect(
      await placeEmergencyHold(actor(), {
        county: { state: 'TX', county: 'Nowhere' },
        effectiveFrom: d('2026-09-10'),
        effectiveTo: d('2026-09-20'),
        reason: 'x',
      }),
    ).toMatchObject({ ok: false, reason: 'no_facilities' })
    expect(
      await placeEmergencyHold(actor(), {
        facilityIds: [sites[2].id],
        effectiveFrom: d('2026-09-20'),
        effectiveTo: d('2026-09-10'),
        reason: 'x',
      }),
    ).toMatchObject({ ok: false, reason: 'bad_dates' })
    expect(await prisma.leaseHold.count({ where: { leaseId: sites[2].leaseId } })).toBe(0)
  })
})
