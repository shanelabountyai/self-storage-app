import { prisma } from "@storage/db";
import type { MoveOutReason } from "@storage/db";
import { recordAudit } from "@storage/core/audit";
import { emitEvent } from "@storage/core/events";
import {
  noticeShortfallDays,
  settleMoveOut,
  type MoveOutSettlement,
} from "@storage/core/move-out";
import { billingPeriodFor } from "@storage/core/billing";
import { MANAGER_RANK } from "@storage/core/pos";
import {
  assertFacilityAccess,
  can,
  checkMonetaryAuthority,
  ForbiddenError,
  nextApproverRole,
} from "@/lib/rbac/authorize";
import { raiseFeeInvoice } from "@/lib/billing/fee-invoice";
import { toAuditActor } from "@/lib/rbac/audit-actor";
import type { Actor } from "@/lib/rbac/actor";
import { recomputeUnitStatus } from "@/lib/admin/units";
import { releaseOverlock } from "@/lib/delinquency/overlock";
import { transitionGrant } from "@/lib/access/service";
import { revokePayLinksForLease } from "@/lib/portal/pay-links";
import { recaptureForLease } from "@/lib/promotions/billing";
import type { Recapture } from "@storage/core/promotions";

// PRD 02 US-14 (move-out) / PRD 03 US-2 / PRD 05 CN-8.

export type MoveOutPreview = {
  leaseId: string;
  unitNumber: string;
  /// B-167. The screen needs it to read the facility's fee schedule and to ask
  /// whether this actor may charge here — a facility NAME cannot answer either.
  facilityId: string;
  facilityName: string;
  tenantName: string;
  balanceCents: number;
  settlement: MoveOutSettlement;
  noticeShortfallDays: number;
  /// B-186. What the shortfall above was computed from — null means nobody
  /// has recorded notice for this lease yet, not that none was given.
  noticeGivenAt: Date | null;
  prorateOnMoveOut: boolean;
  writeOffThresholdCents: number;
  /// B-145. The promotional discount being charged back, and the sentence
  /// saying why. `reason` is null — and the amount zero — for every lease with
  /// no promotion, every facility on the default `none` policy, and every
  /// tenant who served the minimum. On the PREVIEW because a recapture a
  /// tenant first sees on a final invoice is a chargeback.
  recapture: Recapture;
  /// B-168. What the RULE says, before any counter reduction. Equal to
  /// `recapture.amountCents` unless somebody has moved it, and separate from it
  /// so the screen can show both — "the promotion entitles us to $180, you are
  /// charging $120" is the sentence an approver needs, and one figure cannot
  /// say it.
  ruledRecaptureCents: number;
  /// Set when the tenant already scheduled this themselves (B-041, still
  /// `active` until this screen finalizes it) — what the date picker
  /// defaults to, and what the screen tells staff the tenant already agreed
  /// to rather than presenting as a blank form.
  requestedMoveOutDate: Date | null;
};

const NO_RECAPTURE: Recapture = {
  amountCents: 0,
  monthsRemaining: 0,
  reason: null,
};

