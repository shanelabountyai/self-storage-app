import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  cancelMoveOutRequest,
  MAX_MOVE_OUT_DAYS_AHEAD,
  previewTenantMoveOut,
  requestMoveOut,
  tenantMoveOutLeases,
} from '../apps/web/lib/portal/move-out'
import { completeMoveOut, previewMoveOut } from '../apps/web/lib/admin/move-out'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-041 / PRD 01 US-707; PRD 02 US-14, US-41.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

// B-174. Relative to the real clock, because the preview is now bounded by it.
// A fixed calendar date in a test that used to be unbounded is a suite that
// goes red on a date nobody chose — the trap CLAUDE.md records for quiet-hours
// messaging, one module over.
const daysFromToday = (days: number): Date => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * 86_400_000)
}

let facilityId = ''
let tenantId = ''
let otherTenantId = ''
let staffId = ''

function managerActor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['tenants:view', 'leases:move_out']),
        limits: { maxFeeWaiverCents: 5_000, maxRefundCents: 0, maxCreditCents: 5_000 },
      },
    ],
  }
}

async function makeLease(tenant: string, moveOutNoticeDays = 10) {
  const unitType = await prisma.unitType.create({
    data: { facilityId, name: `10x10 ${randomUUID().slice(0, 6)}`, widthFt: 10, lengthFt: 10 },
  })
  const unit = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: `U-${randomUUID().slice(0, 4)}` } })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: tenant,
      unitId: unit.id,
      status: 'active',
      startDate: d('2026-01-01'),
      monthlyRateCents: 12_900,
      billingDay: 1,
    },
  })
  return { leaseId: lease.id, unitId: unit.id, unitTypeId: unitType.id }
}

