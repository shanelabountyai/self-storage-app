import { prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { createChargeIntent, createCustomerSession } from '@/lib/payments/intents'
import { paymentsEnabled } from '@/lib/payments/stripe'

// PRD 01 §4.7 US-703 / §4.6. A tenant paying their own balance from the
// portal. The amount is decided here, server-side, from the ledger — never
// from the form, which would let the payer choose what they owe.

/// Stripe's own floor for a USD card charge is 50c; a dollar is the smallest
/// amount worth the interchange on either side of it.
export const MIN_PAYMENT_CENTS = 100

export type AmountProblem =
  | 'not_a_number'
  | 'below_minimum'
  | 'above_balance'
  | 'above_prepay_ceiling'
  | 'nothing_owed'

export type AmountCheck = { ok: true; amountCents: number } | { ok: false; problem: AmountProblem }

/// Validates a requested payment against what is actually owed.
///
/// Pure, so every boundary is testable without a database or a Stripe key —
/// this is the function that decides how much money moves.
///
/// **B-225 lifted the blanket refusal on overpayment.** The old comment here
/// read: *"a credit balance has nowhere to live… Prepayment comes back with
/// B-044"*. B-044 shipped without it, and the refusal outlived its reason by
/// long enough to become the reason the product would not take money a tenant
/// was trying to give it. Credit now exists, three jobs spend it, and the
/// counter can direct it — so a tenant paying six months up front is a
/// supported thing rather than an error message.
///
/// **The fat-finger case is still refused, and that is why a ceiling replaces
/// the rule rather than deleting it.** $1,610.00 typed for $16.10 is the
/// expensive direction to get wrong, and "any amount at all" would take it
/// silently. `prepayCeilingCents` is what the caller is willing to bank beyond
/// the balance; it defaults to ZERO, so every caller that has not thought about
/// prepayment keeps exactly today's behaviour and no screen changes by accident.
export function validatePaymentAmount(
  input: string,
  balanceCents: number,
  prepayCeilingCents = 0,
): AmountCheck {
  // Nothing owed AND nothing bankable. A tenant who is paid up can still pay
  // ahead where the caller allows it — refusing that is the same defect one
  // step along.
  if (balanceCents <= 0 && prepayCeilingCents <= 0) return { ok: false, problem: 'nothing_owed' }

  // Accept "161", "161.00", "$161.00", "1,610.50" — a human typing a number of
  // dollars, not a machine posting cents.
  const cleaned = input.trim().replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { ok: false, problem: 'not_a_number' }

  // Parsed as a decimal string rather than via floating point: Math.round of
  // (parseFloat * 100) turns 16.10 into 1609.9999... on some inputs, and money
  // that rounds is money that is wrong.
  const [dollars, fraction = ''] = cleaned.split('.')
  const amountCents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'))

  if (!Number.isSafeInteger(amountCents)) return { ok: false, problem: 'not_a_number' }
  if (amountCents < MIN_PAYMENT_CENTS) return { ok: false, problem: 'below_minimum' }
  if (amountCents > balanceCents + prepayCeilingCents) {
    // Two different refusals, because they need two different sentences. With
    // no ceiling the answer is "pay what you owe"; with one, the tenant is
    // doing something we support and has simply gone past the limit, and
    // telling them to "enter your balance or less" would be wrong.
    return {
      ok: false,
      problem: prepayCeilingCents > 0 ? 'above_prepay_ceiling' : 'above_balance',
    }
  }
  return { ok: true, amountCents }
}

export type PayableLease = {
  leaseId: string
  facilityId: string
  facilityName: string
  facilityPhone: string | null
  unitNumber: string
  balanceCents: number
  /// B-225. What a month costs, so a prepayment ceiling can be stated in months
  /// rather than as a bare number of dollars nobody can justify.
  monthlyRateCents: number
}

/// B-225. How far past the balance a tenant may pay from the portal.
///
/// Twelve months of rent. It is a FAT-FINGER GUARD, not a policy about how far
/// ahead somebody may pay — the number is deliberately far past any real
/// prepayment so that it never refuses a genuine one, while still catching
/// $1,610.00 typed for $16.10 on a $161 unit. A tenant who really wants to pay
/// two years up front is a conversation with the office, and the screen says so.
export function prepayCeilingFor(lease: { monthlyRateCents: number }): number {
  return lease.monthlyRateCents * 12
}

/// The lease a tenant is allowed to pay, or null.
///
/// Authorization and lookup in one query on purpose: every caller needs both,
/// and a version that returned the lease first and checked ownership second is
/// the shape that eventually ships with the check dropped. `tenantId` comes
/// from the session (`requireTenantActor`), never from the request.
export async function payableLease(tenantId: string, leaseId: string): Promise<PayableLease | null> {
  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: {
      id: true,
      facilityId: true,
      facility: { select: { name: true, phone: true } },
      unit: { select: { number: true } },
      monthlyRateCents: true,
    },
  })
  if (!lease) return null

  const balance = await prisma.ledgerEntry.aggregate({
    where: { leaseId: lease.id },
    _sum: { amountCents: true },
  })

  return {
    leaseId: lease.id,
    facilityId: lease.facilityId,
    facilityName: lease.facility.name,
    facilityPhone: lease.facility.phone,
    unitNumber: lease.unit.number,
    balanceCents: balance._sum.amountCents ?? 0,
    monthlyRateCents: lease.monthlyRateCents,
  }
}