/// B-168. The recapture as reduced, and the sentence saying so.
///
/// Clamped into `[0, ruled.amountCents]`: an operator may forgive a recapture,
/// they may not invent one. Charging MORE than the promotion gave away would
/// bill money nobody saved — the same reasoning `recaptureFor` uses for never
/// billing back a discount that was never delivered.
///
/// The reason line is rewritten rather than left alone, because the sentence
/// the tenant reads has to match the figure beside it. B-145's rule — "the
/// description on the ledger row must not be a different form of words from
/// the one on the screen that got consent" — applies with more force once a
/// human has moved the number.
export function applyRecaptureOverride(
  ruled: Recapture,
  chargeCents: number | undefined,
): Recapture {
  if (chargeCents === undefined || ruled.amountCents <= 0) return ruled;
  const charged = Math.max(
    0,
    Math.min(Math.round(chargeCents), ruled.amountCents),
  );
  if (charged === ruled.amountCents) return ruled;
  const forgiven = ruled.amountCents - charged;
  const base = ruled.reason ?? "Promotional discount recovered";
  return {
    ...ruled,
    amountCents: charged,
    reason:
      charged === 0
        ? `${base} — waived in full`
        : `${base} — reduced by ${formatDollars(forgiven)}`,
  };
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function rankAt(actor: Actor, facilityId: string): number {
  if (actor.kind !== "staff") return 0;
  return Math.max(
    0,
    ...actor.assignments
      .filter((a) => a.facilityId === null || a.facilityId === facilityId)
      .map((a) => a.rank),
  );
}

async function loadLeaseForMoveOut(actor: Actor, leaseId: string) {
  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: leaseId },
    select: {
      id: true,
      facilityId: true,
      unitId: true,
      tenantId: true,
      status: true,
      startDate: true,
      monthlyRateCents: true,
      billingDay: true,
      paidThroughDate: true,
      noticeGivenAt: true,
      moveOutDate: true,
      facility: {
        select: {
          name: true,
          billingPolicy: true,
          prorateOnMoveOut: true,
          moveOutNoticeDays: true,
          writeOffThresholdCents: true,
        },
      },
      unit: { select: { number: true } },
      tenant: { select: { firstName: true, lastName: true } },
    },
  });
  assertFacilityAccess(actor, lease.facilityId);
  return lease;
}

/// What a move-out on this date would settle to — shown before anything is
/// written, so the figure staff confirm is the figure that posts (FR-19's
/// "echo back what you parsed" discipline applied to money).
export async function previewMoveOut(
  actor: Actor,
  leaseId: string,
  moveOutDate: Date,
  /// B-145. Why the lease is ending, when the caller already knows. A
  /// `transfer` recovers nothing: "a transferred tenant is still a tenant"
  /// (the `MoveOutReason` enum's own words), so a move between units at the
  /// same site does not break a promotion's minimum stay. The screen leaves it
  /// unset, because a preview is asked before a reason is chosen and a real
  /// departure is what it is previewing.
  reason?: MoveOutReason,
  /// B-168. What the operator has decided to actually charge of the recapture,
  /// when they have decided something other than all of it. `undefined` means
  /// "the rule's figure"; `0` means waived outright.
  ///
  /// It flows through the SETTLEMENT rather than being subtracted afterwards,
  /// which is the whole reason it is a parameter here: `amountDueCents`, the
  /// write-off threshold and the manager-override decision all read the
  /// settlement, and a reduction applied after them would leave the screen
  /// demanding a manager for a debt that no longer exists.
  recaptureChargeCents?: number,
): Promise<MoveOutPreview> {
  const lease = await loadLeaseForMoveOut(actor, leaseId);
  if (!can(actor, "leases:move_out", lease.facilityId)) {
    throw new ForbiddenError(
      "Missing permission leases:move_out",
      "leases:move_out",
      lease.facilityId,
    );
  }

  const balance = await prisma.ledgerEntry.aggregate({
    where: { leaseId: lease.id },
    _sum: { amountCents: true },
  });
  const balanceCents = balance._sum.amountCents ?? 0;
  // D-89 holds: "a transferred tenant is still a tenant", so a move between
  // units at the same site recovers nothing and there is nothing to reduce.
  const ruled =
    reason === "transfer"
      ? NO_RECAPTURE
      : await recaptureForLease(lease, moveOutDate);
  const recapture = applyRecaptureOverride(ruled, recaptureChargeCents);

  return {
    leaseId: lease.id,
    unitNumber: lease.unit.number,
    facilityId: lease.facilityId,
    facilityName: lease.facility.name,
    tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
    balanceCents,
    settlement: settleMoveOut({
      balanceCents,
      monthlyRateCents: lease.monthlyRateCents,
      paidThroughDate: lease.paidThroughDate,
      moveOutDate,
      prorateOnMoveOut: lease.facility.prorateOnMoveOut,
      writeOffThresholdCents: lease.facility.writeOffThresholdCents,
      recaptureCents: recapture.amountCents,
      // US-18's denominator: the billing period the move-out lands in, not
      // the calendar month it happens to share a name with.
      period: billingPeriodFor(
        lease.facility.billingPolicy,
        lease.billingDay,
        moveOutDate,
      ),
    }),
    noticeShortfallDays: noticeShortfallDays(
      lease.noticeGivenAt,
      moveOutDate,
      lease.facility.moveOutNoticeDays,
    ),
    noticeGivenAt: lease.noticeGivenAt,
    prorateOnMoveOut: lease.facility.prorateOnMoveOut,
    writeOffThresholdCents: lease.facility.writeOffThresholdCents,
    recapture,
    ruledRecaptureCents: ruled.amountCents,
    requestedMoveOutDate: lease.status === "ended" ? null : lease.moveOutDate,
  };
}

