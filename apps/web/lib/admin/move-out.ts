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
  ForbiddenError,
} from "@/lib/rbac/authorize";
import { toAuditActor } from "@/lib/rbac/audit-actor";
import type { Actor } from "@/lib/rbac/actor";
import { recomputeUnitStatus } from "@/lib/admin/units";
import { transitionGrant } from "@/lib/access/service";
import { revokePayLinksForLease } from "@/lib/portal/pay-links";
import { recaptureForLease } from "@/lib/promotions/billing";
import type { Recapture } from "@storage/core/promotions";

// PRD 02 US-14 (move-out) / PRD 03 US-2 / PRD 05 CN-8.

export type MoveOutPreview = {
  leaseId: string;
  unitNumber: string;
  facilityName: string;
  tenantName: string;
  balanceCents: number;
  settlement: MoveOutSettlement;
  noticeShortfallDays: number;
  prorateOnMoveOut: boolean;
  writeOffThresholdCents: number;
  /// B-145. The promotional discount being charged back, and the sentence
  /// saying why. `reason` is null — and the amount zero — for every lease with
  /// no promotion, every facility on the default `none` policy, and every
  /// tenant who served the minimum. On the PREVIEW because a recapture a
  /// tenant first sees on a final invoice is a chargeback.
  recapture: Recapture;
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
  const recapture =
    reason === "transfer"
      ? NO_RECAPTURE
      : await recaptureForLease(lease, moveOutDate);

  return {
    leaseId: lease.id,
    unitNumber: lease.unit.number,
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
    prorateOnMoveOut: lease.facility.prorateOnMoveOut,
    writeOffThresholdCents: lease.facility.writeOffThresholdCents,
    recapture,
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
};

export type CompleteMoveOutResult =
  | { ok: true; settlement: MoveOutSettlement; wroteOff: boolean }
  | {
      ok: false;
      problem: "not_occupying" | "needs_manager" | "reason_code_required";
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
  );
  const { settlement } = preview;

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

    // B-145. Posted as a plain charge on the lease, dated to the move-out, so
    // it lands on the final statement beside the proration credit above and is
    // collected, disputed and aged by every path that already handles a
    // balance. `preview.recapture.reason` is the same sentence the tenant read
    // before agreeing — the description on the ledger row must not be a
    // different form of words from the one on the screen that got consent.
    if (settlement.recaptureCents > 0) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: lease.facilityId,
          leaseId: lease.id,
          type: "charge",
          amountCents: settlement.recaptureCents,
          description:
            preview.recapture.reason ?? "Promotional discount recovered",
          occurredAt: input.moveOutDate,
        },
      });
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
