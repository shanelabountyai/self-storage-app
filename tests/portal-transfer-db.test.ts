import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { completeTransfer, previewTransfer, transferTargets } from '../apps/web/lib/admin/transfer'
import {
  cancelTransferRequest,
  previewTenantTransfer,
  requestTransfer,
  tenantTransferLeases,
  transferOptionsFor,
} from '../apps/web/lib/portal/transfer'
import { recomputeUnitStatus } from '../apps/web/lib/admin/units'
import { expireReservations } from '../apps/web/lib/reservations/reserve'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-090 part 2 / PRD 01 §9, against real rows.
//
// The properties worth a database, none of which a unit test would catch:
//
//   * the ask holds the unit and does NOT touch the lease — the tenant keeps
//     their unit, their rate and their access until a person completes it;
//   * that hold does not lock staff out of the transfer it exists to set up
//     (the hold makes the unit `reserved`, and `previewTransfer` refuses
//     anything that is not `available` — the one exception this item added);
//   * the exception is scoped to the tenant it is held for, so one tenant's
//     request cannot let another transfer into the same unit;
//   * completing converts the hold rather than leaving it held, because the
//     partial unique index allows one held reservation per unit and a stale
//     one would block the next tenant who wants it.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let smallTypeId = ''
let largeTypeId = ''
let managerId = ''
let tenantId = ''
let otherTenantId = ''

const sends: { to: string; subject: string; body: string }[] = []

function fakeProvider(): provider.MessageProvider {
  return {
    name: 'test',
    async sendEmail(email) {
      sends.push({ to: email.to, subject: email.subject ?? '', body: email.text ?? '' })
      return { ok: true, providerMessageId: `test_${sends.length}` }
    },
  }
}

function manager(): Actor {
  return {
    kind: 'staff',
    staffUserId: managerId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['leases:transfer', 'tenants:view', 'units:edit'] as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/// Today at UTC midnight. The request refuses a date in the past, so every
/// case here is anchored to the day the suite runs rather than to a literal —
/// a fixed date would start failing the morning after it was written.
function today(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function daysFromToday(days: number): Date {
  return new Date(today().getTime() + days * 24 * 60 * 60 * 1000)
}

let unitCounter = 0
async function makeUnit(unitTypeId: string) {
  unitCounter += 1
  return prisma.unit.create({
    data: { facilityId, unitTypeId, number: `P-${suffix.slice(0, 4)}-${unitCounter}`, status: 'available' },
  })
}

/// `Unit.status` is derived, never set (B-010), and a raw `lease.create` does
/// not derive it — so the fixture recomputes, or every unit here would sit at
/// `available` while a lease was live on it and the assertions below would be
/// asserting against a state production never reaches.
async function makeLease(unitId: string, forTenantId = tenantId, monthlyRateCents = 10_000) {
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: forTenantId,
      unitId,
      status: 'active',
      startDate: d('2026-01-01'),
      billingDay: 1,
      monthlyRateCents,
      // Far enough out that the unused-remainder credit is always live, so
      // these cases exercise the money path rather than skipping it.
      paidThroughDate: daysFromToday(400),
    },
  })
  await recomputeUnitStatus(unitId)
  return lease
}