export type CompleteMoveOutInput = {
  leaseId: string;
  moveOutDate: Date;
  reason: MoveOutReason;
  /// Forgive the residual debt. Only honoured when it is at or below the
  /// facility's threshold, or the actor is a manager with a reason.
  writeOff?: boolean;
  /// Required for a write-off and for closing over the threshold — the audit
  /// layer refuses `balance.written_off` without one.
  reasonCode?: string;
  /// B-168. How much of the promotional recapture to actually charge.
  /// `undefined` charges the rule's figure; anything lower forgives the
  /// difference and needs both a reason and fee-waiver authority for the
  /// amount forgiven.
  ///
  /// A lever of its own rather than a second use of `writeOff`, which is the
  /// defect this closes: `writeOff` is all-or-nothing across the ENTIRE
  /// residual, so forgiving a disputed $60 recapture also forgave $400 of
  /// genuine arrears, in one boolean, with one reason code covering both.
  recaptureChargeCents?: number;
  /// Why the recapture was reduced. Required whenever anything is forgiven —
  /// `promo.recapture_reduced` is `requiresReason: true`, and the audit layer
  /// would refuse it anyway.
  recaptureReasonCode?: string;
};

export type CompleteMoveOutResult =
  | { ok: true; settlement: MoveOutSettlement; wroteOff: boolean }
  | {
      ok: false;
      problem:
        | "not_occupying"
        | "needs_manager"
        | "reason_code_required"
        | "recapture_reason_required"
        | "recapture_forbidden"
        | "recapture_over_limit";
      /// Set on `recapture_over_limit`: how much was being forgiven, the
      /// actor's fee-waiver limit, and who could carry it. RBAC-2 — an
      /// over-limit refusal names the rank that can approve rather than simply
      /// failing.
      forgivenCents?: number;
      limitCents?: number;
      escalateTo?: string | null;
    };

