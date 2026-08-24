import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  confirmOverlockApplied,
  releaseOverlock,
  releaseStuckOverlocks,
  requestOverlock,
} from '../apps/web/lib/delinquency/overlock'
import { completeTask } from '../apps/web/lib/admin/tasks'
import { restoreAccessIfSettled } from '../apps/web/lib/access/delinquency-gate'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-058 / PRD 03 US-3, PRD 02 US-25, against real rows.
//
// The status `overlocked` has existed in the enum since B-010 with nothing
// producing it — `occupancyFactsForMany` said so and named this item. These
// assert the whole chain: asked for, fitted, derived, released.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''
let tenantId = ''
let leaseId = ''
let unitId = ''

function actor(): Actor {
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

describeDb('overlocks', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Overlock ${suffix}`,
        slug: `overlock-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `ol-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
    const tenant = await prisma.tenant.create({
      data: { email: `ol-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `O-${suffix.slice(0, 4)}` },
    })
    unitId = unit.id
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId,
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.unitOverlock.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.unit.update({ where: { id: unitId }, data: { status: 'occupied' } })
    // B-169. The sweep's tests END the lease, and one shared lease row is the
    // fixture for the whole file — without this reset, "leaves a live lease
    // alone" inherits the previous test's `ended` and passes or fails on the
    // order the file happens to run in.
    await prisma.lease.update({
      where: { id: leaseId },
      data: { status: 'active', moveOutReason: null },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.unitOverlock.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('asks for a lock without pretending one is on', async () => {
    const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
    expect(requested).not.toBeNull()

    const task = await prisma.task.findFirstOrThrow({
      where: { facilityId, type: 'overlock_apply' },
    })
    expect(task.priority).toBe('high')

    // A unit whose status flipped on the REQUEST would read as locked while the
    // lock was still in the office.
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
    expect(unit.status).toBe('occupied')
  })

  it('is idempotent — a replayed step asks once (US-3 AC4)', async () => {
    await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
    const second = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })

    expect(second).toBeNull()
    expect(await prisma.unitOverlock.count({ where: { leaseId } })).toBe(1)
    expect(await prisma.task.count({ where: { facilityId, type: 'overlock_apply' } })).toBe(1)
  })

  it('makes the unit overlocked only once staff confirm they fitted it', async () => {
    const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
    await confirmOverlockApplied(actor(), requested!.overlockId)

    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
    // The status that had no producer until this item.
    expect(unit.status).toBe('overlocked')
  })

  it('requires a photo before the task can be completed', async () => {
    const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })

    // US-25 calls the photo optional; US-28's evidence rules for the sale it
    // leads to do not, and a lock nobody photographed is one a tenant can say
    // was never fitted.
    const missing = await completeTask(actor(), requested!.taskId, { note: 'Fitted it' })
    expect(missing).toEqual({ ok: false, missingFields: ['photo_reference'] })

    const done = await completeTask(actor(), requested!.taskId, {
      note: 'Fitted it',
      photo_reference: 'photo-123',
    })
    expect(done).toEqual({ ok: true })

    // Completing the task IS the event that the lock went on.
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
    expect(unit.status).toBe('overlocked')
  })

  describe('release on cure', () => {
    it('queues removal when a lock is actually on', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)

      const released = await releaseOverlock({ leaseId, facilityId })
      expect(released.taskId).not.toBeNull()
      expect(released.withdrawn).toBe(false)

      // Still overlocked until somebody goes and takes it off — paying does not
      // physically remove a lock.
      const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
      expect(unit.status).toBe('overlocked')
    })

    it('withdraws a request that was never fitted rather than sending anyone', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })

      const released = await releaseOverlock({ leaseId, facilityId })
      expect(released.withdrawn).toBe(true)
      expect(released.taskId).toBeNull()

      // The request is cancelled, not left open for somebody to action after
      // the tenant has already paid.
      const task = await prisma.task.findUniqueOrThrow({ where: { id: requested!.taskId } })
      expect(task.status).toBe('cancelled')
    })

    it('returns the unit to occupied when staff confirm removal', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)
      const released = await releaseOverlock({ leaseId, facilityId })

      await completeTask(actor(), released.taskId!, { note: 'Took it off' })

      const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
      expect(unit.status).toBe('occupied')
    })

    it('keeps the removed lock as history rather than deleting it', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)
      const released = await releaseOverlock({ leaseId, facilityId })
      await completeTask(actor(), released.taskId!, { note: 'Took it off' })

      // "Was this unit locked on the day of the sale" is a question an auction
      // turns on, so the row stays with both timestamps.
      const row = await prisma.unitOverlock.findUniqueOrThrow({ where: { id: requested!.overlockId } })
      expect(row.appliedAt).not.toBeNull()
      expect(row.removedAt).not.toBeNull()
      expect(row.removedByStaffId).toBe(staffId)
    })

    it('asks for one removal however many times it is released (B-151)', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)

      // Curing called this exactly once, so a duplicate was impossible. B-151
      // added three lease-ending callers AND a nightly backstop, and
      // `createTask` is unique per (type, entityId, businessDate) — so without
      // the guard this raises a fresh removal task every morning until somebody
      // takes the lock off.
      const first = await releaseOverlock({ leaseId, facilityId })
      const second = await releaseOverlock({ leaseId, facilityId })
      const third = await releaseOverlock({ leaseId, facilityId })

      expect(first.taskId).not.toBeNull()
      expect(second.taskId).toBe(first.taskId)
      expect(third.taskId).toBe(first.taskId)
      expect(
        await prisma.task.count({ where: { facilityId, type: 'overlock_remove' } }),
      ).toBe(1)
    })

    // B-169. The card used to assert "the tenant has paid" on every path,
    // including the two where their goods had just been sold or the unit
    // recorded as abandoned.
    it('states the actual reason on the card rather than asserting a payment', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)

      const released = await releaseOverlock({ leaseId, facilityId, reason: 'auction_sold' })
      const task = await prisma.task.findUniqueOrThrow({ where: { id: released.taskId! } })
      expect(task.detail).toContain('sold at auction')
      expect(task.detail).toContain('has not paid')

      // And the lock itself records why it came off — "was this removed
      // because they paid or because we sold their things" is a question the
      // record has to answer on its own.
      const row = await prisma.unitOverlock.findUniqueOrThrow({
        where: { id: requested!.overlockId },
      })
      expect(row.removalReason).toBe('auction_sold')
    })

    it('still says the tenant paid when they did', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)

      const released = await releaseOverlock({ leaseId, facilityId, reason: 'cured' })
      const task = await prisma.task.findUniqueOrThrow({ where: { id: released.taskId! } })
      expect(task.detail).toBe('The tenant has paid.')
    })

    it('allows a fresh lock on the same unit after one was removed', async () => {
      const first = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), first!.overlockId)
      const released = await releaseOverlock({ leaseId, facilityId })
      await completeTask(actor(), released.taskId!, { note: 'Off' })

      // The unique index is partial on `removedAt IS NULL`, so history does not
      // block a second delinquency.
      const second = await requestOverlock({ leaseId, facilityId, reason: 'Overlock again' })
      expect(second).not.toBeNull()
      expect(await prisma.unitOverlock.count({ where: { leaseId } })).toBe(2)
    })
  })

  it('restores access the moment the balance clears — US-3 AC2', async () => {
    const grant = await prisma.accessGrant.create({
      data: { facilityId, tenantId, state: 'suspended', stateCause: 'system:delinquency' },
    })

    // Nothing owed, so the inline restore path applies. The SLA in AC2 is about
    // this being a direct call rather than a nightly sweep — measured here as
    // "one call, done", not by timing a clock.
    const restored = await restoreAccessIfSettled(tenantId, facilityId)
    expect(restored).toBe(true)

    const after = await prisma.accessGrant.findUniqueOrThrow({ where: { id: grant.id } })
    expect(after.state).toBe('active')

    await prisma.accessGrant.deleteMany({ where: { id: grant.id } })
  })

  // B-169. B-151 put this backstop inside `runDelinquencyTimeline`, behind a
  // guard that returns early for a facility with no configured timeline — so
  // the sites most likely to have stuck locks were the only ones it could never
  // reach. It is its own job step now, and these are the properties that make
  // the move worth anything.
  describe('the stuck-lock sweep (B-169)', () => {
    it('releases a lock left on a lease that has ended', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })

      const result = await releaseStuckOverlocks(facilityId, () => {})
      expect(result.released).toBe(1)

      const task = await prisma.task.findFirstOrThrow({
        where: { facilityId, type: 'overlock_remove', entityId: leaseId },
      })
      expect(task.status).toBe('open')
      expect(task.detail).toContain('lease has ended')
    })

    it('runs for a facility with NO delinquency timeline — the whole point', async () => {
      // This fixture has never had one, which is why it is the right test:
      // `runDelinquencyTimeline` returns `skippedNoTimeline` before reaching
      // anything, and the units B-151 was built to free were exactly these.
      expect(
        await prisma.delinquencyTimeline.count({ where: { facilityId } }),
      ).toBe(0)

      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })

      expect((await releaseStuckOverlocks(facilityId, () => {})).released).toBe(1)
    })

    it('names an abandonment as an abandonment, from the lease’s own record', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)
      await prisma.lease.update({
        where: { id: leaseId },
        data: { status: 'ended', moveOutReason: 'abandonment' },
      })

      await releaseStuckOverlocks(facilityId, () => {})
      const task = await prisma.task.findFirstOrThrow({
        where: { facilityId, type: 'overlock_remove', entityId: leaseId },
      })
      expect(task.detail).toContain('abandoned')
    })

    it('withdraws a request nobody ever fitted rather than sending somebody', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })

      const result = await releaseStuckOverlocks(facilityId, () => {})
      expect(result).toEqual({ released: 0, withdrawn: 1 })
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: requested!.taskId } })).status,
      ).toBe('cancelled')
    })

    it('leaves a live lease alone, and re-running raises no second task', async () => {
      const requested = await requestOverlock({ leaseId, facilityId, reason: 'Overlock' })
      await confirmOverlockApplied(actor(), requested!.overlockId)

      expect((await releaseStuckOverlocks(facilityId, () => {})).released).toBe(0)

      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })
      await releaseStuckOverlocks(facilityId, () => {})
      await releaseStuckOverlocks(facilityId, () => {})
      expect(
        await prisma.task.count({ where: { facilityId, type: 'overlock_remove' } }),
      ).toBe(1)
    })
  })
})
