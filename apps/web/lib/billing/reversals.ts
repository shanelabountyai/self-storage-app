import { prisma } from "@storage/db";
import { recordAudit } from "@storage/core/audit";
import { emitEvent } from "@storage/core/events";
import { can, ForbiddenError } from "@/lib/rbac/authorize";
import { toAuditActor } from "@/lib/rbac/audit-actor";
import type { Actor } from "@/lib/rbac/actor";
import { applyPayment, recomputeInvoices } from "@/lib/billing/allocation";
import { raiseFeeInvoice, scheduledFeeCents } from "@/lib/billing/fee-invoice";
import { cancelOpenTask, createTask } from "@/lib/admin/tasks";
import { leaseChainIds } from "@/lib/billing/transfer-chain";

// PRD 02 §4.5 US-46, US-21, US-23; §5.3 FR-8 (B-146). A payment that came back.
//
// ── What was missing, exactly ───────────────────────────────────────────────
//
// `LedgerEntry.reversalOfId` has existed since B-002 carrying a schema comment
// citing FR-8, and was written by NO code. `FeeType.nsf` has been configurable
// per facility since B-047 and was read by NO code. So a bounced cheque or an
// ACH return left the money recorded as collected, the invoices reading `paid`,
// and the arrears invisible to `daysPastDue` — forever.
//
// ── Why not `refundPayment` ─────────────────────────────────────────────────
//
// It is the wrong tool and reaching for it is worse than doing nothing. A
// refund is money we HAND BACK: for cash and cheque it comes out of the open
// drawer (B-078), so recording a bounce that way makes the till short by money
// that never left it, and it writes a second `Payment` row the deposits report
// then counts as an outgoing. Nothing left the building here. The bank simply
// took back what it had provisionally given us.
//
// ── What B-103 already covered, and why this is still a gap ─────────────────
//
// `reconcile.ts` handles an ACH that is accepted and then fails BEFORE
// settling: the payment sits at `processing`, which is deliberately outside
// `SETTLING_STATUSES`, so no invoice was ever marked paid and — as its comment
// says — "the balance is already correct". Nothing needs reversing.
//
// This file is the other case: a payment that reached `succeeded`. The ledger
// entry was posted, the invoices were settled, a receipt number was issued, and
// for a counter cheque a drawer was counted with it inside. All of that has to
// be undone WITHOUT rewriting any of it, which is what FR-8's append-only rule
// means and what `reversalOfId` was put there for.

export type ReturnPaymentResult =
  | {
      ok: true;
      reversalEntryId: string;
      /// The NSF fee invoice, when the facility has one configured.
      feeInvoiceNumber: string | null;
      feeCents: number;
      /// Invoices that went back to `open` or `partially_paid`.
      reopenedInvoiceIds: string[];
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "missing_reason"
        | "not_settled"
        | "already_returned"
        | "nothing_posted";
    };

export type ReturnPaymentInput = {
  /// Why it came back, in the bank's terms — "insufficient funds", "account
  /// closed", "stop payment". Required, and audited: `payment.returned` is a
  /// money-moving correction and FR-8's whole point is that a correction is
  /// itself a record.
  reasonCode: string;
  note?: string;
  /// Skip the configured NSF fee. The ordinary case for a bank error or a
  /// facility's own mistake, and audited as a deliberate choice rather than
  /// achieved by deleting the fee afterwards.
  waiveFee?: boolean;
};

