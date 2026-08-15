import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { syncActiveDutyHolds } from '../apps/web/lib/tenants/active-duty'
import { updateTenantActiveDuty } from '../apps/web/lib/admin/tenants'
import { leaseHasEffect, liftHold } from '../apps/web/lib/admin/holds'
import { recordLeaseDeclarations } from '../apps/web/lib/checkout/details'
import { runDelinquencyTimeline } from '../apps/web/lib/delinquency/engine'
import { saveTimeline } from '../apps/web/lib/admin/delinquency-timeline'
import { approveAuction, openAuctionCase } from '../apps/web/lib/auctions/service'
import type { TimelineStep } from '../packages/core/delinquency'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-121 / PRD 02 §4.9 US-42, PRD 01 US-501 step 4, D-49, 50 U.S.C. §3958.
//
// The declaration reaching the pipeline. `military_scra` had the right effects
// from B-096 and `Tenant.activeDutyMilitary` had been collected since B-112,
// and nothing joined them — so the renter who ticked the box was dunned,
// overlocked and auctioned like anybody else while the file showed we asked.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let austinId = ''
let dallasId = ''
let tenantId = ''
let austinLeaseId = ''
let dallasLeaseId = ''
let managerId = ''
let counterId = ''

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const noop = () => {}

/// Rank 20 is manager, 10 is counter, matching the seeded roles.
///
/// Scoped to AUSTIN only, deliberately and throughout: the whole point of the
/// cross-facility assertion below is that a staffer who cannot see Dallas still
/// protects the Dallas lease.
function actor(staffUserId: string, rank: number): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId: austinId,
        roleKey: rank >= 20 ? 'manager' : 'counter',
        rank,
        permissions: new Set(['tenants:view', 'tenants:edit', 'facility:settings', 'auctions:approve']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

const step = (dayOffset: number, label: string, over: Partial<TimelineStep> = {}): TimelineStep => ({
  dayOffset,
  label,
  automatedActions: [],
  noticeTemplateKey: null,
  deliveryMethods: [],
  staffTaskLabel: null,
  requiredProofFields: [],
  ...over,
})

async function makeFacility(name: string, slug: string): Promise<string> {
  const facility = await prisma.facility.create({
    data: {
      name,
      slug,
      addressLine1: '1 Storage Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '78704',
      timezone: 'America/Chicago',
    },
  })
  return facility.id
}

async function makeLease(facilityId: string, number: string) {
  const unitType = await prisma.unitType.create({
    data: { facilityId, name: `10x10 ${number} ${suffix}`, widthFt: 10, lengthFt: 10 },
  })
  const unit = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number } })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status: 'active',
      startDate: d('2026-06-01'),
      billingDay: 1,
      monthlyRateCents: 12_900,
    },
  })
  return { leaseId: lease.id, unitId: unit.id }
}

/// A lease $129 past due, with the ledger to match.
async function makeOverdue(facilityId: string, leaseId: string) {
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      kind: 'rent',
      periodStart: d('2026-06-01'),
      periodEnd: d('2026-07-01'),
      issueDate: d('2026-06-01'),
      dueDate: d('2026-06-01'),
      totalCents: 12_900,
      amountPaidCents: 0,
      status: 'open',
      number: `SCRA-${suffix}-${Math.floor(Math.random() * 100_000)}`,
    },
  })
  await prisma.ledgerEntry.create({
    data: { facilityId, leaseId, type: 'charge', amountCents: 12_900, description: 'Rent' },
  })
  return invoice
}

/// Declares, the way both real paths do: the flag is written first, and the
/// sync reads it back. `syncActiveDutyHolds` is a no-op without it, deliberately
/// — the guard lives in the function so a caller cannot forget it.
async function declare(asOf?: Date) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { activeDutyMilitary: true } })
  return syncActiveDutyHolds(tenantId, 'checkout', prisma, asOf)
}

