import { prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { createChargeIntent, createCustomerSession } from '@/lib/payments/intents'
import { paymentsEnabled } from '@/lib/payments/stripe'
import {
  payableLeaseWhere,
  portalAccountsFor,
  type AccountLease,
} from '@/lib/billing/accounts'

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
  /// B-232. Ledger entries are instants; the day one happened on is a
  /// facility-local day, and the itemisation names those days.
  facilityTimezone: string
  /// B-232. What this tenant owes across EVERY occupying lease at this
  /// facility — which is the figure the gate rule actually reads
  /// (`tenantStates`), because a grant cannot be partially suspended. Usually
  /// equal to `balanceCents`; different, and load-bearing, for a tenant with
  /// two units.
  facilityBalanceCents: number
  /// B-232. `Facility.accessRestoreAtOrBelowCents`. Zero is D-16's default, not
  /// the rule — the portal used to restate the default as though it were.
  restoreAtOrBelowCents: number
  /// B-232. Whether the gate is actually shut right now. The consequence
  /// sentence is only true, and only wanted, when it is.
  ///
  /// Always the VIEWER's own grant, never the lease holder's — a payer settling
  /// an employee's unit has no grant at that facility and no gate copy to read,
  /// which is the honest silence. What the employee's gate is doing belongs on
  /// the employee's own dashboard.
  accessSuspended: boolean
  /// B-256. Set when this payment is for a whole BUSINESS ACCOUNT rather than
  /// for one unit: `balanceCents` is then the account's total, `leaseId` is an
  /// ANCHOR rather than the thing being paid, and the screen bills the units
  /// instead of the ledger.
  ///
  /// One shape rather than two, deliberately. Everything downstream of here —
  /// `validatePaymentAmount`, `startPortalPayment`, the Payment Element, the
  /// receipt — is the code that decides how much money moves, and a second copy
  /// of it for accounts is a second place for the amount to be wrong.
  account: { id: string; name: string; units: AccountLease[] } | null
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
    // B-256. `payableLeaseWhere` rather than a bare `tenantId`, so the front
    // door matches the money path behind it. `claimsFor` has settled a business
    // account's units out of the payer's money since B-090e, and this function
    // still refused the payer at the URL — the portal could allocate a payment
    // it would not let anybody start. A UNION, so a tenant's own units are
    // reachable exactly as before.
    where: {
      id: leaseId,
      ...payableLeaseWhere(tenantId),
      status: { in: [...OCCUPYING_LEASE_STATUSES] },
    },
    select: {
      id: true,
      facilityId: true,
      facility: {
        select: {
          name: true,
          phone: true,
          timezone: true,
          accessRestoreAtOrBelowCents: true,
        },
      },
      unit: { select: { number: true } },
      monthlyRateCents: true,
    },
  })
  if (!lease) return null

  // B-232. Every occupying lease this tenant holds AT THIS FACILITY, in one
  // grouped read — this lease's balance and the facility-wide one the gate rule
  // reads come out of the same rows, so they cannot be two numbers that drift.
  const [balances, thisLease, grant] = await Promise.all([
    // Deliberately still the viewer's OWN leases, not the widened set: this
    // sum feeds `restoreShortfallCents`, and the gate rule (`tenantStates`)
    // judges a tenant on what THEY owe. Adding the units they merely pay for
    // would state a shortfall the gate does not agree with.
    prisma.ledgerEntry.groupBy({
      by: ['leaseId'],
      where: {
        lease: {
          tenantId,
          facilityId: lease.facilityId,
          status: { in: [...OCCUPYING_LEASE_STATUSES] },
        },
      },
      _sum: { amountCents: true },
    }),
    // Which is why this lease's own balance is read separately — for a payer it
    // is not in the sum above at all.
    prisma.ledgerEntry.aggregate({ where: { leaseId: lease.id }, _sum: { amountCents: true } }),
    prisma.accessGrant.findUnique({
      where: { facilityId_tenantId: { facilityId: lease.facilityId, tenantId } },
      select: { state: true },
    }),
  ])

  const byLease = new Map(balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))

  return {
    leaseId: lease.id,
    facilityId: lease.facilityId,
    facilityName: lease.facility.name,
    facilityPhone: lease.facility.phone,
    unitNumber: lease.unit.number,
    balanceCents: thisLease._sum.amountCents ?? 0,
    monthlyRateCents: lease.monthlyRateCents,
    facilityTimezone: lease.facility.timezone,
    facilityBalanceCents: [...byLease.values()].reduce((sum, cents) => sum + cents, 0),
    restoreAtOrBelowCents: lease.facility.accessRestoreAtOrBelowCents,
    accessSuspended: grant?.state === 'suspended',
    account: null,
  }
}