describeDb('portal transfer request (B-090 part 2)', () => {
  beforeAll(async () => {
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Portal transfer ${suffix}`,
        slug: `portal-transfer-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
        billingPolicy: 'first_of_month',
        prorateOnMoveOut: true,
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `pt-mgr-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    managerId = staff.id

    const [tenant, other] = await Promise.all([
      prisma.tenant.create({
        data: { email: `pt-${suffix}@example.com`, firstName: 'Ada', lastName: 'Portal' },
      }),
      prisma.tenant.create({
        data: { email: `pt-other-${suffix}@example.com`, firstName: 'Bo', lastName: 'Other' },
      }),
    ])
    tenantId = tenant.id
    otherTenantId = other.id

    const [small, large] = await Promise.all([
      prisma.unitType.create({ data: { facilityId, name: `5x5 ${suffix}`, widthFt: 5, lengthFt: 5 } }),
      prisma.unitType.create({ data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 } }),
    ])
    smallTypeId = small.id
    largeTypeId = large.id

    await prisma.unitTypeRate.createMany({
      data: [
        { facilityId, unitTypeId: smallTypeId, streetRateCents: 10_000, webRateCents: 10_000, effectiveFrom: d('2020-01-01') },
        { facilityId, unitTypeId: largeTypeId, streetRateCents: 20_000, webRateCents: 20_000, effectiveFrom: d('2020-01-01') },
      ],
    })
  })

  afterEach(async () => {
    sends.length = 0
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    await prisma.leaseHold.deleteMany({ where: { lease: { facilityId } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    vi.restoreAllMocks()
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    await prisma.leaseHold.deleteMany({ where: { lease: { facilityId } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
    await prisma.$disconnect()
  })

  describe('the ask', () => {
    it('holds the unit and raises a task without touching the lease', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const result = await requestTransfer(tenantId, lease.id, to.id, daysFromToday(3))
      expect(result.ok).toBe(true)

      // The lease is exactly as it was. This is the whole point: a request is
      // not a transfer, and a tenant who asks and then hears nothing must not
      // have quietly lost their unit, their rate or their gate code.
      const after = await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })
      expect(after.status).toBe('active')
      expect(after.unitId).toBe(from.id)
      expect(after.monthlyRateCents).toBe(10_000)
      expect(after.endDate).toBeNull()

      // The old unit is untouched; the new one is spoken for.
      expect((await prisma.unit.findUniqueOrThrow({ where: { id: from.id } })).status).toBe('occupied')
      expect((await prisma.unit.findUniqueOrThrow({ where: { id: to.id } })).status).toBe('reserved')

      const hold = await prisma.reservation.findFirstOrThrow({ where: { unitId: to.id } })
      expect(hold.source).toBe('transfer')
      expect(hold.tenantId).toBe(tenantId)
      expect(hold.status).toBe('held')
      // The rate quoted is the target type's street rate, not the old one.
      expect(hold.quotedRateCents).toBe(20_000)

      const task = await prisma.task.findFirstOrThrow({
        where: { type: 'transfer_request_review', entityId: lease.id },
      })
      expect(task.status).toBe('open')
      expect(task.facilityId).toBe(facilityId)
    })

    it('refuses a second live request rather than holding two units', async () => {
      const from = await makeUnit(smallTypeId)
      const first = await makeUnit(largeTypeId)
      const second = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      expect((await requestTransfer(tenantId, lease.id, first.id, daysFromToday(2))).ok).toBe(true)

      const again = await requestTransfer(tenantId, lease.id, second.id, daysFromToday(2))
      expect(again).toEqual({ ok: false, problem: 'already_requested' })
      expect((await prisma.unit.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('available')
    })

    it('refuses a date in the past', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      const result = await requestTransfer(tenantId, lease.id, to.id, daysFromToday(-1))
      expect(result).toEqual({ ok: false, problem: 'date_in_past' })
      expect(await prisma.reservation.count({ where: { unitId: to.id } })).toBe(0)
    })

    it('refuses a lease that is not this tenant’s', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id, otherTenantId)

      const result = await requestTransfer(tenantId, lease.id, to.id, daysFromToday(2))
      expect(result).toEqual({ ok: false, problem: 'not_found' })
    })

    it('refuses a unit somebody else’s request is already holding', async () => {
      const mine = await makeUnit(smallTypeId)
      const theirs = await makeUnit(smallTypeId)
      const contested = await makeUnit(largeTypeId)
      const myLease = await makeLease(mine.id)
      const theirLease = await makeLease(theirs.id, otherTenantId)

      expect((await requestTransfer(otherTenantId, theirLease.id, contested.id, daysFromToday(2))).ok).toBe(true)

      // The relaxed availability check is scoped to the tenant the hold is
      // FOR. If it were not, one tenant's request would open the unit to
      // everybody — the exact opposite of what a hold is for.
      const result = await requestTransfer(tenantId, myLease.id, contested.id, daysFromToday(2))
      expect(result).toEqual({ ok: false, problem: 'unit_not_available' })
    })
  })

  describe('what the tenant sees', () => {
    it('offers other units at the same site, priced against what they pay now', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id, tenantId, 10_000)

      const options = await transferOptionsFor(tenantId, lease.id)
      expect(options.map((option) => option.unitId)).toContain(to.id)
      expect(options.map((option) => option.unitId)).not.toContain(from.id)

      const large = options.find((option) => option.unitId === to.id)!
      expect(large.rateCents).toBe(20_000)
      expect(large.monthlyDifferenceCents).toBe(10_000)
      expect(large.widthFt).toBe(10)
    })

    it('still lists the unit its own request is holding', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      await requestTransfer(tenantId, lease.id, to.id, daysFromToday(2))

      const options = await transferOptionsFor(tenantId, lease.id)
      expect(options.map((option) => option.unitId)).toContain(to.id)

      const [listed] = await tenantTransferLeases(tenantId)
      expect(listed.pending).not.toBeNull()
      expect(listed.pending?.unitNumber).toBe(to.number)
    })

    it('shows the tenant the same arithmetic staff will post', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      const on = daysFromToday(1)

      const mine = await previewTenantTransfer(tenantId, lease.id, to.id, on)
      const theirs = await previewTransfer(manager(), lease.id, to.id, on)
      expect(mine.ok && theirs.ok).toBe(true)
      if (!mine.ok || !theirs.ok) throw new Error('unreachable')
      expect(mine.preview).toEqual(theirs.preview)
    })
  })

  // B-137 / D-85. `OCCUPYING_LEASE_STATUSES` includes `pending_auction`, so
  // before this the tenant whose goods were being prepared for sale could move
  // them into another unit by clicking twice.
  describe('the lien pipeline (D-85)', () => {
    async function pendingAuctionLease() {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      await prisma.lease.update({ where: { id: lease.id }, data: { status: 'pending_auction' } })
      return { lease, to }
    }

    it('refuses the request by name rather than pretending the unit is not there', async () => {
      const { lease, to } = await pendingAuctionLease()
      const result = await requestTransfer(tenantId, lease.id, to.id, daysFromToday(1))
      expect(result).toMatchObject({ ok: false, problem: 'lien_pipeline' })
      expect(await prisma.reservation.count({ where: { unitId: to.id } })).toBe(0)
    })

    it('offers no units and no preview for it', async () => {
      const { lease, to } = await pendingAuctionLease()
      expect(await transferOptionsFor(tenantId, lease.id)).toEqual([])
      expect(await previewTenantTransfer(tenantId, lease.id, to.id, daysFromToday(1))).toMatchObject({
        ok: false,
        problem: 'not_found',
      })
    })

    it('still lists the lease, marked not transferable — the tenant has a unit', async () => {
      const { lease } = await pendingAuctionLease()
      const listed = await tenantTransferLeases(tenantId)
      expect(listed.map((row) => row.leaseId)).toContain(lease.id)
      expect(listed.find((row) => row.leaseId === lease.id)?.transferable).toBe(false)
    })

    it('leaves the staff wizard able to do it — D-85 settled that side the other way', async () => {
      const { lease, to } = await pendingAuctionLease()
      expect((await previewTransfer(manager(), lease.id, to.id, daysFromToday(1))).ok).toBe(true)
    })

    it('still lets a request placed before the pipeline started be cancelled', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      expect((await requestTransfer(tenantId, lease.id, to.id, daysFromToday(1))).ok).toBe(true)

      await prisma.lease.update({ where: { id: lease.id }, data: { status: 'pending_auction' } })
      // Refusing this would strand the hold on a unit nobody can now rent.
      expect(await cancelTransferRequest(tenantId, lease.id)).toEqual({ ok: true })
    })
  })

  describe('what staff then do with it', () => {
    it('can still preview and complete the transfer the hold was placed for', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      const on = daysFromToday(1)

      expect((await requestTransfer(tenantId, lease.id, to.id, on)).ok).toBe(true)

      // The hold made the unit `reserved`. Without this item's one exception,
      // every line below would fail with `unit_not_available` — the request
      // would have blocked the transfer it exists to set up.
      const targets = await transferTargets(manager(), lease.id)
      expect(targets.map((target) => target.id)).toContain(to.id)

      const previewed = await previewTransfer(manager(), lease.id, to.id, on)
      expect(previewed.ok).toBe(true)

      const done = await completeTransfer(manager(), { leaseId: lease.id, toUnitId: to.id, transferDate: on })
      expect(done.ok).toBe(true)
      if (!done.ok) throw new Error('unreachable')

      // The hold is spent, not left held: the partial unique index allows one
      // held reservation per unit, so a stale one blocks the next tenant.
      const hold = await prisma.reservation.findFirstOrThrow({ where: { unitId: to.id } })
      expect(hold.status).toBe('converted')

      expect((await prisma.unit.findUniqueOrThrow({ where: { id: to.id } })).status).toBe('occupied')
      expect((await prisma.unit.findUniqueOrThrow({ where: { id: from.id } })).status).toBe('available')

      const newLease = await prisma.lease.findUniqueOrThrow({ where: { id: done.newLeaseId } })
      expect(newLease.unitId).toBe(to.id)
      expect(newLease.monthlyRateCents).toBe(20_000)
    })

    it('honours the rate the tenant was quoted when the street rate rises (B-136)', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      const on = daysFromToday(1)

      const asked = await requestTransfer(tenantId, lease.id, to.id, on)
      expect(asked.ok).toBe(true)
      if (!asked.ok) throw new Error('unreachable')
      expect(asked.preview.newRateCents).toBe(20_000)

      // The operator raises the street rate between the ask and staff getting
      // to the task. Without the lock, `completeTransfer` re-reads this and
      // charges a number the tenant never agreed to.
      const raised = await prisma.unitTypeRate.create({
        data: {
          facilityId,
          unitTypeId: largeTypeId,
          streetRateCents: 26_000,
          webRateCents: 26_000,
          effectiveFrom: today(),
        },
      })

      try {
        // Every surface agrees on the held figure: the tenant's own list, the
        // staff dropdown, both previews, and what actually posts.
        const options = await transferOptionsFor(tenantId, lease.id)
        expect(options.find((option) => option.unitId === to.id)?.rateCents).toBe(20_000)

        const targets = await transferTargets(manager(), lease.id)
        expect(targets.find((target) => target.id === to.id)?.rateCents).toBe(20_000)

        const tenantSees = await previewTenantTransfer(tenantId, lease.id, to.id, on)
        expect(tenantSees.ok && tenantSees.preview.newRateCents).toBe(20_000)

        const staffSees = await previewTransfer(manager(), lease.id, to.id, on)
        expect(staffSees.ok && staffSees.preview.newRateCents).toBe(20_000)

        const done = await completeTransfer(manager(), { leaseId: lease.id, toUnitId: to.id, transferDate: on })
        expect(done.ok).toBe(true)
        if (!done.ok) throw new Error('unreachable')
        const newLease = await prisma.lease.findUniqueOrThrow({ where: { id: done.newLeaseId } })
        expect(newLease.monthlyRateCents).toBe(20_000)
      } finally {
        await prisma.unitTypeRate.delete({ where: { id: raised.id } })
      }
    })

    it('re-quotes at the current street rate when there is no hold (B-136)', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)
      const on = daysFromToday(1)

      // A staff-initiated transfer nobody asked for. Nothing was quoted, so
      // the street rate is the right answer and the lock must not apply.
      const raised = await prisma.unitTypeRate.create({
        data: {
          facilityId,
          unitTypeId: largeTypeId,
          streetRateCents: 26_000,
          webRateCents: 26_000,
          effectiveFrom: today(),
        },
      })

      try {
        const previewed = await previewTransfer(manager(), lease.id, to.id, on)
        expect(previewed.ok && previewed.preview.newRateCents).toBe(26_000)
      } finally {
        await prisma.unitTypeRate.delete({ where: { id: raised.id } })
      }
    })

    it('refuses a stale hold on a unit that has since been let', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      expect((await requestTransfer(tenantId, lease.id, to.id, daysFromToday(2))).ok).toBe(true)

      // Somebody moved into it at the counter regardless. `reserved` is the
      // only status the exception accepts, so `occupied` still refuses —
      // which is the difference between "held for you" and "not available".
      await makeLease(to.id, otherTenantId)
      await prisma.unit.update({ where: { id: to.id }, data: { status: 'occupied' } })

      const result = await previewTransfer(manager(), lease.id, to.id, daysFromToday(2))
      expect(result).toEqual({ ok: false, problem: 'unit_not_available' })
    })
  })

  describe('when nobody ever acts on it', () => {
    it('lapses the hold and takes its task off the queue with it', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      expect((await requestTransfer(tenantId, lease.id, to.id, daysFromToday(2))).ok).toBe(true)

      // The sweep, run far enough ahead that the hold's own expiry has passed.
      const { expired } = await expireReservations(daysFromToday(400), facilityId)
      expect(expired).toBe(1)

      expect((await prisma.reservation.findFirstOrThrow({ where: { unitId: to.id } })).status).toBe('expired')
      expect((await prisma.unit.findUniqueOrThrow({ where: { id: to.id } })).status).toBe('available')

      // The task goes with it. A queue holding items about requests that no
      // longer exist is how staff learn to stop trusting the queue.
      const task = await prisma.task.findFirstOrThrow({
        where: { type: 'transfer_request_review', entityId: lease.id },
      })
      expect(task.status).toBe('cancelled')

      // And the tenant's own screen shows nothing pending, because it is
      // derived from the hold rather than from a column somebody has to clear.
      const [listed] = await tenantTransferLeases(tenantId)
      expect(listed.pending).toBeNull()
    })
  })

  describe('what the tenant is told', () => {
    it('confirms in writing, naming both units and quoting no figure', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      expect((await requestTransfer(tenantId, lease.id, to.id, daysFromToday(3))).ok).toBe(true)

      const event = await prisma.domainEvent.findFirstOrThrow({
        where: { name: 'lease.transfer_requested', entityId: lease.id },
      })
      await processCommsEvent(event)

      expect(sends).toHaveLength(1)
      expect(sends[0].body).toContain(from.number)
      expect(sends[0].body).toContain(to.number)
      // Deliberately no money: the prorated total depends on the day staff
      // actually complete it, and a figure here reads as agreed.
      expect(sends[0].body).not.toMatch(/\$\d/)
    })
  })

  describe('withdrawing it', () => {
    it('puts the unit back and takes the task off the queue', async () => {
      const from = await makeUnit(smallTypeId)
      const to = await makeUnit(largeTypeId)
      const lease = await makeLease(from.id)

      await requestTransfer(tenantId, lease.id, to.id, daysFromToday(2))
      expect(await cancelTransferRequest(tenantId, lease.id)).toEqual({ ok: true })

      expect((await prisma.unit.findUniqueOrThrow({ where: { id: to.id } })).status).toBe('available')
      expect((await prisma.reservation.findFirstOrThrow({ where: { unitId: to.id } })).status).toBe('cancelled')

      const task = await prisma.task.findFirstOrThrow({
        where: { type: 'transfer_request_review', entityId: lease.id },
      })
      expect(task.status).toBe('cancelled')

      // And the tenant can ask again, for a different unit.
      const elsewhere = await makeUnit(largeTypeId)
      expect((await requestTransfer(tenantId, lease.id, elsewhere.id, daysFromToday(4))).ok).toBe(true)
    })

    it('refuses when there is nothing to cancel', async () => {
      const from = await makeUnit(smallTypeId)
      const lease = await makeLease(from.id)
      expect(await cancelTransferRequest(tenantId, lease.id)).toEqual({
        ok: false,
        reason: 'nothing_to_cancel',
      })
    })
  })
})