/// Records that a settled payment was returned by the bank.
///
/// One transaction for everything that must agree: the reversing ledger entry,
/// the unwound allocations, the re-opened invoices, the payment's own state and
/// the NSF fee. A reversal that posted without re-opening its invoices would
/// move the balance and leave AR ageing lying, which is the same split B-048
/// was raised to fix on the way in.
/// The gate on both directions of a bank-imposed reversal.
///
/// `refunds:approve` rather than a new permission key: this is the existing
/// "move money backwards" gate, and it is manager-and-above, which is the right
/// level for something that re-opens invoices and charges a fee.
///
/// Deliberately NOT `checkMonetaryAuthority`. A refund limit exists because a
/// staffer CHOOSES the amount; here the bank chose it, and refusing to record a
/// $2,000 returned cheque because it exceeds somebody's refund limit would leave
/// the money recorded as collected — which is the defect, not a control.
///
/// A `system` actor passes (B-147). The seeded system role is deliberately
/// narrow and does NOT hold `refunds:approve` — widening it there would hand the
/// delinquency engine a refund button. But the Stripe dispute webhook is not
/// exercising discretion: the money has already left the account, and the only
/// choice available is whether our records admit it. `systemActor` is
/// constructible in server code only, behind a verified webhook signature.
function requireReversalAuthority(actor: Actor, facilityId: string): void {
  if (actor.kind === "system") return;
  if (!can(actor, "refunds:approve", facilityId)) {
    throw new ForbiddenError(
      "Missing permission refunds:approve",
      "refunds:approve",
      facilityId,
    );
  }
}

