import { prisma } from '@storage/db'
import { calculateMoveInCost } from '@storage/core/pricing'
import { createChargeIntent } from '@/lib/payments/intents'
import { paymentsEnabled } from '@/lib/payments/stripe'
import { promoDiscountOn, type CheckoutSessionView } from '@/lib/checkout/session'

// PRD 01 US-501 step 5 / FR-4.4. What is owed today, and the intent to collect it.

export type AmountDue = {
  lines: { key: string; label: string; amountCents: number }[]
  totalDueTodayCents: number
  ongoingMonthlyCents: number
}

/// The total, computed server-side from the session and the facility.
///
/// US-301 makes a disagreement between this and the figure shown at unit
/// selection a release-blocking defect, so it goes through the same
/// `calculateMoveInCost` the facility page and the price summary use. The
/// protection premium comes from the session, where step 3 recorded it — never
/// from the browser, which would let the renter choose their own total.
export async function amountDueToday(session: CheckoutSessionView): Promise<AmountDue> {
  const [feeRows, taxRows] = await Promise.all([
    prisma.feeSchedule.findMany({
      where: { facilityId: session.facilityId, feeType: 'admin' },
      orderBy: { effectiveFrom: 'desc' },
      take: 1,
    }),
    prisma.taxComponent.findMany({ where: { facilityId: session.facilityId } }),
  ])

  // D-52 (B-106). One plan per UNIT, so the premium multiplies by the basket.
  //
  // Each plan covers "up to $X of your things", and a unit is the thing being
  // covered — three units behind one limit is under-cover the renter would
  // discover at claim time. One line today, so this is × 1 and the figure is
  // unchanged.
  const premiumPerUnitCents =
    typeof session.data.protectionPremiumCents === 'number' ? session.data.protectionPremiumCents : 0
  const premiumCents = premiumPerUnitCents * session.units.length

  // The promotion this session was started under. Read from the session, never
  // re-evaluated here: the renter is charged the price they were shown.
  const promo = promoDiscountOn(session)

  // B-106. The basket's total, not the session's single rate.
  //
  // One line today, so this is arithmetic over a list of one and the figure is
  // identical to before — which is the point of migrating the read before the
  // UI can add a second line. The admin fee and the tax are charged ONCE for
  // the checkout rather than per unit: the fee is for opening an account and
  // the tax follows the rent it is levied on, which `calculateMoveInCost`
  // already computes from the summed base.
  const basketRateCents = session.units.reduce((sum, line) => sum + line.quotedRateCents, 0)

  const cost = calculateMoveInCost({
    webRateCents: basketRateCents,
    streetRateCents: basketRateCents,
    adminFeeCents: feeRows[0]?.amountCents,
    promoDiscountCents: promo?.firstPeriodCents,
    promoTerms: promo?.terms,
    taxRates: taxRows.map((row) => ({
      jurisdiction: row.jurisdiction,
      rateBasisPoints: row.rateBasisPoints,
    })),
  })

  const lines = cost.lines
    .filter((line) => line.key !== 'protection')
    .map((line) => ({ key: line.key, label: line.label, amountCents: line.amountCents }))

  if (premiumCents > 0) {
    // D-52: the label states the multiplication rather than leaving a renter
    // to divide the number themselves. §6.4 forbids a total that moves without
    // a stated cause, and "three times $12" is the cause.
    lines.push({
      key: 'protection',
      label:
        session.units.length > 1
          ? `Protection plan — ${session.units.length} units × ${(premiumPerUnitCents / 100).toFixed(2)}`
          : 'Protection plan',
      amountCents: premiumCents,
    })
  }

  return {
    lines,
    totalDueTodayCents: cost.totalDueTodayCents + premiumCents,
    ongoingMonthlyCents: cost.ongoingMonthlyCents + premiumCents,
  }
}

export type PaymentSetup =
  | { available: false }
  | {
      available: true
      clientSecret: string
      paymentId: string
      totalDueTodayCents: number
      /// B-111. Whether this charge has left `pending`.
      ///
      /// It is what withdraws the Back control on the payment step. The
      /// session's own `status` is the server-side refusal and it is the right
      /// one — `provisionMoveIn` sets it in the same transaction as the lease
      /// and the ledger — but it flips when the WEBHOOK lands, and a renter
      /// whose card has just cleared is looking at the screen before that. A
      /// bank debit counts too: B-103's ACH sits in `processing` for days, and
      /// "nothing has been charged yet" is false the moment it is initiated.
      settling: boolean
    }

/// Creates the PaymentIntent for this checkout.
///
/// The idempotency key is the checkout session id, so a renter who reloads,
/// double-submits or comes back to the step does not create a second charge —
/// Stripe returns the original intent. That is the entire reason the key is
/// derived from what the money is for rather than from the moment it was asked
/// for (B-019).
///
/// Returns `available: false` when Stripe is not configured. The step then
/// tells the renter to call rather than rendering a form that cannot submit,
/// which is the honest failure and the one that still ends in a rented unit.
export async function preparePayment(session: CheckoutSessionView): Promise<PaymentSetup> {
  if (!paymentsEnabled()) return { available: false }

  const due = await amountDueToday(session)
  const tenantId = await tenantIdFor(session)
  if (!tenantId) return { available: false }

  const intent = await createChargeIntent({
    facilityId: session.facilityId,
    tenantId,
    amountCents: due.totalDueTodayCents,
    reference: `checkout:${session.id}`,
    description: 'Storage move-in',
    // B-103. The one surface where bank debit is a facility decision: a
    // move-in hands over a unit and a gate code, and a debit can reverse four
    // business days later.
    surface: 'checkout',
  })

  const row = await prisma.payment.findUnique({
    where: { id: intent.paymentId },
    select: { status: true },
  })

  return {
    available: true,
    clientSecret: intent.clientSecret,
    paymentId: intent.paymentId,
    totalDueTodayCents: due.totalDueTodayCents,
    settling: row?.status === 'succeeded' || row?.status === 'processing',
  }
}

async function tenantIdFor(session: CheckoutSessionView): Promise<string | null> {
  const row = await prisma.checkoutSession.findUnique({
    where: { id: session.id },
    select: { tenantId: true },
  })
  return row?.tenantId ?? null
}
