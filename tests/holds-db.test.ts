import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { DEFAULT_LATE_FEE_STEPS } from '../packages/core/billing'
import { activeHolds, leaseHasEffect, liftHold, placeHold } from '../apps/web/lib/admin/holds'
import { assessLateFees } from '../apps/web/lib/billing/late-fees'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-096 / PRD 02 §4.4 US-42. Holds against real rows, and the halts firing.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let unitTypeId = ''
let managerId = ''
let counterId = ''
let invoiceCounter = 0

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const collected: { itemId: string; ok: boolean; message?: string }[] = []
const recordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => {
  collected.push(outcome)
}

/// Rank 20 is manager, 10 is counter — the ranks the seeded roles use.
function actor(staffUserId: string, rank: number): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId,
        roleKey: rank >= 20 ? 'manager' : 'counter',
        rank,
        permissions: new Set<PermissionKey>(['tenants:view', 'tenants:edit']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('lease holds', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Hold Test',
        slug: `hold-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `hold-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const [manager, counter] = await Promise.all([
      prisma.staffUser.create({
        data: { email: `hold-mgr-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
      }),
      prisma.staffUser.create({
        data: { email: `hold-ctr-${suffix}@example.com`, firstName: 'Cal', lastName: 'Counter' },
      }),
    ])
    managerId = manager.id
    counterId = counter.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'H-1' } })
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
  })

  afterEach(async () => {
    collected.length = 0
    await prisma.leaseHold.deleteMany({ where: { leaseId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lateFeeRule.deleteMany({ where: { facilityId } })
    await prisma.invoiceCounter.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  describe('placing', () => {
    it('records the hold with its reason and who placed it, and audits it', async () => {
      const result = await placeHold(actor(counterId, 10), leaseId, {
        type: 'military_scra',
        reason: 'Deployment orders received by phone from the tenant.',
      })
      expect(result).toMatchObject({ ok: true })

      const [hold] = await activeHolds(leaseId)
      expect(hold.label).toBe('Military (SCRA)')
      expect(hold.placedByName).toBe('Cal Counter')
      expect(hold.reason).toContain('Deployment orders')

      // Scoped to THIS hold, not just this lease. `audit_log` is append-only
      // and never cleaned between tests, so several tests in this file leave
      // `hold.placed` rows on the same lease — an unordered `findFirst` picked
      // an arbitrary one and passed on luck.
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'hold.placed',
          entityId: leaseId,
          after: { path: ['holdId'], equals: result.ok ? result.holdId : '' },
        },
      })
      // The reason code carries the TYPE, which is what makes "how many SCRA
      // holds did we place last year" answerable.
      expect(audit.reasonCode).toBe('military_scra')
    })

    it('lets counter staff place one — the person taking the call', async () => {
      // US-42 restricts LIFTING, not placing. The staffer who takes the call
      // from a deploying servicemember is exactly who should stop collections.
      const result = await placeHold(actor(counterId, 10), leaseId, {
        type: 'bankruptcy',
        reason: 'Chapter 7 notice received.',
      })
      expect(result).toMatchObject({ ok: true })
    })

    it('refuses without a reason', async () => {
      const result = await placeHold(actor(managerId, 20), leaseId, {
        type: 'dispute',
        reason: '   ',
      })
      expect(result).toMatchObject({ ok: false, reason: 'missing_reason' })
    })

    it('refuses an unknown type', async () => {
      const result = await placeHold(actor(managerId, 20), leaseId, {
        type: 'made_up',
        reason: 'x',
      })
      expect(result).toMatchObject({ ok: false, reason: 'unknown_type' })
    })

    it('insists on an estate contact for a deceased tenant', async () => {
      // The whole point of the type is that there is somebody else to talk to.
      const without = await placeHold(actor(managerId, 20), leaseId, {
        type: 'deceased',
        reason: 'Daughter called.',
      })
      expect(without).toMatchObject({ ok: false, reason: 'missing_estate_contact' })

      const withContact = await placeHold(actor(managerId, 20), leaseId, {
        type: 'deceased',
        reason: 'Daughter called.',
        estateContactName: 'Jo Renter',
        estateContactPhone: '512-555-0180',
      })
      expect(withContact).toMatchObject({ ok: true })

      const [hold] = await activeHolds(leaseId)
      expect(hold.estateContactName).toBe('Jo Renter')
    })

    it('allows two concurrent holds and reports both', async () => {
      await placeHold(actor(managerId, 20), leaseId, { type: 'dispute', reason: 'Disputes the fee.' })
      await placeHold(actor(managerId, 20), leaseId, { type: 'do_not_contact', reason: 'Asked us not to call.' })

      expect(await activeHolds(leaseId)).toHaveLength(2)
    })
  })

  describe('lifting', () => {
    it('needs a manager for an SCRA hold, and says so rather than failing quietly', async () => {
      const placed = await placeHold(actor(counterId, 10), leaseId, {
        type: 'military_scra',
        reason: 'Deployment orders.',
      })
      if (!placed.ok) throw new Error('setup failed')

      const byCounter = await liftHold(actor(counterId, 10), placed.holdId, 'Tenant returned.')
      expect(byCounter).toMatchObject({ ok: false, reason: 'needs_manager' })
      expect(await activeHolds(leaseId)).toHaveLength(1)

      const byManager = await liftHold(actor(managerId, 20), placed.holdId, 'Tenant returned, orders ended.')
      expect(byManager).toMatchObject({ ok: true })
      expect(await activeHolds(leaseId)).toHaveLength(0)
    })

    it('lets counter staff lift a hold that does not declare the restriction', async () => {
      const placed = await placeHold(actor(counterId, 10), leaseId, {
        type: 'dispute',
        reason: 'Disputes the late fee.',
      })
      if (!placed.ok) throw new Error('setup failed')

      expect(await liftHold(actor(counterId, 10), placed.holdId, 'Resolved.')).toMatchObject({ ok: true })
    })

    it('refuses without a reason, and refuses twice', async () => {
      const placed = await placeHold(actor(managerId, 20), leaseId, {
        type: 'dispute',
        reason: 'Disputes the fee.',
      })
      if (!placed.ok) throw new Error('setup failed')

      expect(await liftHold(actor(managerId, 20), placed.holdId, '  ')).toMatchObject({
        ok: false,
        reason: 'missing_reason',
      })
      await liftHold(actor(managerId, 20), placed.holdId, 'Resolved.')
      expect(await liftHold(actor(managerId, 20), placed.holdId, 'Again.')).toMatchObject({
        ok: false,
        reason: 'already_lifted',
      })
    })

    it('audits the lift with its reason', async () => {
      const placed = await placeHold(actor(managerId, 20), leaseId, {
        type: 'dispute',
        reason: 'Disputes the fee.',
      })
      if (!placed.ok) throw new Error('setup failed')
      await liftHold(actor(managerId, 20), placed.holdId, 'Credit issued, dispute closed.')

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: {
          action: 'hold.lifted',
          entityId: leaseId,
          after: { path: ['holdId'], equals: placed.holdId },
        },
      })
      expect(audit.actorStaffId).toBe(managerId)
    })
  })

  describe('the effects actually fire', () => {
    it('halts late-fee assessment', async () => {
      for (const step of DEFAULT_LATE_FEE_STEPS) {
        await prisma.lateFeeRule.create({ data: { facilityId, ...step, effectiveFrom: d('2020-01-01') } })
      }
      invoiceCounter += 1
      await prisma.invoice.create({
        data: {
          facilityId,
          leaseId,
          number: `HD${String(invoiceCounter).padStart(5, '0')}`,
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

      await placeHold(actor(managerId, 20), leaseId, {
        type: 'payment_plan',
        reason: 'Agreed $50/week until clear.',
      })
      await assessLateFees(facilityId, d('2026-09-30'), recordItem)

      expect(await prisma.invoice.count({ where: { leaseId, kind: 'fee' } })).toBe(0)
      expect(collected[0]?.message).toContain('on hold')
    })

    it('reports the effects a consumer asks about', async () => {
      await placeHold(actor(managerId, 20), leaseId, {
        type: 'bankruptcy',
        reason: 'Chapter 7 notice received.',
      })

      // The questions B-098, B-052 and the billing runs each ask.
      expect(await leaseHasEffect(leaseId, 'halt_access_suspension')).toBe(true)
      expect(await leaseHasEffect(leaseId, 'halt_autopay')).toBe(true)
      expect(await leaseHasEffect(leaseId, 'block_auction')).toBe(true)
    })

    it('stops reporting them once the hold is lifted', async () => {
      const placed = await placeHold(actor(managerId, 20), leaseId, {
        type: 'bankruptcy',
        reason: 'Chapter 7 notice received.',
      })
      if (!placed.ok) throw new Error('setup failed')
      await liftHold(actor(managerId, 20), placed.holdId, 'Discharged; counsel confirmed.')

      expect(await leaseHasEffect(leaseId, 'halt_autopay')).toBe(false)
    })

    it('does not leak a hold from one lease to another', async () => {
      const otherUnit = await prisma.unit.create({
        data: { facilityId, unitTypeId, number: `H-${randomUUID().slice(0, 4)}` },
      })
      const otherLease = await prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: otherUnit.id,
          status: 'active',
          startDate: d('2026-08-01'),
          billingDay: 1,
          monthlyRateCents: 12_900,
        },
      })

      await placeHold(actor(managerId, 20), leaseId, {
        type: 'bankruptcy',
        reason: 'Chapter 7 notice received.',
      })

      // A tenant with two units may be protected on one and not the other —
      // the hold is on the lease, not the person.
      expect(await leaseHasEffect(otherLease.id, 'halt_autopay')).toBe(false)

      await prisma.lease.delete({ where: { id: otherLease.id } })
      await prisma.unit.delete({ where: { id: otherUnit.id } })
    })
  })
})
