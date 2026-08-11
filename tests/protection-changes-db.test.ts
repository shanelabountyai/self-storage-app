import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  applyDueProtectionChanges,
  cancelProtectionChange,
  protectionForTenant,
  scheduleProtectionChange,
  submitInsuranceProof,
} from '../apps/web/lib/protection/changes'

// B-104 / PRD 01 US-705, against real rows. The pure suite proves the rule;
// this proves the consequences — that the current period is never touched, that
// the change lands on the lease when the cycle comes round, and that a lease id
// in a form cannot reach somebody else's cover.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let otherTenantId = ''
let leaseId = ''
let otherLeaseId = ''

const BASIC_CENTS = 900
const STANDARD_CENTS = 1_200

function record() {
  const messages: string[] = []
  return {
    messages,
    fn: (outcome: { itemId: string; ok: boolean; message?: string }) => {
      if (outcome.message) messages.push(outcome.message)
    },
  }
}

describeDb('protection changes (US-705)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Protect ${suffix}`,
        slug: `protect-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        billingPolicy: 'anniversary',
      },
    })
    facilityId = facility.id

    for (const [tier, name, coverage, premium] of [
      ['basic', 'Basic', 200_000, BASIC_CENTS],
      ['standard', 'Standard', 300_000, STANDARD_CENTS],
      ['premium', 'Premium', 500_000, 1_800],
    ] as const) {
      await prisma.protectionPlan.create({
        data: {
          facilityId,
          tier,
          name,
          coverageCents: coverage,
          premiumCents: premium,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        },
      })
    }

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })

    const tenant = await prisma.tenant.create({
      data: { email: `pr-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const other = await prisma.tenant.create({
      data: { email: `pr-o-${suffix}@example.com`, firstName: 'Otto', lastName: 'Other' },
    })
    otherTenantId = other.id

    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `P-${suffix.slice(0, 4)}` },
    })
    const unit2 = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `P2-${suffix.slice(0, 4)}` },
    })

    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-06-12T00:00:00Z'),
        billingDay: 12,
        monthlyRateCents: 12_900,
        protectionPlanName: 'Basic',
        protectionCents: BASIC_CENTS,
      },
    })
    leaseId = lease.id

    const otherLease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId: otherTenantId,
        unitId: unit2.id,
        status: 'active',
        startDate: new Date('2026-06-12T00:00:00Z'),
        billingDay: 12,
        monthlyRateCents: 12_900,
        protectionPlanName: 'Basic',
        protectionCents: BASIC_CENTS,
      },
    })
    otherLeaseId = otherLease.id
  })

  beforeEach(async () => {
    await prisma.protectionChange.deleteMany({ where: { facilityId } })
    await prisma.protectionWaiver.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.lease.updateMany({
      where: { facilityId },
      data: {
        status: 'active',
        protectionPlanName: 'Basic',
        protectionCents: BASIC_CENTS,
        protectionWaivedAt: null,
      },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.protectionChange.deleteMany({ where: { facilityId } })
    await prisma.protectionWaiver.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.protectionPlan.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
    // Facility stays: `audit_log` RESTRICT-references it.
  })

  describe('scheduling', () => {
    it('schedules to the next billing period and leaves the lease alone today', async () => {
      const result = await scheduleProtectionChange({
        tenantId,
        leaseId,
        tier: 'standard',
        requestedAt: new Date('2026-08-20T12:00:00Z'),
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.effectiveFrom.toISOString()).toBe('2026-09-12T00:00:00.000Z')

      // The current period is untouched: prorating a premium mid-month is a
      // coverage question nobody wants to answer after a fire.
      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.protectionPlanName).toBe('Basic')
      expect(lease.protectionCents).toBe(BASIC_CENTS)
    })

    it('supersedes an earlier pending request rather than stacking them', async () => {
      await scheduleProtectionChange({ tenantId, leaseId, tier: 'standard' })
      await scheduleProtectionChange({ tenantId, leaseId, tier: 'premium' })

      const live = await prisma.protectionChange.findMany({
        where: { leaseId, appliedAt: null, cancelledAt: null },
      })
      expect(live).toHaveLength(1)
      expect(live[0].toPlanName).toBe('Premium')

      // The superseded row is kept, not deleted: "they asked to drop cover and
      // then changed their mind" is what a coverage dispute asks about.
      expect(await prisma.protectionChange.count({ where: { leaseId } })).toBe(2)
    })

    it('refuses a lease that is not the tenant’s', async () => {
      const result = await scheduleProtectionChange({ tenantId, leaseId: otherLeaseId, tier: 'standard' })
      expect(result).toEqual({ ok: false, reason: 'not_your_lease' })
      expect(await prisma.protectionChange.count({ where: { leaseId: otherLeaseId } })).toBe(0)
    })

    it('refuses to drop a paid plan with no current proof of cover', async () => {
      const result = await scheduleProtectionChange({ tenantId, leaseId, tier: null })
      expect(result).toEqual({ ok: false, reason: 'waiver_needs_proof' })
    })

    it('refuses to drop a paid plan on an EXPIRED policy', async () => {
      // An expired policy is not cover, and letting it justify dropping a plan
      // is the gap D-17 exists to close.
      await submitInsuranceProof({
        tenantId,
        leaseId,
        carrier: 'Old Mutual',
        policyNumber: 'X-1',
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      })
      expect(await scheduleProtectionChange({ tenantId, leaseId, tier: null })).toEqual({
        ok: false,
        reason: 'waiver_needs_proof',
      })
    })

    it('allows dropping the plan once current cover is on file', async () => {
      await submitInsuranceProof({
        tenantId,
        leaseId,
        carrier: 'State Farm',
        policyNumber: 'SF-99',
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      })
      const result = await scheduleProtectionChange({ tenantId, leaseId, tier: null })
      expect(result.ok).toBe(true)
    })

    it('can be called off before it takes effect', async () => {
      const scheduled = await scheduleProtectionChange({ tenantId, leaseId, tier: 'standard' })
      if (!scheduled.ok) throw new Error('unreachable')

      expect(await cancelProtectionChange({ tenantId, changeId: scheduled.changeId })).toEqual({
        ok: true,
      })
      expect(
        await prisma.protectionChange.count({ where: { leaseId, appliedAt: null, cancelledAt: null } }),
      ).toBe(0)
    })

    it('will not let one tenant cancel another’s change', async () => {
      const scheduled = await scheduleProtectionChange({ tenantId, leaseId, tier: 'standard' })
      if (!scheduled.ok) throw new Error('unreachable')

      expect(
        await cancelProtectionChange({ tenantId: otherTenantId, changeId: scheduled.changeId }),
      ).toEqual({ ok: false, reason: 'not_found' })
    })
  })

  describe('applying on the cycle', () => {
    it('does nothing before the effective date', async () => {
      await scheduleProtectionChange({
        tenantId,
        leaseId,
        tier: 'standard',
        requestedAt: new Date('2026-08-20T12:00:00Z'),
      })

      const log = record()
      const result = await applyDueProtectionChanges(
        facilityId,
        new Date('2026-09-11T00:00:00Z'),
        log.fn,
      )
      expect(result.applied).toBe(0)
      expect(
        (await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })).protectionCents,
      ).toBe(BASIC_CENTS)
    })

    it('moves the lease on the effective date', async () => {
      await scheduleProtectionChange({
        tenantId,
        leaseId,
        tier: 'standard',
        requestedAt: new Date('2026-08-20T12:00:00Z'),
      })

      const log = record()
      const result = await applyDueProtectionChanges(
        facilityId,
        new Date('2026-09-12T00:00:00Z'),
        log.fn,
      )
      expect(result.applied).toBe(1)

      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.protectionPlanName).toBe('Standard')
      expect(lease.protectionCents).toBe(STANDARD_CENTS)
    })

    it('is idempotent — a second run does not reapply', async () => {
      await scheduleProtectionChange({
        tenantId,
        leaseId,
        tier: 'standard',
        requestedAt: new Date('2026-08-20T12:00:00Z'),
      })
      const log = record()
      await applyDueProtectionChanges(facilityId, new Date('2026-09-12T00:00:00Z'), log.fn)
      const second = await applyDueProtectionChanges(
        facilityId,
        new Date('2026-09-13T00:00:00Z'),
        log.fn,
      )
      expect(second.applied).toBe(0)
    })

    it('marks the lease waived when the tenant moves to their own cover', async () => {
      await submitInsuranceProof({
        tenantId,
        leaseId,
        carrier: 'State Farm',
        policyNumber: 'SF-1',
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      })
      await scheduleProtectionChange({
        tenantId,
        leaseId,
        tier: null,
        requestedAt: new Date('2026-08-20T12:00:00Z'),
      })

      const log = record()
      await applyDueProtectionChanges(facilityId, new Date('2026-09-12T00:00:00Z'), log.fn)

      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.protectionCents).toBe(0)
      expect(lease.protectionPlanName).toBeNull()
      // D-17's lapse scan and the move-out settlement both read this.
      expect(lease.protectionWaivedAt).not.toBeNull()
    })

    it('cancels a change whose lease ended before it took effect', async () => {
      await scheduleProtectionChange({
        tenantId,
        leaseId,
        tier: 'standard',
        requestedAt: new Date('2026-08-20T12:00:00Z'),
      })
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })

      const log = record()
      const result = await applyDueProtectionChanges(
        facilityId,
        new Date('2026-09-12T00:00:00Z'),
        log.fn,
      )
      expect(result.skipped).toBe(1)
      expect(log.messages.some((message) => message.includes('lease has ended'))).toBe(true)

      const change = await prisma.protectionChange.findFirstOrThrow({ where: { leaseId } })
      expect(change.cancelledAt).not.toBeNull()
      expect(change.appliedAt).toBeNull()
    })

    it('applies at the repriced premium rather than refusing', async () => {
      // Unlike B-076's rate increase, which refuses when the figure moved after
      // approval: there an approver signed off on a specific delta, whereas
      // here the TENANT asked for a named level of cover and should get it at
      // whatever it now costs.
      await scheduleProtectionChange({
        tenantId,
        leaseId,
        tier: 'standard',
        requestedAt: new Date('2026-08-20T12:00:00Z'),
      })
      await prisma.lease.update({
        where: { id: leaseId },
        data: { protectionPlanName: 'Premium', protectionCents: 1_800 },
      })

      const log = record()
      const result = await applyDueProtectionChanges(
        facilityId,
        new Date('2026-09-12T00:00:00Z'),
        log.fn,
      )
      expect(result.applied).toBe(1)
      expect(
        (await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })).protectionCents,
      ).toBe(STANDARD_CENTS)
    })
  })

  describe('proof of the tenant’s own insurance', () => {
    it('records the details and raises a review task', async () => {
      await submitInsuranceProof({
        tenantId,
        leaseId,
        carrier: 'State Farm',
        policyNumber: 'SF-42',
        expiresAt: new Date('2027-05-01T00:00:00Z'),
      })

      const waiver = await prisma.protectionWaiver.findUniqueOrThrow({ where: { leaseId } })
      expect(waiver.carrier).toBe('State Farm')
      // `expiresAt` is the column D-17's nightly lapse scan reads — the
      // substantive part of "proof", and the part that works without a blob
      // store to keep the declaration page in.
      expect(waiver.expiresAt?.toISOString().slice(0, 10)).toBe('2027-05-01')

      const task = await prisma.task.findFirst({
        where: { facilityId, type: 'insurance_proof_review', entityId: leaseId },
      })
      expect(task).not.toBeNull()
    })

    it('replaces earlier details rather than adding a second record', async () => {
      await submitInsuranceProof({
        tenantId,
        leaseId,
        carrier: 'Old',
        policyNumber: 'O-1',
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      })
      await submitInsuranceProof({
        tenantId,
        leaseId,
        carrier: 'New',
        policyNumber: 'N-1',
        expiresAt: new Date('2028-01-01T00:00:00Z'),
      })

      const waivers = await prisma.protectionWaiver.findMany({ where: { leaseId } })
      expect(waivers).toHaveLength(1)
      expect(waivers[0].carrier).toBe('New')
    })

    it('clears a manager override when the tenant supplies real details', async () => {
      await prisma.protectionWaiver.create({
        data: {
          facilityId,
          leaseId,
          tenantId,
          overrideReason: 'accepted at the counter without a declaration page',
        },
      })
      await submitInsuranceProof({
        tenantId,
        leaseId,
        carrier: 'State Farm',
        policyNumber: 'SF-7',
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      })

      const waiver = await prisma.protectionWaiver.findUniqueOrThrow({ where: { leaseId } })
      // Leaving it would keep the row reading "accepted without evidence" after
      // evidence arrived.
      expect(waiver.overrideReason).toBeNull()
    })

    it('refuses a lease that is not the tenant’s', async () => {
      expect(
        await submitInsuranceProof({
          tenantId,
          leaseId: otherLeaseId,
          carrier: 'X',
          policyNumber: 'Y',
          expiresAt: new Date('2027-01-01T00:00:00Z'),
        }),
      ).toEqual({ ok: false, reason: 'not_your_lease' })
    })
  })

  describe('the portal view', () => {
    it('shows the current plan, the catalogue and any pending change', async () => {
      await scheduleProtectionChange({ tenantId, leaseId, tier: 'premium' })

      const [view] = await protectionForTenant(tenantId)
      expect(view.currentPlanName).toBe('Basic')
      expect(view.plans.map((plan) => plan.tier)).toEqual(['basic', 'standard', 'premium'])
      expect(view.pending?.toPlanName).toBe('Premium')
    })

    it('flags an expired policy, which is what D-17 auto-enrols on', async () => {
      await prisma.protectionWaiver.create({
        data: {
          facilityId,
          leaseId,
          tenantId,
          carrier: 'Lapsed Co',
          policyNumber: 'L-1',
          expiresAt: new Date('2020-01-01T00:00:00Z'),
        },
      })

      const [view] = await protectionForTenant(tenantId, new Date('2026-08-20T12:00:00Z'))
      expect(view.waiver?.expired).toBe(true)
    })

    it('shows only the tenant’s own units', async () => {
      const views = await protectionForTenant(tenantId)
      expect(views.map((view) => view.leaseId)).toEqual([leaseId])
    })
  })
})