/// Ends a lease.
///
/// One transaction for everything that must agree: the lease's own dates and
/// status, the write-off entry, the unit going back to `maintenance`, and the
/// `lease.moved_out` event CN-8 sends the confirmation from. Access revocation
/// runs after it — see the note at its call site.
export async function completeMoveOut(
  actor: Actor,
  input: CompleteMoveOutInput,
): Promise<CompleteMoveOutResult> {
  if (actor.kind !== "staff") throw new ForbiddenError("Staff access required");
  const lease = await loadLeaseForMoveOut(actor, input.leaseId);
  if (!can(actor, "leases:move_out", lease.facilityId)) {
    throw new ForbiddenError(
      "Missing permission leases:move_out",
      "leases:move_out",
      lease.facilityId,
    );
  }
  if (lease.status === "ended") return { ok: false, problem: "not_occupying" };

  const preview = await previewMoveOut(
    actor,
    input.leaseId,
    input.moveOutDate,
    input.reason,
    input.recaptureChargeCents,
  );
  const { settlement } = preview;

  // B-168. Forgiving part of a recapture is money given away, and it goes
  // through the ladder that already governs giving fee money away rather than
  // riding on `leases:move_out` — which every counter staffer holding a
  // move-out has. Measured on the amount FORGIVEN, not on the amount charged:
  // the discretion being exercised is the gap, exactly as B-167 measures a fee
  // override against its departure from the schedule.
  const forgivenCents = Math.max(
    0,
    preview.ruledRecaptureCents - settlement.recaptureCents,
  );
  if (forgivenCents > 0) {
    if (!input.recaptureReasonCode?.trim()) {
      return { ok: false, problem: "recapture_reason_required" };
    }
    const decision = checkMonetaryAuthority(
      actor,
      "fee_waiver",
      forgivenCents,
      lease.facilityId,
    );
    if (!decision.allowed) {
      if (decision.reason === "forbidden") {
        return { ok: false, problem: "recapture_forbidden", forgivenCents };
      }
      const approver = await nextApproverRole(
        "fee_waiver",
        forgivenCents,
        decision.escalateToRank ?? 0,
      );
      return {
        ok: false,
        problem: "recapture_over_limit",
        forgivenCents,
        limitCents: decision.limitCents,
        escalateTo: approver?.name ?? null,
      };
    }
  }

  // US-14's AC: a lease cannot be closed over the write-off threshold without
  // a manager. Note this gates *closing with a debt*, not the write-off
  // itself — leaving a balance behind on an ended lease is the thing that
  // needs supervision, because it lands on the former-tenant AR list.
  if (
    settlement.needsManagerOverride &&
    rankAt(actor, lease.facilityId) < MANAGER_RANK
  ) {
    return { ok: false, problem: "needs_manager" };
  }

  const wroteOff = Boolean(input.writeOff) && settlement.amountDueCents > 0;
  if (wroteOff && !input.reasonCode?.trim())
    return { ok: false, problem: "reason_code_required" };

  await prisma.$transaction(async (tx) => {
    if (settlement.prorationCreditCents > 0) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: lease.facilityId,
          leaseId: lease.id,
          type: "credit",
          amountCents: -settlement.prorationCreditCents,
          description: "Move-out proration credit",
        },
      });
    }

    // B-145, rebuilt in B-168 as a fee INVOICE rather than a bare ledger entry.
    //
    // It was a `type: 'charge'` row and nothing else, so `waivableFees` could
    // not list it, `waiveFeeInvoice` could not void it, it never aged, it never
    // dunned, and autopay never collected it — the only lever anybody had over
    // a disputed recapture was `writeOff`, which forgives the whole residual.
    // Through `raiseFeeInvoice` it gets every one of those for free, and the
    // ledger effect is identical (that primitive writes the same `charge` row),
    // so the settlement arithmetic above is unchanged.
    //
    // Dated to the move-out rather than to now, as it was before: the charge is
    // for a term that ended on that day, and its age is measured from it.
    //
    // `preview.recapture.reason` is the same sentence the tenant read before
    // agreeing — the description on the invoice must not be a different form of
    // words from the one on the screen that got consent (B-145), and since
    // B-168 that sentence also says what was forgiven.
    let recaptureInvoiceId: string | null = null;
    if (settlement.recaptureCents > 0) {
      const raised = await raiseFeeInvoice(tx, {
        facilityId: lease.facilityId,
        leaseId: lease.id,
        on: input.moveOutDate,
        // The full sentence, not a generic label: B-145's rule is that the
        // LEDGER row — which is what the tenant's own statement renders — must
        // not be a different form of words from the screen that got their
        // consent. `raiseFeeInvoice` appends the invoice number to it.
        ledgerDescription:
          preview.recapture.reason ?? "Promotional discount recovered",
        lines: [
          {
            description:
              preview.recapture.reason ?? "Promotional discount recovered",
            amountCents: settlement.recaptureCents,
          },
        ],
      });
      recaptureInvoiceId = raised.id;
    }

    // What the minimum stay actually did, on the redemption that carries the
    // term. Written whenever a recapture was in play at all — including the
    // fully-waived case, where `recaptureChargedCents` is 0 and the waived
    // figure is the whole of it. Null stays null on a lease whose promotion had
    // no minimum stay, because "no term to enforce" and "a term we recovered
    // nothing on" are different facts and the report must not merge them.
    if (preview.ruledRecaptureCents > 0) {
      await tx.promoRedemption.updateMany({
        where: { leaseId: lease.id },
        data: {
          recaptureChargedCents: settlement.recaptureCents,
          recaptureWaivedCents: forgivenCents,
          recaptureInvoiceId,
        },
      });
    }

    if (forgivenCents > 0) {
      await recordAudit(
        {
          actor: toAuditActor(actor),
          facilityId: lease.facilityId,
          action: "promo.recapture_reduced",
          entityType: "Lease",
          entityId: lease.id,
          reasonCode: input.recaptureReasonCode,
          context: {
            ruledCents: preview.ruledRecaptureCents,
            chargedCents: settlement.recaptureCents,
            forgivenCents,
            monthsRemaining: preview.recapture.monthsRemaining,
          },
        },
        tx,
      );
    }

    if (wroteOff) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: lease.facilityId,
          leaseId: lease.id,
          type: "write_off",
          amountCents: -settlement.amountDueCents,
          description: `Move-out write-off (${input.reasonCode})`,
        },
      });
      await recordAudit(
        {
          actor: toAuditActor(actor),
          facilityId: lease.facilityId,
          action: "balance.written_off",
          entityType: "Lease",
          entityId: lease.id,
          reasonCode: input.reasonCode,
          context: { amountCents: settlement.amountDueCents },
        },
        tx,
      );
    }

    await tx.lease.update({
      where: { id: lease.id },
      data: {
        status: "ended",
        endDate: input.moveOutDate,
        moveOutDate: input.moveOutDate,
        moveOutReason: input.reason,
      },
    });

    // CN-4: pay links are "revoked on move-out". In the same transaction as
    // the lease ending, so a move-out that rolls back does not leave a tenant
    // with links we have already killed.
    await revokePayLinksForLease(lease.id, tx);

    // US-14's AC, in one line: a unit that goes back on sale before anyone
    // opened the door rents on Saturday with the last tenant's padlock still
    // on it. `maintenance` is the operator's intent; `recomputeUnitStatus`
    // derives the effective status from it now that no lease occupies the unit.
    await tx.unit.update({
      where: { id: lease.unitId },
      data: { operationalStatus: "maintenance" },
    });
    // B-151. The lock comes off with the lease, whatever the balance did.
    //
    // The delinquency engine only queued a removal on CURE, and a lease that
    // ends still owing halts as `moved_out` instead — so the lock stayed on a
    // unit nobody was renting, `deriveUnitStatus` kept returning `overlocked`
    // ahead of the `maintenance` set just above, the reconciliation screen saw
    // system and physical agreeing (both wrong), and the unit sat out of
    // sellable inventory with nothing reporting it. The unit does NOT go back
    // in the denominator here — there is still a real lock on it — it goes back
    // when `confirmOverlockRemoved` records somebody taking it off, which is
    // what this task now asks for.
    // B-169. The reason the card will state. `abandonment` and a plain
    // departure produce very different sentences for the staffer walking out
    // to the unit, and until now both said "the tenant has paid".
    await releaseOverlock(
      {
        leaseId: lease.id,
        facilityId: lease.facilityId,
        reason:
          input.reason === "abandonment"
            ? "abandoned"
            : input.reason === "transfer"
              ? "transfer"
              : "lease_ended",
      },
      tx,
    );
    await recomputeUnitStatus(lease.unitId, tx);

    // If a portal request (B-041) raised a verification task for this lease,
    // finalizing here IS the verification completing — not a second
    // `completeTask` call with its own proof, since the real evidence is the
    // move-out actually finishing.
    await tx.task.updateMany({
      where: {
        type: "move_out_request_review",
        entityId: lease.id,
        status: "open",
      },
      data: {
        status: "completed",
        completedByStaffId: actor.staffUserId,
        completedAt: new Date(),
        proof: { note: "Move-out finalized." },
      },
    });

    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: lease.facilityId,
        action: "lease.moved_out",
        entityType: "Lease",
        entityId: lease.id,
        context: {
          moveOutDate: input.moveOutDate.toISOString().slice(0, 10),
          reason: input.reason,
          amountDueCents: settlement.amountDueCents,
          refundDueCents: settlement.refundDueCents,
          recaptureCents: settlement.recaptureCents,
          wroteOff,
        },
      },
      tx,
    );

    await emitEvent(
      {
        name: "lease.moved_out",
        facilityId: lease.facilityId,
        entityType: "Lease",
        entityId: lease.id,
        payload: {
          amountDueCents: wroteOff ? 0 : settlement.amountDueCents,
          refundDueCents: settlement.refundDueCents,
        },
      },
      tx,
    );
  });

  // Outside the transaction on purpose, and the same reasoning B-026 used for
  // provisioning: the lease HAS ended, and a gate adapter that is slow or
  // offline must not roll that back. PRD 03 US-2 also only revokes when this
  // was the tenant's last lease at the facility — someone with two units
  // keeps their code for the one they still have.
  await revokeAccessIfLastLease(lease.facilityId, lease.tenantId);

  return { ok: true, settlement, wroteOff };
}

