import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { businessDateFor } from '../packages/core/jobs'
import { scanExpiringProtectionProofs } from '../apps/web/lib/billing/scans'

// B-043's proof-of-insurance scan and D-17's enrolment on lapse.
//
// The card scan is not exercised here: it needs Stripe to know an expiry date
// and this project has no key outside production (same constraint B-035/B-036
// documented). Its day-maths is `reminderStage` + `cardExpiryDate`, and the
// first of those is unit-tested in schedule.test.ts against every boundary.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const CHICAGO = 'America/Chicago'

let facilityId = ''
let tenantId = ''
let unitTypeId = ''

/// A UTC-midnight business date `days` from today, in the facility's zone.
function businessDay(offsetDays: number): Date {
  const today = businessDateFor(new Date(), CHICAGO)
  return new Date(today.getTime() + offsetDays * 86_400_000)
}

let unitCounter = 0

/// A lease on the waiver path with a proof expiring on `expiresOn`.
async function leaseWithWaiver(expiresOn: Date): Promise<string> {
  unitCounter += 1
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `S-${unitCounter}` },
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
  await prisma.protectionWaiver.create({
    data: {
      facilityId,
      leaseId: lease.id,
      tenantId,
      carrier: 'State Farm',
      policyNumber: 'POL-1',
      // Midday, so the facility-local calendar day is unambiguous either side
      // of the UTC offset.
      expiresAt: new Date(expiresOn.getTime() + 12 * 3_600_000),
    },
  })
  return lease.id
}

const collected: { itemId: string; ok: boolean; message?: string }[] = []
const recordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => {
  collected.push(outcome)
}

async function setPolicy(autoEnrol: boolean, tier: string | null): Promise<void> {
  await prisma.facility.update({
    where: { id: facilityId },
    data: { autoEnrolProtectionOnLapse: autoEnrol, defaultProtectionTier: tier },
  })
}