describeDb('portal move-out request', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Move-out Request Test ${suffix}`,
        slug: `mo-req-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        moveOutNoticeDays: 10,
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `mo-req-staff-${suffix}@example.com`, firstName: 'Mel', lastName: 'Manager' },
    })
    staffId = staff.id

    const [tenant, other] = await Promise.all([
      prisma.tenant.create({ data: { email: `mo-req-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' } }),
      prisma.tenant.create({ data: { email: `mo-req-other-${suffix}@example.com`, firstName: 'Bo', lastName: 'Other' } }),
    ])
    tenantId = tenant.id
    otherTenantId = other.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
    await prisma.$disconnect()
  })

  describe('tenantMoveOutLeases', () => {
    it('reports the minimum date the facility’s notice policy allows', async () => {
      const { leaseId } = await makeLease(tenantId)
      const [lease] = await tenantMoveOutLeases(tenantId)
      const expectedMin = new Date(Date.now())
      expectedMin.setUTCHours(0, 0, 0, 0)
      expectedMin.setUTCDate(expectedMin.getUTCDate() + 10)
      expect(lease.leaseId).toBe(leaseId)
      expect(lease.minMoveOutDate.toISOString().slice(0, 10)).toBe(expectedMin.toISOString().slice(0, 10))
      expect(lease.pendingMoveOutDate).toBeNull()

      await prisma.lease.delete({ where: { id: leaseId } })
    })
  })

  describe('previewTenantMoveOut', () => {
    it('settles against the tenant’s own lease', async () => {
      const { leaseId } = await makeLease(tenantId)
      await prisma.ledgerEntry.create({
        data: { facilityId, leaseId, type: 'charge', amountCents: 5_000, description: 'Rent' },
      })

      const result = await previewTenantMoveOut(tenantId, leaseId, daysFromToday(30))
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')
      expect(result.preview.balanceCents).toBe(5_000)
      expect(result.preview.settlement.amountDueCents).toBe(5_000)

      await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('refuses a lease that does not belong to this tenant', async () => {
      const { leaseId } = await makeLease(tenantId)
      const result = await previewTenantMoveOut(otherTenantId, leaseId, daysFromToday(30))
      expect(result).toEqual({ ok: false, reason: 'not_found' })
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    // B-174. The preview used to price ANY date and hand back figures — the
    // screen then dropped a refusal on the floor and rendered a blank where the
    // money had been, with "Request this move-out" still live beside it. Both
    // bounds are checked here now, so the screen has something to say.
    it('refuses a date short of the required notice instead of pricing it', async () => {
      const { leaseId } = await makeLease(tenantId)
      const result = await previewTenantMoveOut(tenantId, leaseId, daysFromToday(1))
      expect(result).toEqual({ ok: false, reason: 'date_too_soon' })
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('refuses a date past the ceiling instead of pricing it', async () => {
      const { leaseId } = await makeLease(tenantId)
      const result = await previewTenantMoveOut(tenantId, leaseId, daysFromToday(MAX_MOVE_OUT_DAYS_AHEAD + 1))
      expect(result).toEqual({ ok: false, reason: 'date_too_far_out' })
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    // The boundary itself: a year out to the day is inside the window. Pinned
    // because an off-by-one here refuses a tenant giving notice against the end
    // of a twelve-month term, which is the exact case the ceiling was sized for.
    it('accepts the last day of the window', async () => {
      const { leaseId } = await makeLease(tenantId)
      const result = await previewTenantMoveOut(tenantId, leaseId, daysFromToday(MAX_MOVE_OUT_DAYS_AHEAD))
      expect(result.ok).toBe(true)
      await prisma.lease.delete({ where: { id: leaseId } })
    })
  })

  describe('requestMoveOut', () => {
    it('schedules the lease, raises a verification task, and emits the request event', async () => {
      const { leaseId } = await makeLease(tenantId)
      const minDate = (await tenantMoveOutLeases(tenantId)).find((l) => l.leaseId === leaseId)!.minMoveOutDate

      const result = await requestMoveOut(tenantId, leaseId, minDate)
      expect(result).toEqual({ ok: true })

      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.status, 'still active — nothing is final yet').toBe('active')
      expect(lease.moveOutDate?.toISOString().slice(0, 10)).toBe(minDate.toISOString().slice(0, 10))
      expect(lease.moveOutReason).toBe('tenant_request')
      expect(lease.noticeGivenAt).toBeInstanceOf(Date)

      const task = await prisma.task.findFirstOrThrow({
        where: { type: 'move_out_request_review', entityId: leaseId },
      })
      expect(task.status).toBe('open')
      expect(task.facilityId).toBe(facilityId)

      const event = await prisma.domainEvent.findFirstOrThrow({
        where: { name: 'lease.move_out_requested', entityId: leaseId },
      })
      expect((event.payload as { moveOutDate: string }).moveOutDate).toBe(minDate.toISOString().slice(0, 10))

      await prisma.task.deleteMany({ where: { entityId: leaseId } })
      await prisma.domainEvent.deleteMany({ where: { entityId: leaseId } })
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('refuses a date short of the required notice', async () => {
      const { leaseId } = await makeLease(tenantId)
      const result = await requestMoveOut(tenantId, leaseId, d('2026-08-06')) // tomorrow-ish, well short of 10 days
      expect(result).toEqual({ ok: false, reason: 'date_too_soon' })
      expect((await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })).moveOutDate).toBeNull()
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    // B-174. The picker carries a `max` now, but that is the browser's and a
    // crafted post never renders the picker at all. This is the guard: without
    // it a move-out in 2031 was accepted, took the unit off the board for five
    // years and raised a staff task nobody would look at until 2031.
    it('refuses a date past the ceiling, and writes nothing', async () => {
      const { leaseId } = await makeLease(tenantId)
      const result = await requestMoveOut(tenantId, leaseId, daysFromToday(MAX_MOVE_OUT_DAYS_AHEAD + 1))
      expect(result).toEqual({ ok: false, reason: 'date_too_far_out' })
      expect((await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })).moveOutDate).toBeNull()
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('refuses a second request while one is already pending', async () => {
      const { leaseId } = await makeLease(tenantId)
      const minDate = (await tenantMoveOutLeases(tenantId)).find((l) => l.leaseId === leaseId)!.minMoveOutDate
      await requestMoveOut(tenantId, leaseId, minDate)

      const second = await requestMoveOut(tenantId, leaseId, minDate)
      expect(second).toEqual({ ok: false, reason: 'already_requested' })

      await prisma.task.deleteMany({ where: { entityId: leaseId } })
      await prisma.domainEvent.deleteMany({ where: { entityId: leaseId } })
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('refuses a lease belonging to someone else', async () => {
      const { leaseId } = await makeLease(tenantId)
      const result = await requestMoveOut(otherTenantId, leaseId, d('2027-01-01'))
      expect(result).toEqual({ ok: false, reason: 'not_found' })
      await prisma.lease.delete({ where: { id: leaseId } })
    })
  })

  // B-164 / D-85. B-137 closed this on the transfer screen and left the
  // identical hole one screen over: both scoped on `OCCUPYING_LEASE_STATUSES`,
  // which includes `pending_auction`. A tenant whose goods are being prepared
  // for sale could schedule their own move-out, unattended, by clicking twice.
  describe('the lien pipeline (B-164, D-85)', () => {
    async function lienLease() {
      const made = await makeLease(tenantId)
      await prisma.lease.update({ where: { id: made.leaseId }, data: { status: 'pending_auction' } })
      return made
    }

    it('lists the lease but marks it not schedulable', async () => {
      const { leaseId } = await lienLease()

      const [lease] = await tenantMoveOutLeases(tenantId)

      // LISTED, not hidden: a tenant with one unit who is told we see no unit
      // on their account has been told something false and has nowhere to go.
      expect(lease.leaseId).toBe(leaseId)
      expect(lease.schedulable).toBe(false)

      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('refuses the preview as lien_pipeline, never as not_found', async () => {
      const { leaseId } = await lienLease()

      const result = await previewTenantMoveOut(tenantId, leaseId, d('2026-12-01'))

      // The distinction is the whole point of the row: the lease is theirs and
      // it does exist, and `not_found` is the answer that produces an angry
      // call about a bug that is not one.
      expect(result).toEqual({ ok: false, reason: 'lien_pipeline' })

      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('refuses the request itself, so skipping the screen changes nothing', async () => {
      const { leaseId } = await lienLease()
      const minDate = new Date(Date.now() + 30 * 86_400_000)

      const result = await requestMoveOut(tenantId, leaseId, minDate)

      expect(result).toEqual({ ok: false, reason: 'lien_pipeline' })
      const after = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(after.moveOutDate).toBeNull()
      expect(after.noticeGivenAt).toBeNull()
      expect(
        await prisma.task.count({ where: { type: 'move_out_request_review', entityId: leaseId } }),
      ).toBe(0)

      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('still lets them cancel a request made before the pipeline opened', async () => {
      // Trapping a tenant with a scheduled move-out they cannot withdraw is a
      // worse outcome than the one this row is about, and cancelling moves
      // nobody's goods.
      const { leaseId } = await makeLease(tenantId)
      const minDate = (await tenantMoveOutLeases(tenantId)).find((l) => l.leaseId === leaseId)!
        .minMoveOutDate
      await requestMoveOut(tenantId, leaseId, minDate)
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'pending_auction' } })

      expect(await cancelMoveOutRequest(tenantId, leaseId)).toEqual({ ok: true })

      await prisma.task.deleteMany({ where: { entityId: leaseId } })
      await prisma.domainEvent.deleteMany({ where: { entityId: leaseId } })
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('leaves the staff move-out alone — D-85 settled that side the other way', async () => {
      const { leaseId } = await lienLease()

      // `previewMoveOut` returns the settlement directly — there is no refusal
      // to assert, which IS the assertion: the staff path is untouched.
      const preview = await previewMoveOut(managerActor(), leaseId, d('2026-12-01'))

      expect(preview.leaseId).toBe(leaseId)

      await prisma.lease.delete({ where: { id: leaseId } })
    })
  })

  describe('cancelMoveOutRequest', () => {
    it('clears the request and withdraws the task', async () => {
      const { leaseId } = await makeLease(tenantId)
      const minDate = (await tenantMoveOutLeases(tenantId)).find((l) => l.leaseId === leaseId)!.minMoveOutDate
      await requestMoveOut(tenantId, leaseId, minDate)

      const result = await cancelMoveOutRequest(tenantId, leaseId)
      expect(result).toEqual({ ok: true })

      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.status).toBe('active')
      expect(lease.moveOutDate).toBeNull()
      expect(lease.moveOutReason).toBeNull()
      expect(lease.noticeGivenAt).toBeNull()

      const task = await prisma.task.findFirstOrThrow({ where: { type: 'move_out_request_review', entityId: leaseId } })
      expect(task.status).toBe('cancelled')

      await prisma.task.deleteMany({ where: { entityId: leaseId } })
      await prisma.domainEvent.deleteMany({ where: { entityId: leaseId } })
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('refuses to cancel when nothing is scheduled', async () => {
      const { leaseId } = await makeLease(tenantId)
      const result = await cancelMoveOutRequest(tenantId, leaseId)
      expect(result).toEqual({ ok: false, reason: 'nothing_to_cancel' })
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('refuses to cancel once the move-out date has arrived', async () => {
      const { leaseId } = await makeLease(tenantId)
      // Written directly — a date this close could never pass the notice
      // policy through requestMoveOut, but a lease scheduled a while ago
      // and simply not yet finalized is exactly this state.
      await prisma.lease.update({
        where: { id: leaseId },
        data: { moveOutDate: new Date(Date.now() - 24 * 60 * 60 * 1000), moveOutReason: 'tenant_request' },
      })
      const result = await cancelMoveOutRequest(tenantId, leaseId)
      expect(result).toEqual({ ok: false, reason: 'too_late' })
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('refuses a lease belonging to someone else', async () => {
      const { leaseId } = await makeLease(tenantId)
      const result = await cancelMoveOutRequest(otherTenantId, leaseId)
      expect(result).toEqual({ ok: false, reason: 'not_found' })
      await prisma.lease.delete({ where: { id: leaseId } })
    })
  })

  describe('the admin move-out screen picks up a pending request', () => {
    it('shows the tenant-requested date in the preview', async () => {
      const { leaseId } = await makeLease(tenantId)
      const minDate = (await tenantMoveOutLeases(tenantId)).find((l) => l.leaseId === leaseId)!.minMoveOutDate
      await requestMoveOut(tenantId, leaseId, minDate)

      const preview = await previewMoveOut(managerActor(), leaseId, minDate)
      expect(preview.requestedMoveOutDate?.toISOString().slice(0, 10)).toBe(minDate.toISOString().slice(0, 10))

      await prisma.task.deleteMany({ where: { entityId: leaseId } })
      await prisma.domainEvent.deleteMany({ where: { entityId: leaseId } })
      await prisma.lease.delete({ where: { id: leaseId } })
    })

    it('completes the verification task when staff finalize the move-out', async () => {
      const { leaseId } = await makeLease(tenantId)
      const minDate = (await tenantMoveOutLeases(tenantId)).find((l) => l.leaseId === leaseId)!.minMoveOutDate
      await requestMoveOut(tenantId, leaseId, minDate)

      const result = await completeMoveOut(managerActor(), {
        leaseId,
        moveOutDate: minDate,
        reason: 'tenant_request',
      })
      expect(result.ok).toBe(true)

      const task = await prisma.task.findFirstOrThrow({ where: { type: 'move_out_request_review', entityId: leaseId } })
      expect(task.status).toBe('completed')
      expect(task.completedByStaffId).toBe(staffId)

      await prisma.task.deleteMany({ where: { entityId: leaseId } })
      await prisma.domainEvent.deleteMany({ where: { entityId: leaseId } })
      await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    })

    it('reports no pending request once the lease has ended', async () => {
      // The lease from the previous test is already ended; reload it fresh.
      const ended = await prisma.lease.findFirst({ where: { facilityId, status: 'ended' }, orderBy: { updatedAt: 'desc' } })
      expect(ended).not.toBeNull()
      const preview = await previewMoveOut(managerActor(), ended!.id, new Date())
      expect(preview.requestedMoveOutDate).toBeNull()
    })
  })
})