async function revokeAccessIfLastLease(
  facilityId: string,
  tenantId: string,
): Promise<void> {
  const stillHere = await prisma.lease.count({
    where: { facilityId, tenantId, status: { not: "ended" } },
  });
  if (stillHere > 0) return;

  const grant = await prisma.accessGrant.findUnique({
    where: { facilityId_tenantId: { facilityId, tenantId } },
    select: { id: true },
  });
  if (grant) await transitionGrant(grant.id, "revoked", "system:move_out");
}

export type NoticeProblem = "not_occupying" | "future_date";

export type RecordNoticeGivenResult =
  | { ok: true }
  | { ok: false; problem: NoticeProblem };

/// B-194. One message per refusal, next to the field that caused it (3.3.1,
/// 3.3.3). Here rather than in either action file because BOTH notice forms —
/// the profile's table cell and the move-out screen's — call the same function
/// and must not describe the same refusal two different ways over the phone.
export const NOTICE_PROBLEM_COPY: Record<NoticeProblem, string> = {
  not_occupying:
    "That lease has already ended, so its notice date can no longer be changed.",
  future_date:
    "Notice cannot have been given in the future — choose today or an earlier date.",
};

/// B-194. Blank is a VALUE here and not a missing one — it clears the field
/// back to "nobody has confirmed a notice", which `recordNoticeGiven` has
/// always distinguished from a date. So this cannot be `parseDate`, which
/// refuses the empty string. Anything else that is not a date is refused
/// rather than silently landing as `Invalid Date` in the column.
export function parseNoticeGivenAt(
  raw: FormDataEntryValue | null,
): { value: Date | null } | { error: string } {
  const text = String(raw ?? "").trim();
  if (text === "") return { value: null };
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return { error: "Enter the notice date as yyyy-mm-dd, or leave it blank." };
  }
  return { value: date };
}

