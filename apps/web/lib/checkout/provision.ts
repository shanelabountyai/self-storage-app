import { type Prisma, prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { billingDayFor } from '@storage/core/billing'
import { businessDateFor } from '@storage/core/jobs'
import { recomputeUnitStatus } from '@/lib/admin/units'
import { provisionAccessForLease } from '@/lib/access/provision'
import { createTask } from '@/lib/admin/tasks'
import { amountDueToday } from './payment'
import { promoDiscountOn, sessionById } from './session'
import { track } from '@/lib/analytics/track'
import { trackingContext } from '@/lib/analytics/request'
import { redeemPromotion } from '@/lib/promotions/service'
import { syncActiveDutyHolds } from '@/lib/tenants/active-duty'
import { qualifyReferral } from '@/lib/referrals/service'

// PRD 01 FR-4.5 / FR-4.6. Turning a paid checkout into a moved-in tenant.
//
// ── The rule that shapes everything here ─────────────────────────────────────
//
// FR-4.6: "if payment succeeds but any downstream step fails permanently, the
// tenant is still moved in from the customer's point of view; failures create
// admin tasks, never customer-facing dead ends."
//
// So this splits in two. The part that MUST be atomic with the payment — the
// lease, the unit, the ledger — happens in one transaction and either all
// commits or none does. Everything after it (gate code, emails) is best-effort
// and cannot un-move-in someone who has paid. A renter standing at the gate
// with a receipt is moved in whether or not our hardware queue is healthy.

export type ProvisionResult =
  | { ok: true; leaseId: string; alreadyProvisioned: boolean }
  | { ok: false; reason: 'session_not_found' | 'no_tenant' | 'no_unit' }

/// Provisions a move-in for a paid checkout session.
///
/// Idempotent by the session's own state: a webhook redelivery, a retry, or a
/// renter refreshing the confirmation page must not create a second lease.
export async function provisionMoveIn(sessionId: string): Promise<ProvisionResult> {
  const session = await sessionById(sessionId)
  if (!session) return { ok: false, reason: 'session_not_found' }

  const row = await prisma.checkoutSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { tenantId: true, unitId: true, reservationId: true, abandonmentSequenceStep: true },
  })
  if (!row.tenantId) return { ok: false, reason: 'no_tenant' }
  if (!row.unitId) return { ok: false, reason: 'no_unit' }

  const existing = await prisma.lease.findFirst({
    where: { unitId: row.unitId, tenantId: row.tenantId, status: { not: 'ended' } },
    select: { id: true },
  })
  if (existing) return { ok: true, leaseId: existing.id, alreadyProvisioned: true }

  const due = await amountDueToday(session)
  const data = session.data as Record<string, unknown>
  const premiumCents = typeof data.protectionPremiumCents === 'number' ? data.protectionPremiumCents : 0
  const protectionTier = typeof data.protection === 'string' ? data.protection : 'waiver'
  // §4.6/D-11a: autopay is default-on at checkout step 5 with the disclosure
  // beside it, so anything other than an explicit opt-out enrols. Read here
  // because until B-036 this choice was written to the checkout session and
  // then dropped on the floor — the renter's own decision never reached the
  // lease, and nothing downstream could act on it either way.
  const autopayEnabled = data.autopay !== false

  // B-044. The billing day comes from the facility's policy, not a constant.
  // Under `anniversary` (the default, D-27) it is the move-in day, which is
  // what makes the full month charged at checkout buy a whole period starting
  // today — with a hardcoded 1 the tenant paid for a month from the 20th and
  // the nightly run would have invoiced them again on the 1st.
  //
  // The day comes from the FACILITY-LOCAL calendar date, not the UTC one. At
  // 10pm in Texas the UTC date is already tomorrow, so a `new Date()` read
  // would give that renter an anniversary one day after the day they actually
  // moved in — and every invoice for the life of the lease would carry it.
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: session.facilityId },
    select: { billingPolicy: true, timezone: true },
  })
  // B-106. The date the renter chose, or now.
  //
  // `requestedStartDate` is stored as UTC-midnight of the facility-local day
  // the renter picked, so a future-dated lease starts at the beginning of that
  // day rather than at whatever o'clock the payment cleared. A same-day
  // move-in keeps `new Date()` — the renter is standing there, and the lease
  // starting an hour ago would be odd in the other direction.
  //
  // D-27 is what makes this simple rather than a proration problem: under
  // anniversary billing the move-in payment buys a full period STARTING that
  // day, so a future start just moves which day that is. The renter pays now
  // for a month beginning later, and `billingDayFor` anchors every invoice
  // after it to the same date.
  const startDate = session.requestedStartDate ?? new Date()
  // NOT `businessDateFor(startDate, ...)` when the renter chose a date.
  //
  // `businessDateFor` converts an INSTANT to a facility-local calendar day.
  // `requestedStartDate` is already such a day — stored as UTC-midnight, the
  // same convention `businessDateFor` returns — so putting it through again is
  // a second conversion. For any facility west of UTC that lands on the
  // PREVIOUS day: a renter picking the 20th at a Chicago site got a lease
  // billing on the 19th, every month, for the life of the lease. Caught by the
  // test below asserting the anniversary, which is the only place the
  // off-by-one is visible.
  const localToday = session.requestedStartDate ?? businessDateFor(startDate, facility.timezone)

  // PRD 02 US-43's last AC: "source and channel carry through reservation →
  // move-in, so the move-in/move-out report can split walk-in vs phone vs web."
  //
  // Read from the reservation that produced this checkout, and stamped onto the
  // lease. Without a reservation there is no channel to inherit and the renter
  // came through the public checkout, which IS `web` — the one case where
  // defaulting is a fact rather than a guess.
  const reservationSource = row.reservationId
    ? (
        await prisma.reservation.findUnique({
          where: { id: row.reservationId },
          select: { source: true },
        })
      )?.source
    : null

  const leaseId = await prisma.$transaction(async (tx) => {
    const lease = await tx.lease.create({
      data: {
        facilityId: session.facilityId,
        tenantId: row.tenantId!,
        unitId: row.unitId!,
        // `active` rather than `pending`: the money is in and the renter can
        // open the gate. A pending lease here would leave the unit reading as
        // occupied while nothing bills it.
        status: 'active',
        startDate,
        monthlyRateCents: session.quotedRateCents,
        billingDay: billingDayFor(facility.billingPolicy, localToday),
        acquisitionSource: reservationSource ?? 'web',
        autopayEnabled,
        protectionPlanName: protectionTier === 'waiver' ? null : protectionTier,
        protectionCents: premiumCents,
        protectionWaivedAt: protectionTier === 'waiver' ? new Date() : null,
      },
    })

    // B-121 / D-49. The active-duty declaration from the lease step becomes the
    // hold that actually stops the pipeline, before this lease can be dunned by
    // anything.
    //
    // INSIDE the transaction, which is the one place this file's own FR-4.6
    // split does not apply. FR-4.6 keeps gate codes and emails out here because
    // a hardware queue must never un-move-in somebody who has paid — the risk
    // it manages is a customer-facing dead end. This is the opposite direction:
    // a moved-in servicemember with no hold is not an inconvenience, it is the
    // federal exposure, and the failure has to take the move-in with it so the
    // webhook's own redelivery gets another go. It is also one insert into a
    // table we hold the parent row for, so "it might fail on its own" is close
    // to hypothetical.
    // No `if declared` here — `syncActiveDutyHolds` reads the flag itself and
    // is a no-op for everybody else, which is one query rather than two and,
    // more to the point, one place the guard can be got wrong.
    await syncActiveDutyHolds(row.tenantId!, 'checkout', tx, startDate)

    // US-11's clock, started at the only moment it can be. See the model's own
    // comment: a lease created without this row is a tenant permanently
    // ineligible for a rules-based rate increase, and it cannot be backfilled.
    await tx.leaseRateChange.create({
      data: {
        leaseId: lease.id,
        previousRateCents: null,
        newRateCents: session.quotedRateCents,
        effectiveFrom: lease.startDate,
        reason: 'move_in',
      },
    })

    // The waiver, if there was one, now belongs to the lease rather than to a
    // checkout session that is about to be completed.
    await tx.protectionWaiver.updateMany({
      where: { checkoutSessionId: session.id },
      data: { leaseId: lease.id, tenantId: row.tenantId },
    })

    // The signed lease document moves with it, so the evidence chain points at
    // the lease and not at a transient session id.
    await tx.document.updateMany({
      where: { subjectType: 'CheckoutSession', subjectId: session.id, type: 'lease' },
      data: { subjectType: 'Lease', subjectId: lease.id },
    })

    await openingLedger(tx, {
      facilityId: session.facilityId,
      leaseId: lease.id,
      dueTodayCents: due.totalDueTodayCents,
    })

    // A reservation that led here converted rather than expiring — the
    // difference the conversion report is built on.
    if (row.reservationId) {
      await tx.reservation.updateMany({
        where: { id: row.reservationId, status: 'held' },
        data: { status: 'converted' },
      })
    }

    await tx.checkoutSession.update({
      where: { id: session.id },
      data: { step: 'provisioned', status: 'completed' },
    })

    // Derived, not set: the lease is what makes the unit occupied (B-010).
    await recomputeUnitStatus(row.unitId!, tx)

    await emitEvent(
      {
        name: 'lease.moved_in',
        facilityId: session.facilityId,
        entityType: 'Lease',
        entityId: lease.id,
        payload: {
          unitId: row.unitId,
          tenantId: row.tenantId,
          monthlyRateCents: session.quotedRateCents,
          fromReservation: Boolean(row.reservationId),
        },
      },
      tx,
    )

    // PRD 04 FR-PROMO-4/5. Redeemed HERE — at the end of a completed, paid
    // move-in — rather than when the promo was shown or the checkout started.
    // A redemption claimed earlier would consume a capped promotion for
    // somebody who abandoned at the payment step, and the cap is the scarce
    // thing the whole atomic-claim design exists to protect.
    //
    // Failure is not an error: FR-PROMO-5 wants an over-cap attempt to "fall
    // back gracefully (reservation completes at standard rate)", so the lease
    // stands and the discount simply does not exist.
    if (session.promotionId) {
      // The schedule the session LOCKED, not a fresh evaluation.
      //
      // It used to re-derive here, on the reasoning that the rate could have
      // moved — but `quotedRateCents` is locked on the session, so the only
      // thing a re-evaluation could change is the promotion itself, and then
      // the redemption would disagree with what the renter was charged. An
      // operator pausing a promo between "Rent now" and the card clearing must
      // not turn a discounted checkout into a full-price lease with no
      // redemption row to explain it. The cap is still enforced atomically
      // inside `redeemPromotion`, which is what FR-PROMO-5 actually requires.
      const promo = promoDiscountOn(session)
      const schedule = promo?.schedule ?? null

      if (schedule) {
        await redeemPromotion(tx, {
          promotionId: session.promotionId,
          promoCodeId: session.promoCodeId,
          facilityId: session.facilityId,
          reservationId: row.reservationId,
          leaseId: lease.id,
          schedule,
          totalCents: schedule.reduce((sum, period) => sum + period.amountCents, 0),
        })
      }
    }

    return lease.id
  })

  // PRD 10 §4 (B-100). Qualification: "a referral qualifies when the referee's
  // move-in is complete AND their first payment has cleared."
  //
  // Both are true exactly here — `provisionMoveIn` runs off a settled payment,
  // which is why this is the signal rather than the reservation or the lease
  // signature. Not at reservation: a free hold costs nothing and expires on
  // its own, and paying $50 a hold is a business somebody discovers in a week.
  //
  // AFTER the transaction and unable to fail it, which is FR-4.6's rule and
  // §5.4's: "a refused referral never silently drops. The referee's move-in
  // completes at the standard rate with the reason logged." A referral that
  // throws — or one that is refused — must never un-move-in somebody who has
  // paid. `qualifyReferral` records the refusal itself, so a caught error here
  // is the genuinely exceptional case rather than the refusal path.
  const referralInviteId =
    typeof data.referralInviteId === 'string' ? data.referralInviteId : null
  if (referralInviteId) {
    try {
      await qualifyReferral({
        inviteId: referralInviteId,
        refereeTenantId: row.tenantId!,
        refereeLeaseId: leaseId,
        refereeFacilityId: session.facilityId,
      })
    } catch {
      // Swallowed deliberately. The tenant is moved in and has paid; a
      // referral that could not be judged is a $50 question for a human, not
      // a reason to fail a completed rental.
    }
  }

  // PRD 04 US-15 AC3: "`move_in_completed` is fired server-side from the admin
  // dashboard's move-in event (client analytics can't see it)."
  //
  // Literally true here — the browser that started this checkout may have been
  // closed for ten minutes while Stripe confirmed. Fired AFTER the transaction
  // commits, not inside it: an analytics insert that failed would otherwise
  // roll back a completed, paid move-in, which is the tail wagging the dog in
  // the most expensive possible way.
  //
  // The session id comes from the checkout's own cookie where one survives, so
  // the funnel can join this to the page view that started it. Without it the
  // move-in still counts — it just cannot be attributed to a session.
  const analytics = await trackingContext().catch(() => null)
  await track({
    event: 'move_in_completed',
    facilityId: session.facilityId,
    sessionId: analytics?.sessionId ?? `lease:${leaseId}`,
    channel: analytics?.channel ?? reservationSource ?? null,
    utmSource: analytics?.utmSource ?? null,
    utmMedium: analytics?.utmMedium ?? null,
    // PRD 04 US-9 AC4 (B-073). "Recovered reservations are attributed to the
    // sequence in funnel reporting" — the fact lives here, on the event the
    // funnel already counts, rather than a second report joining back to
    // `CheckoutSession`.
    properties: {
      fromReservation: Boolean(row.reservationId),
      recoveredByAbandonment: row.abandonmentSequenceStep > 0,
    },
  })

  return { ok: true, leaseId, alreadyProvisioned: false }
}

