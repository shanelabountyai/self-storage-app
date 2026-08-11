import { prisma } from '@storage/db'
import { calculateMoveInCost } from '@storage/core/pricing'
import { createChargeIntent } from '@/lib/payments/intents'
import { paymentsEnabled } from '@/lib/payments/stripe'
import type { CheckoutSessionView } from '@/lib/checkout/session'

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

  const premiumCents =
    typeof session.data.protectionPremiumCents === 'number' ? session.data.protectionPremiumCents : 0

  const cost = calculateMoveInCost({
    webRateCents: session.quotedRateCents,
    streetRateCents: session.quotedRateCents,
    adminFeeCents: feeRows[0]?.amountCents,
    taxRates: taxRows.map((row) => ({
      jurisdiction: row.jurisdiction,
      rateBasisPoints: row.rateBasisPoints,
    })),
  })

  const lines = cost.lines
    .filter((line) => line.key !== 'protection')
    .map((line) => ({ key: line.key, label: line.label, amountCents: line.amountCents }))

  if (premiumCents > 0) {
    lines.push({ key: 'protection', label: 'Protection plan', amountCents: premiumCents })
  }

  return {
    lines,
    totalDueTodayCents: cost.totalDueTodayCents + premiumCents,
    ongoingMonthlyCents: cost.ongoingMonthlyCents + premiumCents,
  }
}

export type PaymentSetup =
  | { available: false }
  | { available: true; clientSecret: string; paymentId: string; totalDueTodayCents: number }

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

  return {
    available: true,
    clientSecret: intent.clientSecret,
    paymentId: intent.paymentId,
    totalDueTodayCents: due.totalDueTodayCents,
  }
}

async function tenantIdFor(session: CheckoutSessionView): Promise<string | null> {
  const row = await prisma.checkoutSession.findUnique({
    where: { id: session.id },
    select: { tenantId: true },
  })
  return row?.tenantId ?? null
}