/// B-186. Records notice given off-platform — at the counter, by phone, by
/// mail. `Lease.noticeGivenAt` previously had exactly one writer, the
/// tenant's own portal request, so every walk-in read as having given no
/// notice at all and the move-out screen said so to staff as if it were a
/// measurement. `noticeGivenAt: null` clears it back to unset rather than
/// stamping "today" — a date nobody actually confirmed must stay
/// distinguishable from one that was.
export async function recordNoticeGiven(
  actor: Actor,
  leaseId: string,
  noticeGivenAt: Date | null,
): Promise<RecordNoticeGivenResult> {
  const lease = await loadLeaseForMoveOut(actor, leaseId);
  if (!can(actor, "leases:move_out", lease.facilityId)) {
    throw new ForbiddenError(
      "Missing permission leases:move_out",
      "leases:move_out",
      lease.facilityId,
    );
  }
  if (lease.status === "ended") return { ok: false, problem: "not_occupying" };
  if (noticeGivenAt && noticeGivenAt.getTime() > Date.now()) {
    return { ok: false, problem: "future_date" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.lease.update({ where: { id: lease.id }, data: { noticeGivenAt } });
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: lease.facilityId,
        action: "lease.edited",
        entityType: "Lease",
        entityId: lease.id,
        context: {
          field: "noticeGivenAt",
          value: noticeGivenAt ? noticeGivenAt.toISOString().slice(0, 10) : null,
        },
      },
      tx,
    );
  });

  return { ok: true };
}

