import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { reconcile, type ReconciliationInput } from '@storage/core/billing'

import { reconciliationInputs } from '@/lib/admin/ledger'

import { toAuditActor } from '@/lib/rbac/audit-actor'
import { assertFacilityAccess, checkMonetaryAuthority, nextApproverRole } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// B-303 / PRD 02 §4.10 US-38, US-25. The repairs the exception report has been
// telling people to make since B-277 shipped.
//
// `/admin/reports/ledger-exceptions` said the remedy was "an adjustment on that
// lease's ledger, or a corrected invoice", and neither existed: every writer of
// `ledgerEntry.create` was an automated path, `write_off` was reachable only
// from a move-out, and a rent invoice could be voided by nobody. A lease that
// cannot be reconciled cannot be noticed (`claimForNotice` refuses it), and a
// lease that cannot be noticed can never be auctioned while the balance
// compounds and the unit stays full of somebody else's belongings. The only
// path to agreement was a database client.
//
// Three operations, one gate. All three go through `checkMonetaryAuthority`
// with the `credit` action — `credits:manual` plus B-197's per-role
// `maxCreditCents` — because all three post value that did not come from a
// tenant handing money over. That is the shape `fees:waive` already has, and
// the row was explicit that this must not mint a fourth permission.
//
// **`isCorrection` is what makes the adjustment work at all.** The identity is
// `ledgerBalance = invoiceOutstanding + uninvoicedCharges`; an entry with no
// invoice behind it lands on both sides and cancels itself, so a plain
// adjustment moves the difference by zero. See the column's comment in
// `schema.prisma`.

const ZERO: ReconciliationInput = {
  ledgerBalanceCents: 0,
  invoiceOutstandingCents: 0,
  uninvoicedChargeCents: 0,
}

export type CorrectionRefusal =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'missing_reason' }
  | { ok: false; reason: 'bad_amount' }
  | { ok: false; reason: 'nothing_to_do' }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'over_limit'; limitCents: number; escalateTo: string | null }

/// The one authority check the three operations share, measured on the
/// magnitude of what is being posted.
///
/// Signed amounts are the ledger's convention, not the ladder's: a correction
/// of −$40 and one of +$40 are the same amount of discretion, and a limit that
/// only bit in one direction would let a staffer add debt to a tenant's account
/// without any at all.
async function authorize(
  actor: Actor,
  facilityId: string,
  amountCents: number,
): Promise<CorrectionRefusal | null> {
  const magnitude = Math.abs(amountCents)
  const decision = checkMonetaryAuthority(actor, 'credit', magnitude, facilityId)
  if (decision.allowed) return null
  if (decision.reason === 'forbidden') return { ok: false, reason: 'forbidden' }

  const approver = await nextApproverRole('credit', magnitude, decision.escalateToRank ?? 0)
  return {
    ok: false,
    reason: 'over_limit',
    limitCents: decision.limitCents,
    escalateTo: approver?.name ?? null,
  }
}

async function correctableLease(actor: Actor, leaseId: string) {
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { id: true, facilityId: true, tenantId: true, status: true },
  })
  if (!lease) return null
  assertFacilityAccess(actor, lease.facilityId)
  return lease
}

// ------------------------------------------------------------ adjustment ----

export type AdjustResult =
  | { ok: true; balanceChangeCents: number; entries: number }
  | CorrectionRefusal