/// B-256. The whole of a business account, as one thing to pay.
///
/// Authorization and lookup in one call, the same way `payableLease` does it:
/// `portalAccountsFor` returns only accounts this tenant may reach, so an
/// account id in a URL that belongs to somebody else comes back as null rather
/// than as a balance. The tenant id comes from the session, never from the
/// request.
///
/// B-258. `payable` is tested as well as the id. That read model now also
/// returns accounts this tenant is an authorized MEMBER of — sight of an
/// account, deliberately without the ability to pay it — and this is the money
/// path, so a member who types the account's own URL gets the same null a
/// stranger does.
///
/// The returned `leaseId` is an ANCHOR, not the unit being paid. A payment is
/// allocated across every claimable lease in the facility's own order however
/// it is anchored (`claimsFor` via `payableLeaseFilter`), so which unit the
/// button names changes nothing about where the money lands; the anchor exists
/// only so a remainder has somewhere to sit (`postPaymentLedger`). It is the
/// first unit in the list's own sort order, so a reload produces the same
/// idempotency key rather than a second intent.
export async function payableAccount(
  tenantId: string,
  accountId: string,
): Promise<PayableLease | null> {
  const account = (await portalAccountsFor(tenantId)).find(
    (row) => row.id === accountId && row.payable,
  )
  if (!account) return null
  const anchor = account.units[0]
  if (!anchor) return null

  // The same two facts `payableLease` reads, on the same basis: the VIEWER's
  // own leases and the VIEWER's own grant. A payer who holds nothing at this
  // facility gets zero and no grant, which is correct — their gate is not what
  // paying this reopens.
  const [balances, grant, facility] = await Promise.all([
    prisma.ledgerEntry.groupBy({
      by: ['leaseId'],
      where: {
        lease: {
          tenantId,
          facilityId: account.facilityId,
          status: { in: [...OCCUPYING_LEASE_STATUSES] },
        },
      },
      _sum: { amountCents: true },
    }),
    prisma.accessGrant.findUnique({
      where: { facilityId_tenantId: { facilityId: account.facilityId, tenantId } },
      select: { state: true },
    }),
    prisma.facility.findUniqueOrThrow({
      where: { id: account.facilityId },
      select: { accessRestoreAtOrBelowCents: true },
    }),
  ])

  return {
    leaseId: anchor.leaseId,
    facilityId: account.facilityId,
    facilityName: account.facilityName,
    facilityPhone: account.facilityPhone,
    unitNumber: anchor.unitNumber,
    balanceCents: account.balanceCents,
    monthlyRateCents: account.monthlyRateCents,
    facilityTimezone: account.facilityTimezone,
    facilityBalanceCents: balances.reduce((sum, row) => sum + (row._sum.amountCents ?? 0), 0),
    restoreAtOrBelowCents: facility.accessRestoreAtOrBelowCents,
    accessSuspended: grant?.state === 'suspended',
    account: { id: account.id, name: account.name, units: account.units },
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
      // B-256. An account payment is keyed on the ACCOUNT, not on the anchor
      // lease: two accounts can share a facility and an amount, and the anchor
      // is an implementation detail that could change if a unit is detached.
      // The balance is in the key for the reason it always was — a genuine
      // second payment of the same amount comes after the first one moved it.
      reference: lease.account
        ? `portal-account:${lease.account.id}:${amountCents}:${lease.balanceCents}`
        : `portal:${lease.leaseId}:${amountCents}:${lease.balanceCents}`,
      description: lease.account
        ? `Storage payment — ${lease.account.name}`
        : `Storage payment — unit ${lease.unitNumber}`,
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
