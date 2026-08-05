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

export type AmountProblem = 'not_a_number' | 'below_minimum' | 'above_balance' | 'nothing_owed'

export type AmountCheck = { ok: true; amountCents: number } | { ok: false; problem: AmountProblem }

/// Validates a requested payment against what is actually owed.
///
/// Pure, so every boundary is testable without a database or a Stripe key —
/// this is the function that decides how much money moves.
///
/// Overpayment is refused rather than banked. A credit balance has nowhere to
/// go until invoicing exists (B-044): nothing would consume it, and the
/// dashboard would show a negative balance it has no wording for. Refusing
/// also catches the fat-finger case — $1,610.00 typed for $16.10 — which is
/// the expensive direction to get wrong. Prepayment comes back with B-044.
export function validatePaymentAmount(input: string, balanceCents: number): AmountCheck {
  if (balanceCents <= 0) return { ok: false, problem: 'nothing_owed' }

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
  if (amountCents > balanceCents) return { ok: false, problem: 'above_balance' }
  return { ok: true, amountCents }
}

export type PayableLease = {
  leaseId: string
  facilityId: string
  facilityName: string
  facilityPhone: string | null
  unitNumber: string
  balanceCents: number
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
  status: 'succeeded' | 'pending' | 'failed'
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
    status: payment.status === 'succeeded' ? 'succeeded' : payment.status === 'failed' ? 'failed' : 'pending',
    amountCents: payment.amountCents,
    receivedAt: payment.receivedAt,
    unitNumber: lease?.unit.number ?? null,
    facilityName: lease?.facility.name ?? null,
    balanceCents: balance ? (balance._sum.amountCents ?? 0) : null,
    failureReason: payment.failureReason,
  }
}