export type PortalPaymentSetup =
  | { available: false }
  | {
      available: true
      clientSecret: string
      customerSessionSecret: string | null
      paymentId: string
      amountCents: number
    }

/// Raises the PaymentIntent for a portal payment.
///
/// The idempotency key (inside `createChargeIntent`) is derived from the
/// lease, the amount AND the balance the amount was chosen against, so:
/// reloading this page returns the same intent rather than a second one, and
/// a genuine second payment of the same amount gets a different key because
/// the first one moved the balance. The one case those collide — paying $X,
/// having exactly $X refunded, then paying $X again inside 24 hours — returns
/// the already-succeeded intent, which the Payment Element refuses. That
/// fails visibly and collects nothing, which is the correct direction for a
/// key collision to fail.
export async function startPortalPayment(
  tenantId: string,
  lease: PayableLease,
  amountCents: number,
): Promise<PortalPaymentSetup> {
  if (!paymentsEnabled()) return { available: false }

  const [intent, customerSessionSecret] = await Promise.all([
    createChargeIntent({
      facilityId: lease.facilityId,
      tenantId,
      leaseId: lease.leaseId,
      amountCents,
      reference: `portal:${lease.leaseId}:${amountCents}:${lease.balanceCents}`,
      description: `Storage payment — unit ${lease.unitNumber}`,
      // The tenant asked to pay a bill, not to store a card. Autopay
      // enrolment and method management are B-036's, with their own
      // disclosure; silently retaining a card here would be neither.
      saveMethod: false,
    }),
    createCustomerSession(tenantId),
  ])

  return {
    available: true,
    clientSecret: intent.clientSecret,
    customerSessionSecret,
    paymentId: intent.paymentId,
    amountCents,
  }
}

export type PaymentReceipt = {
  /// B-103 adds `processing`: a bank debit accepted but not settled. Kept
  /// distinct from `pending` because the wait is days rather than seconds, and
  /// telling somebody their balance will move "within a minute or two" when it
  /// will not is how a correct system produces a support call.
  status: 'succeeded' | 'pending' | 'processing' | 'failed'
  amountCents: number
  receivedAt: Date
  unitNumber: string | null
  facilityName: string | null
  balanceCents: number | null
  failureReason: string | null
}

/// The receipt for a payment the tenant just made.
///
/// Scoped to `tenantId` so a payment id in a URL cannot read someone else's
/// receipt. `status` is whatever the webhook has recorded so far — this
/// deliberately does not ask Stripe: the ledger is the tenant-facing source of
/// truth (§7.3), and a screen that read Stripe directly would show a balance
/// the rest of the portal disagrees with for as long as the webhook is in
/// flight.
export async function paymentReceipt(
  tenantId: string,
  paymentId: string,
): Promise<PaymentReceipt | null> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, tenantId },
    select: {
      amountCents: true,
      status: true,
      receivedAt: true,
      failureReason: true,
      facilityId: true,
      ledgerEntries: { select: { leaseId: true }, take: 1 },
    },
  })
  if (!payment) return null

  const leaseId = payment.ledgerEntries[0]?.leaseId ?? null
  const lease = leaseId
    ? await prisma.lease.findUnique({
        where: { id: leaseId },
        select: { facility: { select: { name: true } }, unit: { select: { number: true } } },
      })
    : null

  const balance = leaseId
    ? await prisma.ledgerEntry.aggregate({ where: { leaseId }, _sum: { amountCents: true } })
    : null

  return {
    // Anything not yet marked succeeded or failed is still in flight. The
    // screen says so rather than claiming a payment that has not landed.
    // A refunded or partially-refunded payment still reads as succeeded here:
    // the receipt is about the payment that was taken, and the refund is its
    // own row with its own receipt.
    status:
      payment.status === 'failed'
        ? 'failed'
        : payment.status === 'processing'
          ? 'processing'
          : payment.status === 'pending'
            ? 'pending'
            : 'succeeded',
    amountCents: payment.amountCents,
    receivedAt: payment.receivedAt,
    unitNumber: lease?.unit.number ?? null,
    facilityName: lease?.facility.name ?? null,
    balanceCents: balance ? (balance._sum.amountCents ?? 0) : null,
    failureReason: payment.failureReason,
  }
}