export async function returnPayment(
  actor: Actor,
  paymentId: string,
  input: ReturnPaymentInput,
): Promise<ReturnPaymentResult> {
  if (!input.reasonCode?.trim()) return { ok: false, reason: "missing_reason" };

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      facilityId: true,
      tenantId: true,
      amountCents: true,
      method: true,
      status: true,
      receiptNumber: true,
      ledgerEntries: {
        where: { type: "payment" },
        select: { id: true, leaseId: true, occurredAt: true },
      },
      allocations: { select: { id: true, invoiceId: true } },
    },
  });
  if (!payment) return { ok: false, reason: "not_found" };

  requireReversalAuthority(actor, payment.facilityId);

  if (payment.status === "returned")
    return { ok: false, reason: "already_returned" };
  // Only money that actually settled can come back. `processing` is B-103's
  // case and needs no reversal; `failed` and `pending` never posted anything.
  if (payment.status !== "succeeded")
    return { ok: false, reason: "not_settled" };

  const posted = payment.ledgerEntries[0];
  // A `succeeded` payment with no ledger entry is a merchandise sale or a
  // payment against no lease. There is nothing to reverse on a lease ledger,
  // and inventing an entry would attach the money to a lease it never touched.
  if (!posted) return { ok: false, reason: "nothing_posted" };

  // A payment that was returned and later REINSTATED (B-147's won dispute) is
  // `succeeded` again, so the status check above lets a second return through —
  // and `reversalOfId` is unique, so creating a second reversal of the same
  // posted entry throws inside the transaction. From a webhook that is a 500
  // Stripe retries for days. Refuse it here instead, with the reason that is
  // true: this entry has already been reversed once and that pair still stands.
  const alreadyReversed = await prisma.ledgerEntry.findUnique({
    where: { reversalOfId: posted.id },
    select: { id: true },
  });
  if (alreadyReversed) return { ok: false, reason: "already_returned" };

  const invoiceIds = payment.allocations.map(
    (allocation) => allocation.invoiceId,
  );

  const result = await prisma.$transaction(async (tx) => {
    // FR-8: append-only. The original entry is untouched — money DID arrive on
    // that date against a receipt the tenant is holding — and the correction is
    // a new entry pointing back at it through the column that has been waiting
    // since B-002.
    const reversal = await tx.ledgerEntry.create({
      data: {
        facilityId: payment.facilityId,
        leaseId: posted.leaseId,
        // `adjustment`, not `refund`: a refund is money we handed back, and
        // nothing left the building. The sign is positive because the tenant
        // owes it again.
        type: "adjustment",
        amountCents: payment.amountCents,
        description: `Returned ${payment.method.replace("_", " ")} payment${
          payment.receiptNumber !== null
            ? `, receipt #${payment.receiptNumber}`
            : ""
        } — ${input.reasonCode}`,
        paymentId: payment.id,
        reversalOfId: posted.id,
      },
    });

    // The money settled nothing. Deleting the allocations and recomputing is
    // what re-opens the invoices — and `daysPastDue` anchors to the OLDEST
    // unpaid invoice's ORIGINAL due date (D-25), so the arrears reappear with
    // the age they always had rather than starting the clock again today.
    await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } });
    await recomputeInvoices(tx, invoiceIds);

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "returned", failureReason: input.reasonCode.trim() },
    });

    const fee = input.waiveFee
      ? null
      : await assessNsfFee(tx, payment, input.reasonCode);

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: "payment.returned",
        entityType: "Payment",
        entityId: payment.id,
        facilityId: payment.facilityId,
        reasonCode: input.reasonCode,
        context: {
          amountCents: payment.amountCents,
          method: payment.method,
          receiptNumber: payment.receiptNumber,
          reversalEntryId: reversal.id,
          reopenedInvoiceIds: invoiceIds,
          feeInvoiceNumber: fee?.number ?? null,
          feeCents: fee?.amountCents ?? 0,
          // Recorded as a choice rather than inferred from the absence of a
          // fee, which would read identically to a facility that configured none.
          feeWaived: Boolean(input.waiveFee),
          note: input.note ?? null,
        },
      },
      tx,
    );

    await emitEvent(
      {
        name: "payment.returned",
        facilityId: payment.facilityId,
        entityType: "Payment",
        entityId: payment.id,
        payload: {
          amountCents: payment.amountCents,
          method: payment.method,
          feeCents: fee?.amountCents ?? 0,
        },
      },
      tx,
    );

    return { reversalEntryId: reversal.id, fee };
  });

  // Outside the transaction, on the same reasoning `reconcile.ts` gives for the
  // ACH bounce it already raises: a task-store failure must not roll back the
  // record of the return itself.
  //
  // `settling_payment_failed`, which already exists for exactly this
  // conversation — B-103's own comment describes it as "a tenant who has a
  // receipt, may have been let through a gate on it, and will now start getting
  // dunning letters". US-41's rule is one queue, not a new one per source.
  await createTask({
    facilityId: payment.facilityId,
    type: "settling_payment_failed",
    entityType: "Payment",
    entityId: payment.id,
    priority: "high",
  });

  await resumeLadderAfterReversal(
    payment.facilityId,
    posted.leaseId,
    posted.occurredAt,
  );

  return {
    ok: true,
    reversalEntryId: result.reversalEntryId,
    feeInvoiceNumber: result.fee?.number ?? null,
    feeCents: result.fee?.amountCents ?? 0,
    reopenedInvoiceIds: invoiceIds,
  };
}

/// B-161 / D-92. Puts back the delinquency history the cure closed out.
///
/// When the tenant paid, the nightly run's `cure()` superseded every open step
/// run — deliberately, so that a NEW delinquency starts at day one rather than
/// resuming at day 30. A reversal is not a new delinquency. The money never
/// arrived, D-25 restores the invoices at their original due date, and the
/// notices that were served really were served. Leaving the history closed puts
/// the tenant back at full age with an empty record, which is precisely how one
/// returned ACH re-serves the entire ladder.
///
/// Owner decision D-92: resume at the stage reached, which is also what stops a
/// tenant deferring an auction indefinitely by paying and reversing. A facility
/// that would rather re-serve everything sets `reversalResumes = false` and this
/// does nothing.
///
/// Scoped to runs superseded at or after the payment posted: those are the ones
/// this money closed. An older episode the tenant genuinely settled and moved
/// past stays closed.
async function resumeLadderAfterReversal(
  facilityId: string,
  leaseId: string,
  paymentPostedAt: Date,
): Promise<void> {
  const timeline = await prisma.delinquencyTimeline.findFirst({
    where: { facilityId, active: true },
    orderBy: { version: "desc" },
    select: { reversalResumes: true },
  });
  if (!timeline?.reversalResumes) return;

  // Chain-wide, because `cure()` supersedes chain-wide (B-138): an episode that
  // began on the lease this one was transferred out of is the same episode.
  const chains = await leaseChainIds([leaseId]);
  for (const id of chains.get(leaseId) ?? [leaseId]) {
    // Per lease, because the partial unique index is per (leaseId, dayOffset)
    // where `supersededAt` is null. A day already live on this lease belongs to
    // an episode that started after the cure; restoring the old row would
    // collide, and skipping the whole batch would re-serve its notice.
    const live = await prisma.delinquencyStepRun.findMany({
      where: { leaseId: id, supersededAt: null },
      select: { dayOffset: true },
    });
    await prisma.delinquencyStepRun.updateMany({
      where: {
        leaseId: id,
        supersededAt: { gte: paymentPostedAt },
        dayOffset: { notIn: live.map((run) => run.dayOffset) },
      },
      data: { supersededAt: null },
    });
  }
}

export type ReinstatePaymentResult =
  | {
      ok: true;
      /// The entry that reverses the reversal. FR-8 again: three rows, none
      /// edited, and the pair either side of the original tells the story.
      entryId: string;
      /// Invoices this money settled on the way back in. NOT necessarily the
      /// ones it settled the first time — see the note in the body.
      reallocatedInvoiceIds: string[];
    }
  | { ok: false; reason: "not_found" | "not_returned" | "nothing_reversed" };

/// Undoes a return: the money came back to us after all.
///
/// The only caller today is B-147's `charge.dispute.closed` with `status: won`,
/// where Stripe releases the disputed funds. It is deliberately not restricted
/// to that, because the same thing happens when a bank reverses its own return.
///
/// Symmetric with `returnPayment` and for the same reason — FR-8 is append-only,
/// so nothing here deletes the reversal or rewrites the original. A third entry
/// is posted pointing back at the second, and the payment goes back to
/// `succeeded`, which is what makes its allocations count again.
export async function reinstatePayment(
  actor: Actor,
  paymentId: string,
  input: { reasonCode: string; note?: string },
): Promise<ReinstatePaymentResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      facilityId: true,
      tenantId: true,
      amountCents: true,
      method: true,
      status: true,
      receiptNumber: true,
      ledgerEntries: {
        where: { type: "payment" },
        select: { id: true, leaseId: true },
      },
    },
  });
  if (!payment) return { ok: false, reason: "not_found" };

  requireReversalAuthority(actor, payment.facilityId);

  // The idempotency guard, and the one that matters: Stripe redelivers
  // `charge.dispute.closed` for days. A second delivery finds `succeeded` and
  // stops here rather than posting a second counter-entry.
  if (payment.status !== "returned") return { ok: false, reason: "not_returned" };

  const posted = payment.ledgerEntries[0];
  const reversal = posted
    ? await prisma.ledgerEntry.findUnique({
        where: { reversalOfId: posted.id },
        select: { id: true, leaseId: true },
      })
    : null;
  // `returned` with nothing reversed should not exist, but a status set by hand
  // in a database client would produce it, and inventing a credit off the back
  // of that is worse than refusing.
  if (!reversal) return { ok: false, reason: "nothing_reversed" };

  const result = await prisma.$transaction(async (tx) => {
    const entry = await tx.ledgerEntry.create({
      data: {
        facilityId: payment.facilityId,
        leaseId: reversal.leaseId,
        // Negative: the tenant stops owing it again. `adjustment` rather than
        // `payment`, so `ledgerEntries[0]` above keeps meaning the ONE original
        // posting and a later return still reverses the right row.
        type: "adjustment",
        amountCents: -payment.amountCents,
        description: `Reinstated ${payment.method.replace("_", " ")} payment${
          payment.receiptNumber !== null
            ? `, receipt #${payment.receiptNumber}`
            : ""
        } — ${input.reasonCode}`,
        paymentId: payment.id,
        reversalOfId: reversal.id,
      },
    });

    // Order matters, exactly as it does in `reconcile.ts`: allocation sums only
    // SETTLING statuses, and this update is what makes this payment count.
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "succeeded", failureReason: null },
    });

    // Re-allocated, not restored. The invoices this settled originally may have
    // been superseded while the dispute ran — next month's rent was raised, a
    // late fee landed because the arrears were real for those weeks. Money
    // settles what is open in the facility's configured order, which is the
    // same rule every other payment follows; pinning it back to the old
    // invoices would leave a paid invoice sitting behind an unpaid older one.
    const applied = await applyPayment(tx, payment);

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: "payment.reinstated",
        entityType: "Payment",
        entityId: payment.id,
        facilityId: payment.facilityId,
        reasonCode: input.reasonCode,
        context: {
          amountCents: payment.amountCents,
          method: payment.method,
          receiptNumber: payment.receiptNumber,
          reversedEntryId: reversal.id,
          entryId: entry.id,
          reallocatedInvoiceIds: [
            ...new Set(applied.lines.map((line) => line.invoiceId)),
          ],
          unappliedCents: applied.unappliedCents,
          note: input.note ?? null,
        },
      },
      tx,
    );

    return {
      entryId: entry.id,
      invoiceIds: [...new Set(applied.lines.map((line) => line.invoiceId))],
    };
  });

  // Outside the transaction, on `returnPayment`'s own reasoning. The queue is
  // what staff are working from: leaving the "a payment bounced" card open on a
  // dispute we won sends somebody to chase a tenant who owes nothing.
  await cancelOpenTask("settling_payment_failed", payment.id);

  return {
    ok: true,
    entryId: result.entryId,
    reallocatedInvoiceIds: result.invoiceIds,
  };
}

/// US-21's NSF fee, raised as its own `kind: 'fee'` invoice.
///
/// Through `raiseFeeInvoice` since B-167 — the same shape late fees and the
/// ad-hoc charge use, which is what makes "waivable like any other fee" come
/// for free: `waivableFees` lists fee invoices and `waiveFeeInvoice` voids
/// them. Posting it only to the ledger would also make it invisible to autopay,
/// which collects invoices.
///
/// Returns null when the facility has configured no NSF amount — which is the
/// shipped state, since `FeeType.nsf` has never had a reader.
async function assessNsfFee(
  tx: Parameters<typeof recomputeInvoices>[0],
  payment: { facilityId: string; id: string },
  reasonCode: string,
): Promise<{ number: string; amountCents: number; invoiceId: string } | null> {
  const posted = await tx.ledgerEntry.findFirst({
    where: { paymentId: payment.id, type: "payment" },
    select: { leaseId: true },
  });
  if (!posted) return null;

  const amountCents = await scheduledFeeCents(
    payment.facilityId,
    "nsf",
    new Date(),
    tx,
  );
  if (amountCents === null) return null;

  const raised = await raiseFeeInvoice(tx, {
    facilityId: payment.facilityId,
    leaseId: posted.leaseId,
    on: new Date(),
    ledgerDescription: "Returned payment fee",
    lines: [
      {
        description: `Returned payment fee — ${reasonCode}`,
        amountCents,
      },
    ],
  });

  return { number: raised.number, amountCents, invoiceId: raised.id };
}

export type ReturnablePayment = {
  paymentId: string;
  amountCents: number;
  method: string;
  receivedAt: Date;
  receiptNumber: number | null;
  facilityId: string;
};

/// Payments on this tenant that could still come back.
///
/// `succeeded` only, and not the refunded states: a payment already given back
/// has nothing left for a bank to reclaim, and one already `returned` is done.
export async function returnablePayments(
  tenantId: string,
): Promise<ReturnablePayment[]> {
  const payments = await prisma.payment.findMany({
    where: {
      tenantId,
      status: "succeeded",
      // A refund is itself a Payment row (B-048's shape). A refund cannot bounce
      // back to us — that would be money arriving, not leaving.
      refundOfPaymentId: null,
      // Nothing to reverse without a posted lease entry; see `nothing_posted`.
      ledgerEntries: { some: { type: "payment" } },
    },
    orderBy: { receivedAt: "desc" },
    take: 20,
    select: {
      id: true,
      facilityId: true,
      amountCents: true,
      method: true,
      receivedAt: true,
      receiptNumber: true,
    },
  });

  return payments.map((payment) => ({
    paymentId: payment.id,
    facilityId: payment.facilityId,
    amountCents: payment.amountCents,
    method: payment.method,
    receivedAt: payment.receivedAt,
    receiptNumber: payment.receiptNumber,
  }));
}