/// Restate one lease's ledger so it agrees with its invoices again.
///
/// `balanceChangeCents` is SIGNED and is the only thing the operator decides:
/// how much what this tenant owes should move. Negative reduces it. **Zero is a
/// legitimate answer** and is the whole reason this takes a balance change
/// rather than an entry amount — see the two shapes below.
///
/// ONE ledger entry cannot repair both of B-292's permanently-broken shapes,
/// and that is worth spelling out because it is not obvious and it is what the
/// mechanism here is for. The identity is
///
///     difference = ledgerBalance − invoiceOutstanding − uninvoicedCharges
///
/// * **A payment split across units before B-257.** Lease Q's invoice is paid,
///   but the payment entry went onto lease P, so Q's ledger still says $100 is
///   owed by a tenant who paid. The BALANCE is wrong. It has to move by −$100,
///   and an entry that also lands in the uninvoiced term moves the difference
///   by nothing — which is why a plain adjustment has never been able to clear
///   a row on the exception report.
/// * **A partially paid invoice moved by a transfer.** Lease A's balance is
///   already correct at $0; what is wrong is that A still carries the $50
///   payment entry whose invoice went to lease B, so the uninvoiced term reads
///   −$50 and the difference reads +$50 for ever. Moving the balance here would
///   hand the tenant a $50 credit they do not have — and the delinquency engine
///   cures on the ledger balance, so a false credit is not cosmetic.
///
/// So the operator states the balance change, and this works out the rest: with
/// `D` the current difference, the uninvoiced term has to move by `D + change`,
/// and the pair of entries that achieves both is one ordinary entry of `D +
/// change` (which lands on both sides) and one `isCorrection` entry of
/// `change − (D + change)` (which lands only on the balance). Either can come
/// out at zero and is then not written — a lease that already reconciles gets
/// exactly one plain adjustment, which is all a plain adjustment ever meant.
///
/// It does not touch a `Payment` row and it does not touch an invoice. Money
/// that actually moved is `refundPayment`'s and `returnPayment`'s; an invoice
/// that should never have been raised is `voidRentInvoice` below.
export async function postLedgerAdjustment(
  actor: Actor,
  input: { leaseId: string; balanceChangeCents: number; reasonCode: string; note?: string },
): Promise<AdjustResult> {
  if (!input.reasonCode?.trim()) return { ok: false, reason: 'missing_reason' }
  if (!Number.isInteger(input.balanceChangeCents)) return { ok: false, reason: 'bad_amount' }

  const lease = await correctableLease(actor, input.leaseId)
  if (!lease) return { ok: false, reason: 'not_found' }

  const inputs = await reconciliationInputs({ leaseIds: [lease.id] })
  const differenceCents = reconcile(inputs.get(lease.id) ?? ZERO).differenceCents

  const balanceChange = input.balanceChangeCents
  const uninvoicedChange = differenceCents + balanceChange
  // Nothing to say: the lease already agrees with its invoices and the operator
  // is not moving the balance. Writing a pair of zero entries would put two
  // lines on a tenant's ledger that mean nothing.
  if (balanceChange === 0 && uninvoicedChange === 0) return { ok: false, reason: 'nothing_to_do' }

  const refusal = await authorize(
    actor,
    lease.facilityId,
    Math.max(Math.abs(balanceChange), Math.abs(uninvoicedChange)),
  )
  if (refusal) return refusal

  const entries = [
    // Ordinary: counted as a charge with no invoice behind it, so it moves both
    // sides of the identity and leaves the difference where it was.
    { amountCents: uninvoicedChange, isCorrection: false, what: 'invoice cover' },
    // A correction: the balance moves and the uninvoiced term does not.
    { amountCents: balanceChange - uninvoicedChange, isCorrection: true, what: 'balance' },
  ].filter((entry) => entry.amountCents !== 0)

  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: lease.facilityId,
          leaseId: lease.id,
          type: 'adjustment',
          amountCents: entry.amountCents,
          isCorrection: entry.isCorrection,
          description:
            entries.length === 1
              ? `Ledger correction (${input.reasonCode})`
              : `Ledger correction — ${entry.what} (${input.reasonCode})`,
        },
      })
    }

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'ledger.adjusted',
        entityType: 'Lease',
        entityId: lease.id,
        facilityId: lease.facilityId,
        reasonCode: input.reasonCode,
        context: {
          balanceChangeCents: balanceChange,
          // The disagreement being resolved, as it stood when the correction
          // was posted. Without it the log records a $0 balance change on a
          // lease that was $50 out and says nothing about what was repaired.
          differenceCents,
          note: input.note ?? null,
        },
      },
      tx,
    )
  })

  return { ok: true, balanceChangeCents: balanceChange, entries: entries.length }
}

// ------------------------------------------------------------- write-off ----

export type WriteOffResult =
  | { ok: true; amountCents: number; invoicesMarked: number }
  | CorrectionRefusal

/// Write off what an OPEN lease owes, as bad debt.
///
/// Until this, `write_off` was written in exactly one place — `closeMoveOut` —
/// so a balance on a lease that is still running could not be forgiven at all.
///
/// The whole balance, not a typed amount, and the invoices go with it. A
/// write-off that only reduced the ledger would leave the invoices still
/// outstanding and the lease failing to reconcile from that moment on — it
/// would MAKE an exception of exactly the kind this file exists to clear. So
/// each open invoice it covers is marked `uncollectible` (not `void`: the money
/// was genuinely owed, we are simply not going to get it, and the revenue
/// report has to be able to tell forgiven debt from an invoice that should
/// never have existed) and carries its own write-off entry, with any remainder
/// that no invoice backs posted as one uninvoiced entry — which keeps both
/// sides of the identity moving together.
///
/// An invoice larger than what is left to write off is left alone rather than
/// part-written-off. That only arises on a lease that did not reconcile to
/// begin with, and the adjustment above is the tool for that; a partial
/// write-off against an invoice would invent a third state for it.
export async function writeOffOpenLeaseBalance(
  actor: Actor,
  input: { leaseId: string; reasonCode: string; note?: string },
): Promise<WriteOffResult> {
  if (!input.reasonCode?.trim()) return { ok: false, reason: 'missing_reason' }

  const lease = await correctableLease(actor, input.leaseId)
  if (!lease) return { ok: false, reason: 'not_found' }

  const [balance, invoices] = await Promise.all([
    prisma.ledgerEntry.aggregate({ where: { leaseId: lease.id }, _sum: { amountCents: true } }),
    prisma.invoice.findMany({
      where: { leaseId: lease.id, status: { in: ['open', 'partially_paid'] } },
      orderBy: { periodStart: 'asc' },
      select: { id: true, number: true, totalCents: true, amountPaidCents: true },
    }),
  ])

  const owed = balance._sum.amountCents ?? 0
  if (owed <= 0) return { ok: false, reason: 'nothing_to_do' }

  const refusal = await authorize(actor, lease.facilityId, owed)
  if (refusal) return refusal

  let remaining = owed
  const covered: { id: string; number: string; outstanding: number }[] = []
  for (const invoice of invoices) {
    const outstanding = invoice.totalCents - invoice.amountPaidCents
    if (outstanding <= 0 || outstanding > remaining) continue
    covered.push({ id: invoice.id, number: invoice.number, outstanding })
    remaining -= outstanding
  }

  await prisma.$transaction(async (tx) => {
    for (const invoice of covered) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: lease.facilityId,
          leaseId: lease.id,
          type: 'write_off',
          // Signed: a write-off reduces what is owed.
          amountCents: -invoice.outstanding,
          description: `Written off — invoice ${invoice.number} (${input.reasonCode})`,
          invoiceId: invoice.id,
        },
      })
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'uncollectible' } })
    }

    if (remaining > 0) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: lease.facilityId,
          leaseId: lease.id,
          type: 'write_off',
          amountCents: -remaining,
          description: `Written off — charges not yet invoiced (${input.reasonCode})`,
        },
      })
    }

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'balance.written_off',
        entityType: 'Lease',
        entityId: lease.id,
        facilityId: lease.facilityId,
        reasonCode: input.reasonCode,
        context: {
          amountCents: owed,
          invoiceNumbers: covered.map((invoice) => invoice.number),
          uninvoicedCents: remaining,
          note: input.note ?? null,
        },
      },
      tx,
    )
  })

  return { ok: true, amountCents: owed, invoicesMarked: covered.length }
}

