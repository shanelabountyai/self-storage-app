import { prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { createChargeIntent } from '@/lib/payments/intents'
import { stripeClient } from '@/lib/payments/stripe'

// PRD 02 US-19 (B-045). The nightly autopay run.
//
// ── Why this cannot double-charge ────────────────────────────────────────────
//
// Four independent guards, deliberately layered, because the failure this
// prevents is charging a real person's card twice and the cost of one extra
// check is nothing next to that:
//
//   1. `runJob` (B-006) is unique on (jobName, facilityId, businessDate), so
//      two runs for the same facility on the same day cannot execute
//      concurrently. That is what makes the read-then-charge below safe from
//      itself rather than merely unlikely.
//   2. The query only selects invoices that are unpaid AND have no payment
//      attempt outstanding — a `pending` charge from an earlier tonight, or a
//      succeeded one, both take the invoice out of scope.
//   3. Stripe's idempotency key is derived from the invoice and the business
//      date, so a forced admin re-run within 24 hours returns the original
//      intent instead of making a second charge.
//   4. `createChargeIntent` recognises that deduplicated intent and discards
//      its own duplicate row rather than colliding on `stripePaymentIntentId`.
//
// Guard 2 is only durable because the webhook writes a `PaymentAllocation` and
// moves the invoice to `paid` (see `settleNamedInvoice`). Without that the
// invoice would read open forever and guard 2 would pass every night.

type RecordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => void

export type AutopayResult = {
  charged: number
  failed: number
  skipped: number
}

/// Why an invoice was not charged. Named rather than counted, because US-19's
/// AC is "succeeded / failed / skipped **with reasons**" on the Billing Runs
/// screen, and "skipped: 41" tells an operator nothing.
type SkipReason =
  | 'autopay_off'
  | 'no_saved_card'
  | 'attempt_in_flight'
  | 'nothing_outstanding'

const SKIP_MESSAGE: Record<SkipReason, string> = {
  autopay_off: 'autopay is off for this lease',
  no_saved_card: 'no saved card on file',
  attempt_in_flight: 'a charge for this invoice is already in flight',
  nothing_outstanding: 'nothing outstanding',
}

/// Charges every invoice due at this facility on or before the business date.
///
/// On or before, not exactly on: an invoice whose due date passed while the
/// scheduler was down must still be collected on the catch-up run rather than
/// silently becoming a delinquency the tenant did not earn.
export async function runAutopay(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<AutopayResult> {
  const result: AutopayResult = { charged: 0, failed: 0, skipped: 0 }

  if (!stripeClient()) {
    // A successful run that did nothing, not a failed one. See the same choice
    // in B-043's card scan: a red run every night for an unconfigured key
    // trains people to ignore the screen that exists to be noticed.
    recordItem({ itemId: facilityId, ok: true, message: 'skipped — Stripe is not configured' })
    return result
  }

  const invoices = await prisma.invoice.findMany({
    where: {
      facilityId,
      status: { in: ['open', 'partially_paid'] },
      dueDate: { lte: businessDate },
      lease: { status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      number: true,
      totalCents: true,
      amountPaidCents: true,
      leaseId: true,
      lease: {
        select: {
          autopayEnabled: true,
          tenantId: true,
          tenant: { select: { stripeDefaultPaymentMethodId: true } },
        },
      },
    },
  })

  for (const invoice of invoices) {
    const outstanding = invoice.totalCents - invoice.amountPaidCents
    const skip = await skipReasonFor(invoice, outstanding)
    if (skip) {
      result.skipped += 1
      recordItem({ itemId: invoice.id, ok: true, message: `${invoice.number} skipped — ${SKIP_MESSAGE[skip]}` })
      continue
    }

    try {
      const charge = await createChargeIntent({
        facilityId,
        tenantId: invoice.lease.tenantId,
        leaseId: invoice.leaseId,
        invoiceId: invoice.id,
        amountCents: outstanding,
        // The idempotency key. Includes the business date so B-046's retries on
        // +1/+3/+5 are genuinely new attempts rather than Stripe replaying the
        // first decline, while a re-run of the SAME night is deduplicated.
        reference: `autopay:${invoice.id}:${iso(businessDate)}`,
        description: `Autopay — invoice ${invoice.number}`,
        offSession: true,
        paymentMethodId: invoice.lease.tenant.stripeDefaultPaymentMethodId!,
      })

      if (charge.deduplicated) {
        result.skipped += 1
        recordItem({
          itemId: invoice.id,
          ok: true,
          message: `${invoice.number} skipped — already charged on this date`,
        })
        continue
      }

      result.charged += 1
      recordItem({
        itemId: invoice.id,
        ok: true,
        message: `${invoice.number} charged ${formatCents(outstanding)}`,
      })
    } catch (error) {
      // An off-session charge declines SYNCHRONOUSLY — Stripe throws rather
      // than sending a `payment_intent.payment_failed` webhook, because the
      // confirmation happened inside this request. So the failure has to be
      // recorded here; waiting for a webhook that is not coming is how a
      // decline becomes invisible and the retry schedule never starts.
      //
      // `createChargeIntent` has already marked its own Payment row failed with
      // the reason; what is left is the event B-046 and B-050 listen for.
      result.failed += 1
      const message = error instanceof Error ? error.message : String(error)

      // Found through the allocation this attempt wrote before calling Stripe,
      // not by guessing at the tenant's most recent failure — which would
      // attach the event to an unrelated decline whenever a tenant had two.
      const allocation = await prisma.paymentAllocation.findFirst({
        where: { invoiceId: invoice.id, payment: { status: 'failed' } },
        orderBy: { createdAt: 'desc' },
        select: { paymentId: true },
      })
      if (allocation) {
        await emitEvent({
          name: 'payment.failed',
          facilityId,
          entityType: 'Payment',
          entityId: allocation.paymentId,
          payload: {
            invoiceId: invoice.id,
            leaseId: invoice.leaseId,
            amountCents: outstanding,
            code: declineCode(error),
            source: 'autopay',
          },
        })
      }

      recordItem({
        itemId: invoice.id,
        ok: false,
        message: `${invoice.number} declined — ${message.slice(0, 200)}`,
      })
    }
  }

  return result
}

async function skipReasonFor(
  invoice: {
    id: string
    lease: { autopayEnabled: boolean; tenant: { stripeDefaultPaymentMethodId: string | null } }
  },
  outstanding: number,
): Promise<SkipReason | null> {
  if (outstanding <= 0) return 'nothing_outstanding'
  if (!invoice.lease.autopayEnabled) return 'autopay_off'
  // Both halves are needed and they live in two places on purpose (B-036): the
  // lease says whether this unit charges itself, the tenant says which card.
  // Either missing means nothing can be charged automatically.
  if (!invoice.lease.tenant.stripeDefaultPaymentMethodId) return 'no_saved_card'

  // A charge already raised for this invoice and not yet resolved. Covers the
  // window between "Stripe took the card" and "the webhook told us", which is
  // seconds — but a catch-up run walking several business dates in one tick
  // passes through that window on purpose.
  const inFlight = await prisma.paymentAllocation.findFirst({
    where: { invoiceId: invoice.id, payment: { status: { in: ['pending', 'succeeded'] } } },
    select: { id: true },
  })
  return inFlight ? 'attempt_in_flight' : null
}

/// Stripe's own decline code, which is what tells B-046 whether to retry at all
/// — `expired_card` short-circuits the schedule (US-20) because retrying a card
/// that has expired three times just annoys the tenant three times.
function declineCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return null
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