/// US-14's "verified empty and clean" — the confirmation that makes a unit
/// rentable again. Deliberately a separate act from the move-out: the whole
/// point is that a human opened the door after the tenant left.
export async function markUnitReadyToRent(
  actor: Actor,
  facilityId: string,
  unitId: string,
): Promise<void> {
  assertFacilityAccess(actor, facilityId);
  if (!can(actor, "units:edit", facilityId)) {
    throw new ForbiddenError(
      "Missing permission units:edit",
      "units:edit",
      facilityId,
    );
  }
  const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } });
  if (unit.facilityId !== facilityId)
    throw new ForbiddenError("Unit is at another facility");

  await prisma.$transaction(async (tx) => {
    await tx.unit.update({
      where: { id: unitId },
      data: { operationalStatus: "available" },
    });
    await recomputeUnitStatus(unitId, tx);
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId,
        action: "unit.updated",
        entityType: "Unit",
        entityId: unitId,
        context: { verifiedEmptyAndClean: true },
      },
      tx,
    );
  });
}

export type FormerTenantDebt = {
  leaseId: string;
  tenantId: string;
  tenantName: string;
  unitNumber: string;
  facilityName: string;
  moveOutDate: Date | null;
  balanceCents: number;
};

/// US-14's former-tenant AR list: ended leases that still owe.
///
/// A read, not a queue — collections disposition and write-off-after-the-fact
/// are B-048's. Its value now is that a balance left behind at move-out stops
/// being invisible the moment the lease closes.
export async function formerTenantDebts(
  actor: Actor,
  facilityId: string,
): Promise<FormerTenantDebt[]> {
  assertFacilityAccess(actor, facilityId);
  if (
    !can(actor, "reports:financial", facilityId) &&
    !can(actor, "tenants:view", facilityId)
  ) {
    throw new ForbiddenError(
      "Missing permission to read former-tenant balances",
      "tenants:view",
      facilityId,
    );
  }

  const leases = await prisma.lease.findMany({
    where: { facilityId, status: "ended" },
    orderBy: { moveOutDate: "desc" },
    select: {
      id: true,
      tenantId: true,
      moveOutDate: true,
      facility: { select: { name: true } },
      unit: { select: { number: true } },
      tenant: { select: { firstName: true, lastName: true } },
    },
  });
  if (leases.length === 0) return [];

  const balances = await prisma.ledgerEntry.groupBy({
    by: ["leaseId"],
    where: { leaseId: { in: leases.map((lease) => lease.id) } },
    _sum: { amountCents: true },
  });
  const byLease = new Map(
    balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]),
  );

  return leases
    .map((lease) => ({
      leaseId: lease.id,
      tenantId: lease.tenantId,
      tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      unitNumber: lease.unit.number,
      facilityName: lease.facility.name,
      moveOutDate: lease.moveOutDate,
      balanceCents: byLease.get(lease.id) ?? 0,
    }))
    .filter((row) => row.balanceCents > 0);
}