describeDb('the active-duty declaration reaches the pipeline', () => {
  beforeAll(async () => {
    austinId = await makeFacility('SCRA Austin', `scra-austin-${suffix}`)
    dallasId = await makeFacility('SCRA Dallas', `scra-dallas-${suffix}`)

    const tenant = await prisma.tenant.create({
      data: { email: `scra-${suffix}@example.com`, firstName: 'Sam', lastName: 'Servicemember' },
    })
    tenantId = tenant.id

    const [manager, counter] = await Promise.all([
      prisma.staffUser.create({
        data: { email: `scra-mgr-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
      }),
      prisma.staffUser.create({
        data: { email: `scra-ctr-${suffix}@example.com`, firstName: 'Cal', lastName: 'Counter' },
      }),
    ])
    managerId = manager.id
    counterId = counter.id

    austinLeaseId = (await makeLease(austinId, `A-${suffix}`)).leaseId
    dallasLeaseId = (await makeLease(dallasId, `D-${suffix}`)).leaseId
  })

  afterEach(async () => {
    await prisma.auctionCase.deleteMany({ where: { leaseId: { in: [austinLeaseId, dallasLeaseId] } } })
    await prisma.unitOverlock.deleteMany({ where: { leaseId: { in: [austinLeaseId, dallasLeaseId] } } })
    await prisma.delinquencyStepRun.deleteMany({
      where: { leaseId: { in: [austinLeaseId, dallasLeaseId] } },
    })
    await prisma.leaseHold.deleteMany({ where: { leaseId: { in: [austinLeaseId, dallasLeaseId] } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId: { in: [austinId, dallasId] } } })
    await prisma.invoiceLineItem.deleteMany({
      where: { invoice: { facilityId: { in: [austinId, dallasId] } } },
    })
    await prisma.invoice.deleteMany({ where: { facilityId: { in: [austinId, dallasId] } } })
    await prisma.tenant.update({ where: { id: tenantId }, data: { activeDutyMilitary: null } })
  })

  it('covers every lease the tenant holds, at every facility', async () => {
    const { placed } = await declare()

    expect(placed).toHaveLength(2)
    expect(await leaseHasEffect(austinLeaseId, 'halt_dunning')).toBe(true)
    expect(await leaseHasEffect(dallasLeaseId, 'halt_dunning')).toBe(true)
    // The protection is about the person, so every effect the catalog declares
    // travels with it — not just the collections halt.
    expect(await leaseHasEffect(dallasLeaseId, 'block_auction')).toBe(true)
    expect(await leaseHasEffect(dallasLeaseId, 'halt_access_suspension')).toBe(true)
    expect(await leaseHasEffect(dallasLeaseId, 'halt_autopay')).toBe(true)
  })

  it('does nothing at all for a tenant who never declared', async () => {
    // The guard is in the function, not in its two callers. Every move-in in
    // the product runs this, so a version that trusted the caller would place
    // an SCRA hold on a civilian the first time somebody wired up a third call
    // site — freezing their autopay behind a manager-only lift.
    const untouched = await syncActiveDutyHolds(tenantId, 'checkout')
    expect(untouched.placed).toEqual([])
    expect(await prisma.leaseHold.count({ where: { leaseId: austinLeaseId } })).toBe(0)

    await prisma.tenant.update({ where: { id: tenantId }, data: { activeDutyMilitary: false } })
    const declined = await syncActiveDutyHolds(tenantId, 'checkout')
    expect(declined.placed).toEqual([])
  })

  it('records the hold as system-placed rather than attributing it to a person', async () => {
    await declare()

    const hold = await prisma.leaseHold.findFirstOrThrow({ where: { leaseId: austinLeaseId } })
    expect(hold.placedByStaffId).toBeNull()
    expect(hold.reason).toContain('declared active-duty military service')
  })

  it('is idempotent — a second move-in adds no second hold', async () => {
    await declare()
    const second = await syncActiveDutyHolds(tenantId, 'staff')

    expect(second.placed).toEqual([])
    expect(await prisma.leaseHold.count({ where: { leaseId: austinLeaseId } })).toBe(1)
  })

  it('places a fresh hold when a manager has lifted the previous one', async () => {
    await declare()
    const hold = await prisma.leaseHold.findFirstOrThrow({ where: { leaseId: austinLeaseId } })
    const lifted = await liftHold(actor(managerId, 20), hold.id, 'Service ended, orders sighted.')
    expect(lifted.ok).toBe(true)

    // A LIFTED hold must not suppress a new one: the tenant deploying again is
    // a new fact, not a repeat of the old one.
    const again = await syncActiveDutyHolds(tenantId, 'staff')
    expect(again.placed).toContain(austinLeaseId)
    expect(await leaseHasEffect(austinLeaseId, 'halt_dunning')).toBe(true)
  })

  it('keeps US-42’s manager requirement on the system-placed hold', async () => {
    await declare()
    const hold = await prisma.leaseHold.findFirstOrThrow({ where: { leaseId: austinLeaseId } })

    // A hold nobody placed is still a hold only a manager may lift — the
    // restriction is declared per TYPE in the catalog, so being system-placed
    // does not make it easier to remove than a hand-placed one.
    const refused = await liftHold(actor(counterId, 10), hold.id, 'Looks fine to me.')
    expect(refused).toEqual({ ok: false, reason: 'needs_manager' })
    expect(await leaseHasEffect(austinLeaseId, 'halt_dunning')).toBe(true)
  })

  describe('a delinquent lease under the hold', () => {
    it('produces no dunning step, no overlock and no auction case', async () => {
      // The row's own acceptance criterion, end to end through the real
      // nightly engine rather than through `evaluate` in isolation.
      const saved = await saveTimeline(actor(managerId, 20), austinId, {
        label: 'SCRA test',
        qualifyingAmount: 'full_balance',
        steps: [
          step(1, 'Late notice'),
          step(10, 'Overlock', {
            staffTaskLabel: 'Overlock the unit',
            requiredProofFields: ['lock_serial'],
          }),
        ],
      })
      // Asserted, not assumed. `saveTimeline` REFUSES by returning `{ok:false}`
      // rather than throwing, so a fixture the validator rejects leaves the
      // facility with no active timeline — and the engine then reports
      // `skippedNoTimeline` and zero of everything, which passes every
      // "nothing happened" assertion below for entirely the wrong reason.
      // Cost this test its first run.
      expect(saved.ok, JSON.stringify(saved)).toBe(true)

      await makeOverdue(austinId, austinLeaseId)
      // Placed BEFORE the simulated business date, which is the point: a hold
      // stamped `new Date()` would not be in force on 2026-07-15 and the
      // engine would correctly run every step.
      await declare(d('2026-06-01'))

      const result = await runDelinquencyTimeline(austinId, d('2026-07-15'), noop)

      expect(result.stepsExecuted).toBe(0)
      expect(result.halted).toBe(1)
      expect(await prisma.delinquencyStepRun.count({ where: { leaseId: austinLeaseId } })).toBe(0)
      expect(await prisma.unitOverlock.count({ where: { leaseId: austinLeaseId } })).toBe(0)
      expect(await prisma.auctionCase.count({ where: { leaseId: austinLeaseId } })).toBe(0)
    })

    it('refuses to approve a sale on a case opened before the hold went on', async () => {
      // The gap `block_auction` had until B-121. The engine halting first hides
      // it: no case can be OPENED under a hold, so the only way to reach this
      // state is the way it actually happens — the case exists, THEN the
      // tenant deploys and the declaration arrives.
      await makeOverdue(austinId, austinLeaseId)
      const opened = await openAuctionCase({ leaseId: austinLeaseId, facilityId: austinId })
      expect(opened?.created).toBe(true)

      await declare()

      const result = await approveAuction(
        // Rank 30 — an owner, so the refusal below is the hold and nothing else.
        { ...actor(managerId, 20), assignments: [{ ...actor(managerId, 20).assignments[0], rank: 30 }] },
        opened!.id,
        'management_approval',
      )
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain('SCRA')

      const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: opened!.id } })
      expect(row.approvedAt).toBeNull()
    })
  })

  describe('the staff path', () => {
    it('raises the hold across facilities the acting staffer cannot see', async () => {
      // Austin-only counter staffer. Dallas is outside their scope entirely,
      // and the Dallas lease is protected anyway — refusing to would leave
      // half a servicemember covered, and the SCRA does not work that way.
      const result = await updateTenantActiveDuty(actor(counterId, 10), tenantId, true)

      expect(result.heldLeases).toBe(2)
      expect(await leaseHasEffect(dallasLeaseId, 'halt_dunning')).toBe(true)
    })

    it('recording “no” corrects the flag but never lifts a hold', async () => {
      await updateTenantActiveDuty(actor(counterId, 10), tenantId, true)

      await updateTenantActiveDuty(actor(counterId, 10), tenantId, false)

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      expect(tenant.activeDutyMilitary).toBe(false)
      // The asymmetry that keeps US-42 honest: unticking a box must not be a
      // way around the manager-only lift.
      expect(await leaseHasEffect(austinLeaseId, 'halt_dunning')).toBe(true)
    })
  })

  describe('the checkout declaration', () => {
    it('upgrades a tenant already on file as not active-duty', async () => {
      // The bug this found. `existing ?? input` reads `false ?? true` as
      // `false`, so a returning renter who had NOT ticked the box the first
      // time — which stores false, not null — had their new declaration
      // validated, written to the session, and then silently discarded.
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { activeDutyMilitary: false },
      })

      await recordLeaseDeclarations(tenantId, { activeDutyMilitary: true })

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      expect(tenant.activeDutyMilitary).toBe(true)
    })

    it('never lets an unticked box clear a declaration already on file', async () => {
      await prisma.tenant.update({ where: { id: tenantId }, data: { activeDutyMilitary: true } })

      await recordLeaseDeclarations(tenantId, { activeDutyMilitary: false })

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      expect(tenant.activeDutyMilitary).toBe(true)
    })
  })
})