describeDb('protection proof scan', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Scan Test ${suffix}`,
        slug: `scan-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: CHICAGO,
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `scan-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id

    await prisma.protectionPlan.create({
      data: {
        facilityId,
        tier: 'standard',
        name: 'Standard cover',
        coverageCents: 200_000,
        premiumCents: 1_400,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      },
    })
  })

  afterEach(async () => {
    collected.length = 0
    await prisma.task.deleteMany({ where: { facilityId } })
    // AuditLog is append-only at the database level and deliberately not
    // cleaned up here — every assertion below is scoped to its own lease id.
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.protectionWaiver.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await setPolicy(false, null)
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.protectionPlan.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    // The facility itself stays: an append-only audit_log row references it
    // under RESTRICT, which is the point of an audit trail. Same as the other
    // DB suites, which all leave their fixture facility behind.
    await prisma.$disconnect()
  })

  it('says nothing about a proof that is more than 30 days out', async () => {
    await leaseWithWaiver(businessDay(45))
    await scanExpiringProtectionProofs(facilityId, businessDay(0), recordItem)

    expect(collected).toHaveLength(0)
    expect(await prisma.domainEvent.count({ where: { facilityId } })).toBe(0)
  })

  it('emits the 30-day notice once, not on every night in the window', async () => {
    await leaseWithWaiver(businessDay(20))

    await scanExpiringProtectionProofs(facilityId, businessDay(0), recordItem)
    await scanExpiringProtectionProofs(facilityId, businessDay(1), recordItem)
    await scanExpiringProtectionProofs(facilityId, businessDay(2), recordItem)

    const events = await prisma.domainEvent.findMany({
      where: { facilityId, name: 'protection.proof_expiring' },
    })
    expect(events).toHaveLength(1)
    expect(collected).toHaveLength(1)
  })

  it('notices a renewed policy rather than treating the waiver as already told', async () => {
    const leaseId = await leaseWithWaiver(businessDay(20))
    await scanExpiringProtectionProofs(facilityId, businessDay(0), recordItem)

    // The tenant renews: the same waiver row, a new expiry a year out.
    await prisma.protectionWaiver.updateMany({
      where: { leaseId },
      data: { expiresAt: new Date(businessDay(385).getTime() + 12 * 3_600_000) },
    })
    // A year later, the new expiry is 20 days away again.
    await scanExpiringProtectionProofs(facilityId, businessDay(365), recordItem)

    const events = await prisma.domainEvent.findMany({
      where: { facilityId, name: 'protection.proof_expiring' },
    })
    expect(events).toHaveLength(2)
  })

  it('raises one high-priority task on lapse, and does not raise a second one the next night', async () => {
    const leaseId = await leaseWithWaiver(businessDay(-1))

    await scanExpiringProtectionProofs(facilityId, businessDay(0), recordItem)
    await scanExpiringProtectionProofs(facilityId, businessDay(1), recordItem)

    const tasks = await prisma.task.findMany({ where: { entityId: leaseId } })
    expect(tasks).toHaveLength(1)
    expect(tasks[0].type).toBe('insurance_proof_lapsed')
    expect(tasks[0].priority).toBe('high')
  })

  it('charges nothing when the facility has not turned auto-enrolment on', async () => {
    const leaseId = await leaseWithWaiver(businessDay(-1))
    await scanExpiringProtectionProofs(facilityId, businessDay(0), recordItem)

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
    expect(lease.protectionPlanName).toBeNull()
    expect(lease.protectionCents).toBe(0)
    expect(await prisma.domainEvent.count({ where: { facilityId, name: 'protection.auto_enrolled' } })).toBe(0)
  })

  it('enrols into the default tier on lapse when the facility says so, and audits it', async () => {
    await setPolicy(true, 'standard')
    const leaseId = await leaseWithWaiver(businessDay(-1))

    await scanExpiringProtectionProofs(facilityId, businessDay(0), recordItem)

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
    expect(lease.protectionPlanName).toBe('Standard cover')
    expect(lease.protectionCents).toBe(1_400)

    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { facilityId, name: 'protection.auto_enrolled' },
    })
    // The tenant has to be told what they are now paying (D-17), which means
    // the premium travels on the event rather than being looked up later.
    expect((event.payload as { premiumCents: number }).premiumCents).toBe(1_400)

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'lease.protection_auto_enrolled', entityId: leaseId },
    })
    expect(audit.actorType).toBe('system')
  })

  it('does not enrol the same lease twice', async () => {
    await setPolicy(true, 'standard')
    await leaseWithWaiver(businessDay(-1))

    await scanExpiringProtectionProofs(facilityId, businessDay(0), recordItem)
    await scanExpiringProtectionProofs(facilityId, businessDay(1), recordItem)

    expect(await prisma.domainEvent.count({ where: { facilityId, name: 'protection.auto_enrolled' } })).toBe(1)
  })

  it('refuses to guess a price when the configured tier is not on sale', async () => {
    await setPolicy(true, 'platinum')
    const leaseId = await leaseWithWaiver(businessDay(-1))

    await scanExpiringProtectionProofs(facilityId, businessDay(0), recordItem)

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
    expect(lease.protectionCents).toBe(0)
    expect(collected[0].message).toContain('not on sale')
    // The task is still there, so a person picks rather than nothing happening.
    expect(await prisma.task.count({ where: { entityId: leaseId } })).toBe(1)
  })

  it('leaves an ended lease alone', async () => {
    const leaseId = await leaseWithWaiver(businessDay(-1))
    await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })

    await scanExpiringProtectionProofs(facilityId, businessDay(0), recordItem)

    expect(collected).toHaveLength(0)
    expect(await prisma.task.count({ where: { entityId: leaseId } })).toBe(0)
  })

  it('leaves a lease that already carries a plan alone', async () => {
    await setPolicy(true, 'standard')
    const leaseId = await leaseWithWaiver(businessDay(-1))
    await prisma.lease.update({
      where: { id: leaseId },
      data: { protectionPlanName: 'Standard cover', protectionCents: 1_400 },
    })

    await scanExpiringProtectionProofs(facilityId, businessDay(0), recordItem)

    expect(collected).toHaveLength(0)
  })
})