// ---------------------------------------------------------- invoice void ----

export type VoidInvoiceResult = { ok: true; amountCents: number; number: string } | CorrectionRefusal

/// Void a rent invoice that should never have been raised.
///
/// `waiveFeeInvoice` has done exactly this for FEE invoices since B-047 and
/// refuses anything else (`invoice.kind !== 'fee'`), so a rent invoice raised in
/// error — the wrong period, a lease that had already moved out, a rate that
/// was never agreed — could be corrected by nobody. This is its counterpart and
/// deliberately not a widening of it: a fee waiver is a discretionary give-away
/// governed by `fees:waive`, and this is a statement that a charge was wrong.
/// Sharing one function would make either of them a second way to do the other,
/// which the row forbids.
///
/// Same shape as the waiver, and for the same reason: the invoice stays, the
/// charge stays, and the entry that cancelled it is visible next to both. An
/// invoice that quietly vanished is what an auditor asks about. The entry
/// carries the invoice id, so the reconciliation counts it against that invoice
/// rather than as an uninvoiced charge and the lease still reconciles
/// afterwards — it is NOT `isCorrection`.
///
/// **Re-billing the period is not built.** `invoice_one_rent_per_period` is a
/// partial unique index on `(leaseId, periodStart) where kind = 'rent'` and it
/// does not exclude voided rows, so the generator will not raise that period
/// again. Excluding them is four lines of SQL and was deliberately not done
/// here: `markDiscountApplied` and `markReferralRewardApplied` are consumed per
/// period inside the same transaction that raised the invoice, so a re-raise
/// today silently drops a promotion a tenant was promised. B-327 owns it. The
/// working repair in the meantime is `postFeeCharge`, which raises a correctly
/// priced charge under its own authority.
export async function voidRentInvoice(
  actor: Actor,
  input: { invoiceId: string; reasonCode: string; note?: string },
): Promise<VoidInvoiceResult> {
  if (!input.reasonCode?.trim()) return { ok: false, reason: 'missing_reason' }

  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true,
      kind: true,
      number: true,
      status: true,
      facilityId: true,
      leaseId: true,
      totalCents: true,
      amountPaidCents: true,
    },
  })
  if (!invoice || invoice.kind !== 'rent') return { ok: false, reason: 'not_found' }
  assertFacilityAccess(actor, invoice.facilityId)

  const outstanding = invoice.totalCents - invoice.amountPaidCents
  // Money already taken against it is a refund, which is B-048's, with its own
  // permission and its own limit. Voiding it here would leave a settled
  // payment allocated to an invoice that no longer exists.
  if (outstanding <= 0 || invoice.status === 'void' || invoice.status === 'uncollectible') {
    return { ok: false, reason: 'nothing_to_do' }
  }

  const refusal = await authorize(actor, invoice.facilityId, outstanding)
  if (refusal) return refusal

  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.create({
      data: {
        facilityId: invoice.facilityId,
        leaseId: invoice.leaseId,
        type: 'adjustment',
        amountCents: -outstanding,
        description: `Invoice ${invoice.number} voided (${input.reasonCode})`,
        invoiceId: invoice.id,
      },
    })

    await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'void' } })

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'invoice.voided',
        entityType: 'Invoice',
        entityId: invoice.id,
        facilityId: invoice.facilityId,
        reasonCode: input.reasonCode,
        context: {
          leaseId: invoice.leaseId,
          number: invoice.number,
          amountCents: outstanding,
          note: input.note ?? null,
        },
      },
      tx,
    )
  })

  return { ok: true, amountCents: outstanding, number: invoice.number }
}
