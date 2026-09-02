import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { takeCounterMoveInPayment } from '../apps/web/lib/checkout/counter-tender'
import { amountDueToday } from '../apps/web/lib/checkout/payment'
import { sessionById, startCheckout } from '../apps/web/lib/checkout/session'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-230 / PRD 02 §4.8 US-32, PRD 01 US-501 step 5.
//
// A walk-in move-in paid for with cash. Before this there was no cash or check
// option on a move-in at all — `startWalkInMoveInAction` handed staff into the
// public checkout, whose only payment step is the Stripe Payment Element — so
// somebody with two hundred dollars in notes could not rent a unit.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitTypeId = ''
let tenantId = ''
let counterStaffId = ''
let managerStaffId = ''

function staffActor(staffUserId: string, rank: 10 | 20): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId,
        roleKey: rank === 20 ? 'manager' : 'counter',
        rank,
        permissions: new Set<PermissionKey>(['tenants:view', 'payments:take', 'leases:move_in']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('counter move-in tender', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Counter MoveIn ${suffix}`,
        slug: `counter-movein-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        cashApprovalThresholdCents: 50_000,
      },
    })
    facilityId = facility.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    await prisma.unitTypeRate.create({
      data: {
        facilityId,
        unitTypeId,
        streetRateCents: 14_900,
        webRateCents: 12_900,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      },
    })
    await prisma.feeSchedule.create({
      data: {
        facilityId,
        feeType: 'admin',
        amountCents: 2_500,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      },
    })

    const tenant = await prisma.tenant.create({
      data: { email: `counter-movein-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const [counter, manager] = await Promise.all([
      prisma.staffUser.create({
        data: { email: `cm-counter-${suffix}@example.com`, firstName: 'Cass', lastName: 'Counter' },
      }),
      prisma.staffUser.create({
        data: { email: `cm-manager-${suffix}@example.com`, firstName: 'Mel', lastName: 'Manager' },
      }),
    ])
    counterStaffId = counter.id
    managerStaffId = manager.id
  })

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `CM-${suffix}`, status: 'available' },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    // A completed move-in issues a gate code — `requestDownstream` is part of
    // what is under test — so the credential and its grant hold the tenant.
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.feeSchedule.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.receiptCounter.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    // The facility and the staff users are deliberately NOT reclaimed: this
    // suite writes `payment.recorded` audit rows, and `audit_log` carries a
    // RESTRICT foreign key to both plus a trigger refusing DELETE on itself
    // (B-185). `npm run db:reset-test` is the only thing that clears them.
    await prisma.$disconnect()
  })

  /// A checkout sitting on the payment step, started the way the POS starts
  /// one: no reservation, stamped `walk_in`.
  async function counterSession() {
    const started = await startCheckout({
      facilityId,
      unitTypeId,
      quotedRateCents: 14_900,
      acquisitionSource: 'walk_in',
    })
    if (!started.ok) throw new Error('could not start checkout')
    await prisma.checkoutSession.update({
      where: { id: started.sessionId },
      data: {
        tenantId,
        step: 'payment',
        data: { protection: 'waiver', acquisitionSource: 'walk_in' },
      },
    })
    const session = await sessionById(started.sessionId)
    if (!session) throw new Error('unreachable')
    return { session, unitId: started.unitId }
  }

  it('moves the renter in, posts both sides of the ledger and hands back change', async () => {
    const { session, unitId } = await counterSession()
    const due = await amountDueToday(session)

    const result = await takeCounterMoveInPayment(staffActor(counterStaffId, 10), session, {
      method: 'cash',
      tenderedCents: due.totalDueTodayCents + 5_000,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.changeCents).toBe(5_000)
    expect(result.amountCents).toBe(due.totalDueTodayCents)
    expect(result.receiptNumber).toBeGreaterThan(0)

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: result.leaseId } })
    expect(lease.status).toBe('active')
    // The whole reason this item exists on the reporting side.
    expect(lease.acquisitionSource).toBe('walk_in')

    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
    expect(unit.status).toBe('occupied')

    // BOTH sides. The opening charge comes from `provisionMoveIn`, the payment
    // from `recordCounterPayment`, and the point of taking the money AFTER
    // provisioning is that the second one has a lease to post against — which
    // is the difference between a settled move-in and one that reads as owing
    // its whole first month.
    const entries = await prisma.ledgerEntry.findMany({ where: { leaseId: lease.id } })
    expect(entries.map((entry) => entry.type).sort()).toEqual(['charge', 'payment'])
    expect(entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0)

    // US-32's attribution: the staffer who took the notes, from the session
    // and never from a form.
    const payment = await prisma.payment.findFirstOrThrow({ where: { facilityId } })
    expect(payment.method).toBe('cash')
    expect(payment.status).toBe('succeeded')
    expect(payment.receivedByStaffId).toBe(counterStaffId)
    expect(payment.tenderedCents).toBe(due.totalDueTodayCents + 5_000)
  })

  it('refuses a check with no number, and writes nothing at all', async () => {
    // The property the ordering depends on: every refusal is decided BEFORE
    // `provisionMoveIn` runs, so a refused tender cannot leave a lease behind.
    const { session } = await counterSession()

    const result = await takeCounterMoveInPayment(staffActor(counterStaffId, 10), session, {
      method: 'check',
    })
    expect(result).toEqual({ ok: false, problem: 'check_number_required' })

    expect(await prisma.lease.count({ where: { facilityId } })).toBe(0)
    expect(await prisma.payment.count({ where: { facilityId } })).toBe(0)
  })

  it('stops counter staff at the cash ceiling before anyone is moved in', async () => {
    // RBAC-2's configurable ceiling still escalates. The tender step must not
    // become a way around it — and, more expensively, must not provision a
    // lease and only then discover the cash is over the limit, which is a
    // tenant moved in for free.
    await prisma.facility.update({
      where: { id: facilityId },
      data: { cashApprovalThresholdCents: 1_000 },
    })
    try {
      const { session } = await counterSession()
      const due = await amountDueToday(session)

      const refused = await takeCounterMoveInPayment(staffActor(counterStaffId, 10), session, {
        method: 'cash',
        tenderedCents: due.totalDueTodayCents,
      })
      expect(refused).toEqual({ ok: false, problem: 'needs_manager' })
      expect(await prisma.lease.count({ where: { facilityId } })).toBe(0)

      // And a manager takes the same money on the same session.
      const allowed = await takeCounterMoveInPayment(staffActor(managerStaffId, 20), session, {
        method: 'cash',
        tenderedCents: due.totalDueTodayCents,
      })
      expect(allowed.ok).toBe(true)
    } finally {
      await prisma.facility.update({
        where: { id: facilityId },
        data: { cashApprovalThresholdCents: 50_000 },
      })
    }
  })

  it('refuses a second tender on a checkout that is already provisioned', async () => {
    // A second press, or a card that cleared while the staffer was counting
    // notes. Taking the cash now would be a second payment for one move-in.
    const { session } = await counterSession()
    const due = await amountDueToday(session)

    const first = await takeCounterMoveInPayment(staffActor(counterStaffId, 10), session, {
      method: 'cash',
      tenderedCents: due.totalDueTodayCents,
    })
    expect(first.ok).toBe(true)

    const second = await takeCounterMoveInPayment(staffActor(counterStaffId, 10), session, {
      method: 'cash',
      tenderedCents: due.totalDueTodayCents,
    })
    expect(second).toEqual({ ok: false, problem: 'already_provisioned' })
    expect(await prisma.payment.count({ where: { facilityId } })).toBe(1)
  })

  it('refuses a session that is not at the payment step', async () => {
    // The steps before this one are not decoration — a tender posted against a
    // session still on the lease step would move somebody in unsigned.
    const { session } = await counterSession()
    await prisma.checkoutSession.update({
      where: { id: session.id },
      data: { step: 'lease' },
    })
    const stale = await sessionById(session.id)
    if (!stale) throw new Error('unreachable')

    const result = await takeCounterMoveInPayment(staffActor(counterStaffId, 10), stale, {
      method: 'cash',
      tenderedCents: 100_000,
    })
    expect(result).toEqual({ ok: false, problem: 'not_at_payment' })
    expect(await prisma.lease.count({ where: { facilityId } })).toBe(0)
  })

  it('refuses a hand-recorded card, which still has to go through the Element', async () => {
    // US-601's SAQ-A boundary. Recording a card by hand would post a ledger
    // entry with no money behind it, and this is a staff-operated screen —
    // exactly where a written-down number ends up on a sticky note.
    const { session } = await counterSession()
    const result = await takeCounterMoveInPayment(staffActor(counterStaffId, 10), session, {
      method: 'card',
    })
    expect(result).toEqual({ ok: false, problem: 'card_not_supported' })
    expect(await prisma.lease.count({ where: { facilityId } })).toBe(0)
  })

  it('refuses a staffer with no reach into this facility', async () => {
    const { session } = await counterSession()
    const outsider: Actor = {
      kind: 'staff',
      staffUserId: counterStaffId,
      assignments: [
        {
          facilityId: 'some-other-facility',
          roleKey: 'counter',
          rank: 10,
          permissions: new Set<PermissionKey>(['payments:take']),
          limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
        },
      ],
    }
    await expect(
      takeCounterMoveInPayment(outsider, session, { method: 'cash', tenderedCents: 100_000 }),
    ).rejects.toThrow(ForbiddenError)
    expect(await prisma.lease.count({ where: { facilityId } })).toBe(0)
  })
})
