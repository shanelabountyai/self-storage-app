import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { provisionMoveIn } from '../apps/web/lib/checkout/provision'
import { amountDueToday } from '../apps/web/lib/checkout/payment'
import { sessionById } from '../apps/web/lib/checkout/session'
import { startCheckout, advance } from '../apps/web/lib/checkout/session'
import { createReservation } from '../apps/web/lib/reservations/reserve'
import { publicInventoryForFacility } from '../apps/web/lib/inventory/public-inventory'

// B-026 / PRD 01 FR-4.5, FR-4.6.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const slug = `prov-${suffix}`

let facilityId = ''
let unitTypeId = ''
let tenantId = ''

describeDb('move-in provisioning', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Provision Test',
        slug,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
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
      data: { email: `prov-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
  })

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'A-1', status: 'available' } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.document.deleteMany({ where: { facilityId } })
    // Before the leases and the facility: both referral tables restrict their
    // facility, and Referral restricts its invite (B-100).
    await prisma.referral.deleteMany({ where: { facilityId } })
    await prisma.referralInvite.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.feeSchedule.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { email: { contains: suffix } } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  async function paidSession(reservationId?: string) {
    const started = await startCheckout({
      facilityId,
      unitTypeId,
      quotedRateCents: 12_900,
      ...(reservationId ? { reservationId } : {}),
    })
    if (!started.ok) throw new Error('could not start checkout')
    await prisma.checkoutSession.update({
      where: { id: started.sessionId },
      data: { tenantId, data: { protection: 'standard', protectionPremiumCents: 1_400 } },
    })
    return started
  }

  it('creates an active lease and makes the unit occupied', async () => {
    const started = await paidSession()
    const result = await provisionMoveIn(started.sessionId)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: result.leaseId } })
    expect(lease.status).toBe('active')
    expect(lease.monthlyRateCents).toBe(12_900)
    expect(lease.protectionCents).toBe(1_400)

    // Derived, not set: the lease is what makes the unit occupied.
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: started.unitId } })
    expect(unit.status).toBe('occupied')

    // And it is gone from what the public site can sell.
    const inventory = await publicInventoryForFacility(slug)
    expect(inventory?.unitTypes[0]?.availableCount ?? 0).toBe(0)
  })

  it('provisions one lease per basket line, and the ledger sums to what was paid (B-106)', async () => {
    // The property that makes multi-unit safe to turn on: a renter who paid
    // for two units holds two leases, or the transaction rolled back and they
    // hold none. "Paid for two, got one" is the outcome with no way back.
    const started = await paidSession()
    const secondUnit = await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `MU-${suffix}` },
    })
    await prisma.checkoutSessionUnit.create({
      data: {
        checkoutSessionId: started.sessionId,
        unitTypeId,
        unitId: secondUnit.id,
        quotedRateCents: 9_900,
      },
    })

    const result = await provisionMoveIn(started.sessionId)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    const leases = await prisma.lease.findMany({
      where: { unitId: { in: [started.unitId, secondUnit.id] } },
      orderBy: { monthlyRateCents: 'desc' },
    })
    expect(leases).toHaveLength(2)
    // Each lease carries the rate ITS line locked, not the session's.
    expect(leases.map((lease) => lease.monthlyRateCents)).toEqual([12_900, 9_900])

    // Both units are occupied — a unit whose status was never recomputed stays
    // available and the public site keeps selling it.
    const units = await prisma.unit.findMany({
      where: { id: { in: [started.unitId, secondUnit.id] } },
      select: { status: true },
    })
    expect(units.every((unit) => unit.status === 'occupied')).toBe(true)

    // The opening charges are apportioned but still total exactly what was
    // charged — every lease's ledger reflects what that lease bought, and
    // nothing is invented or lost in the split.
    const entries = await prisma.ledgerEntry.findMany({
      where: { leaseId: { in: leases.map((lease) => lease.id) }, description: 'Move-in charges' },
    })
    expect(entries.length).toBe(2)
    const due = await amountDueToday((await sessionById(started.sessionId))!)
    expect(entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(due.totalDueTodayCents)
  })

  it('gives every unit its own protection plan and its own lease id (D-52)', async () => {
    // D-52: each plan covers "up to $X of your things", and a unit is the
    // thing being covered — three units behind one limit is under-cover the
    // renter finds out about at claim time.
    const started = await paidSession()
    const secondUnit = await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `MP-${suffix}` },
    })
    await prisma.checkoutSessionUnit.create({
      data: {
        checkoutSessionId: started.sessionId,
        unitTypeId,
        unitId: secondUnit.id,
        quotedRateCents: 9_900,
      },
    })

    const result = await provisionMoveIn(started.sessionId)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    // Every lease is returned, because an access credential is per lease and a
    // renter who can open one of two units is locked out of what they pay for.
    expect(result.leaseIds).toHaveLength(2)
    expect(result.leaseIds).toContain(result.leaseId)

    const leases = await prisma.lease.findMany({
      where: { id: { in: result.leaseIds } },
      select: { protectionCents: true, protectionPlanName: true },
    })
    // Both carry the tier and the premium — not one plan recorded against the
    // first lease with the others showing nothing, which is what the record
    // said before D-52 and disagreed with what was sold.
    expect(leases.every((lease) => lease.protectionCents === 1_400)).toBe(true)
    expect(leases.every((lease) => lease.protectionPlanName === 'standard')).toBe(true)
  })

  it('is idempotent across the whole basket, not just the first unit (B-106)', async () => {
    // A webhook redelivery must not create a second set of leases.
    const started = await paidSession()
    const secondUnit = await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `MU2-${suffix}` },
    })
    await prisma.checkoutSessionUnit.create({
      data: {
        checkoutSessionId: started.sessionId,
        unitTypeId,
        unitId: secondUnit.id,
        quotedRateCents: 9_900,
      },
    })

    const first = await provisionMoveIn(started.sessionId)
    const again = await provisionMoveIn(started.sessionId)
    expect(first.ok && again.ok).toBe(true)
    if (!again.ok) throw new Error('unreachable')
    expect(again.alreadyProvisioned).toBe(true)

    const leases = await prisma.lease.count({
      where: { unitId: { in: [started.unitId, secondUnit.id] } },
    })
    expect(leases).toBe(2)
  })

  it('starts the lease on the date the renter chose, and anchors billing to it (B-106)', async () => {
    // D-27 is what makes a future-dated start simple: the move-in payment buys
    // a full period STARTING that day, so the future date just moves which day
    // that is. The renter pays now for a month beginning later, and every
    // invoice after it anchors to the same anniversary.
    const started = await paidSession()
    const chosen = new Date('2026-09-20T00:00:00.000Z')
    await prisma.checkoutSession.update({
      where: { id: started.sessionId },
      data: { requestedStartDate: chosen },
    })

    const result = await provisionMoveIn(started.sessionId)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: result.leaseId } })
    expect(lease.startDate.toISOString()).toBe(chosen.toISOString())
    // Anniversary billing (the default), so the billing day is the chosen
    // day-of-month rather than today's.
    expect(lease.billingDay).toBe(20)
  })

  it('still starts today when no date was chosen (B-106)', async () => {
    // Null means "nobody asked", which is what every session before B-106
    // means — the column is nullable for exactly this reason, and provisioning
    // must not start treating those as some other date.
    const started = await paidSession()
    const before = Date.now()
    const result = await provisionMoveIn(started.sessionId)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: result.leaseId } })
    expect(lease.startDate.getTime()).toBeGreaterThanOrEqual(before)
    expect(lease.startDate.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('qualifies a referral the checkout arrived on (B-100)', async () => {
    // The trigger. `qualifyReferral` was imported and then never called for a
    // while — lint caught it, and this is the test that would have. §4's
    // signal is a COMPLETED, PAID move-in, and `provisionMoveIn` is where both
    // are true at once.
    const referrer = await prisma.tenant.create({
      data: { email: `refr-${suffix}@example.com`, firstName: 'Rae', lastName: 'Referrer' },
    })
    const referrerUnit = await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `RF-${suffix}` },
    })
    await prisma.lease.create({
      data: {
        facilityId,
        tenantId: referrer.id,
        unitId: referrerUnit.id,
        status: 'active',
        startDate: new Date('2026-07-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    await prisma.facility.update({
      where: { id: facilityId },
      data: { referralEnabled: true },
    })
    const invite = await prisma.referralInvite.create({
      data: {
        code: `PRV${suffix.slice(0, 5).toUpperCase()}`,
        referrerTenantId: referrer.id,
        facilityId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    const started = await startCheckout({
      facilityId,
      unitTypeId,
      quotedRateCents: 12_900,
      referralInviteId: invite.id,
    })
    if (!started.ok) throw new Error('could not start checkout')
    await prisma.checkoutSession.update({
      where: { id: started.sessionId },
      // The referral rides on the session, not a cookie: provisioning runs
      // from the Stripe webhook as often as from the browser, and a webhook
      // has no cookies.
      data: { tenantId, data: { referralInviteId: invite.id } },
    })

    const result = await provisionMoveIn(started.sessionId)
    expect(result.ok).toBe(true)

    const referral = await prisma.referral.findFirstOrThrow({
      where: { inviteId: invite.id },
    })
    expect(referral.state).toBe('earned')
    expect(referral.referrerTenantId).toBe(referrer.id)
    expect(referral.refereeTenantId).toBe(tenantId)
    // Consumed on qualification, per §5.1's AC.
    const after = await prisma.referralInvite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(after.redeemedAt).not.toBeNull()

    await prisma.facility.update({
      where: { id: facilityId },
      data: { referralEnabled: false },
    })
  })

  it('carries the renter’s autopay choice from checkout onto the lease', async () => {
    // B-036. This choice was written to the checkout session by step 5 and
    // then dropped: nothing read it at provisioning, so a renter's own
    // decision never reached the lease in either direction.
    const optedOut = await startCheckout({ facilityId, unitTypeId, quotedRateCents: 12_900 })
    if (!optedOut.ok) throw new Error('could not start checkout')
    await prisma.checkoutSession.update({
      where: { id: optedOut.sessionId },
      data: { tenantId, data: { protection: 'waiver', autopay: false } },
    })
    const off = await provisionMoveIn(optedOut.sessionId)
    if (!off.ok) throw new Error('unreachable')
    expect(
      (await prisma.lease.findUniqueOrThrow({ where: { id: off.leaseId } })).autopayEnabled,
    ).toBe(false)
  })

  it('enrols in autopay by default when the renter left it alone', async () => {
    // §4.6/D-11a: default-on at checkout, so anything short of an explicit
    // opt-out enrols.
    const started = await paidSession()
    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')
    expect(
      (await prisma.lease.findUniqueOrThrow({ where: { id: result.leaseId } })).autopayEnabled,
    ).toBe(true)
  })

  it('starts the rate-increase clock at move-in', async () => {
    // US-11: this cannot be backfilled. A lease created without it is a tenant
    // permanently ineligible for a rules-based increase.
    const started = await paidSession()
    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')

    const changes = await prisma.leaseRateChange.findMany({ where: { leaseId: result.leaseId } })
    expect(changes).toHaveLength(1)
    expect(changes[0].reason).toBe('move_in')
    expect(changes[0].newRateCents).toBe(12_900)
    expect(changes[0].previousRateCents).toBeNull()
  })

  it('opens the ledger with what was owed', async () => {
    const started = await paidSession()
    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')

    const entries = await prisma.ledgerEntry.findMany({ where: { leaseId: result.leaseId } })
    expect(entries).toHaveLength(1)
    // A charge increases what is owed, so it is positive.
    expect(entries[0].type).toBe('charge')
    expect(entries[0].amountCents).toBeGreaterThan(0)
  })

  it('is idempotent — a redelivered webhook does not create a second lease', async () => {
    // Stripe delivers at-least-once, and a renter refreshing the confirmation
    // page is the same problem.
    const started = await paidSession()
    const first = await provisionMoveIn(started.sessionId)
    const second = await provisionMoveIn(started.sessionId)

    expect(first).toMatchObject({ ok: true, alreadyProvisioned: false })
    expect(second).toMatchObject({ ok: true, alreadyProvisioned: true })
    expect(await prisma.lease.count({ where: { facilityId } })).toBe(1)
    expect(await prisma.leaseRateChange.count({ where: { lease: { facilityId } } })).toBe(1)
  })

  it('marks a reservation converted rather than leaving it to expire', async () => {
    // The difference the reservation→move-in conversion report is built on.
    const moveIn = new Date()
    moveIn.setDate(moveIn.getDate() + 1)
    const reservation = await createReservation({
      facilityId,
      unitTypeId,
      firstName: 'Ada',
      lastName: 'Renter',
      email: `conv-${suffix}@example.com`,
      moveInDate: moveIn,
      quotedRateCents: 12_900,
    })
    if (!reservation.ok) throw new Error('unreachable')

    const started = await paidSession(reservation.reservationId)
    await provisionMoveIn(started.sessionId)

    const after = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservation.reservationId },
    })
    expect(after.status).toBe('converted')
  })

  // B-082 part 1. The bug this closes: `acquisitionSource` answers "how was the
  // deal taken" and a marketplace rental is `web` on that axis, identical to an
  // organic one. Every aggregator move-in was therefore invisible in the report
  // an owner uses to decide where to spend — on the only channel in this
  // industry that bills per completed move-in.
  it('credits the marketplace that produced the lead, not the web form it arrived through', async () => {
    const moveIn = new Date()
    moveIn.setDate(moveIn.getDate() + 1)
    const lead = await prisma.lead.create({
      data: {
        facilityId,
        email: `agg-${suffix}@example.com`,
        channel: 'aggregator',
        firstTouchSource: 'sparefoot',
        lastTouchSource: 'sparefoot',
      },
    })
    const reservation = await createReservation({
      facilityId,
      unitTypeId,
      firstName: 'Ada',
      lastName: 'Renter',
      email: `agg-res-${suffix}@example.com`,
      moveInDate: moveIn,
      quotedRateCents: 12_900,
      utm: { source: 'sparefoot', medium: 'marketplace', campaign: 'austin-south' },
    })
    if (!reservation.ok) throw new Error('unreachable')
    // `createReservation` takes no lead id — a staffer converting an inquiry is
    // what links the two — so the link is made directly here. What is under
    // test is what provisioning READS, not how the row got its lead.
    await prisma.reservation.update({
      where: { id: reservation.reservationId },
      data: { leadId: lead.id },
    })

    const started = await paidSession(reservation.reservationId)
    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')

    const lease = await prisma.lease.findUniqueOrThrow({
      where: { id: result.leaseId },
      select: {
        acquisitionSource: true,
        acquisitionChannel: true,
        acquisitionUtmSource: true,
        acquisitionUtmMedium: true,
        acquisitionUtmCampaign: true,
      },
    })

    // Both axes, and the point is that they DISAGREE — that is the information
    // a single column could not carry.
    expect(lease.acquisitionSource, 'the deal was still taken on the web').toBe('web')
    expect(lease.acquisitionChannel, 'but the marketplace produced it').toBe('aggregator')
    expect(lease.acquisitionUtmSource).toBe('sparefoot')
    expect(lease.acquisitionUtmMedium).toBe('marketplace')
    expect(lease.acquisitionUtmCampaign).toBe('austin-south')
  })

  it('leaves the channel null rather than inventing one for a walk-up checkout', async () => {
    // No reservation, no lead, and no attribution cookie in a server-side test.
    // `unknown` is a true answer; defaulting to `organic` or `direct` here would
    // manufacture credit for a channel that did nothing, which is the same
    // failure in the opposite direction.
    const started = await paidSession()
    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')

    const lease = await prisma.lease.findUniqueOrThrow({
      where: { id: result.leaseId },
      select: { acquisitionSource: true, acquisitionChannel: true },
    })
    expect(lease.acquisitionSource).toBe('web')
    expect(lease.acquisitionChannel).toBeNull()
  })

  it('moves the signed lease document onto the lease', async () => {
    const started = await paidSession()
    await prisma.document.create({
      data: {
        facilityId,
        type: 'lease',
        subjectType: 'CheckoutSession',
        subjectId: started.sessionId,
        title: 'Storage rental agreement',
        content: '<p>lease</p>',
        mimeType: 'text/html; charset=utf-8',
        contentHash: 'x'.repeat(64),
      },
    })

    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')

    // The evidence chain points at the lease, not a transient session id.
    const document = await prisma.document.findFirstOrThrow({ where: { facilityId, type: 'lease' } })
    expect(document.subjectType).toBe('Lease')
    expect(document.subjectId).toBe(result.leaseId)
  })

  it('completes the checkout session', async () => {
    const started = await paidSession()
    await provisionMoveIn(started.sessionId)
    const session = await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: started.sessionId },
    })
    expect(session.status).toBe('completed')
    expect(session.step).toBe('provisioned')
  })

  it('refuses cleanly when the session never captured a tenant', async () => {
    const started = await startCheckout({ facilityId, unitTypeId, quotedRateCents: 12_900 })
    if (!started.ok) throw new Error('unreachable')
    expect(await provisionMoveIn(started.sessionId)).toMatchObject({ ok: false, reason: 'no_tenant' })
  })

  it('emits lease.moved_in for the downstream modules', async () => {
    const started = await paidSession()
    const result = await provisionMoveIn(started.sessionId)
    if (!result.ok) throw new Error('unreachable')

    const events = await prisma.domainEvent.findMany({
      where: { facilityId, entityId: result.leaseId, name: 'lease.moved_in' },
    })
    expect(events).toHaveLength(1)
  })
})