/// The opening ledger: what was owed today, and the payment that cleared it.
///
/// Both entries, not just the payment. A ledger that records only the money
/// received cannot answer "what was this for", and the charge is what a
/// statement and a dispute both read.
async function openingLedger(
  tx: Prisma.TransactionClient,
  input: { facilityId: string; leaseId: string; dueTodayCents: number },
): Promise<void> {
  await tx.ledgerEntry.create({
    data: {
      facilityId: input.facilityId,
      leaseId: input.leaseId,
      type: 'charge',
      // Signed: a charge increases what is owed.
      amountCents: input.dueTodayCents,
      description: 'Move-in charges',
    },
  })
}

/// FR-4.5's downstream work: the gate code, the emails.
///
/// Deliberately separate from `provisionMoveIn` and deliberately unable to fail
/// it. Called directly rather than only through the `lease.moved_in` consumer
/// (registry.ts) that `provisionMoveIn` also queues: `dispatchEvents` only
/// runs off the cron tick (api/cron/route.ts), and US-501 wants the code
/// issued immediately, not on the next scheduled pass. `provisionAccessForLease`
/// is idempotent by the credential it would create, so that consumer
/// redelivering this is a safety net, not a second code.
///
/// FR-4.6, in these words: "failures create admin tasks, never customer-facing
/// dead ends." A failure here is recorded (B-095) so a human sees it now
/// rather than only when Stripe's own webhook retries eventually exhaust —
/// then re-thrown, so the at-least-once redelivery this project already
/// relies on everywhere else still gets its own chance to self-heal. Both are
/// idempotent, so whichever resolves it first is fine; a task left open after
/// a redelivery quietly fixed things is a spurious "go check" a human closes
/// in one click, which costs far less than a failure no one saw for three days.
export async function requestDownstream(leaseId: string): Promise<void> {
  try {
    await provisionAccessForLease(leaseId)
  } catch (error) {
    const lease = await prisma.lease.findUnique({ where: { id: leaseId }, select: { facilityId: true } })
    if (lease) {
      await createTask({
        facilityId: lease.facilityId,
        type: 'move_in_provisioning_failed',
        entityType: 'Lease',
        entityId: leaseId,
      })
    }
    throw error
  }
}

/// The lease a now-provisioned session became. The confirmation page's own
/// lookup — provisioning itself never needs this, since the transaction above
/// already has `lease.id` in hand.
export async function leaseIdForSession(sessionId: string): Promise<string | null> {
  const row = await prisma.checkoutSession.findUnique({
    where: { id: sessionId },
    select: { tenantId: true, unitId: true },
  })
  if (!row?.tenantId || !row.unitId) return null

  const lease = await prisma.lease.findFirst({
    where: { unitId: row.unitId, tenantId: row.tenantId, status: { not: 'ended' } },
    select: { id: true },
  })
  return lease?.id ?? null
}
