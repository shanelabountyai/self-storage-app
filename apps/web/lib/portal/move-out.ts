import { prisma } from "@storage/db";
import {
  isPortalSelfService,
  OCCUPYING_LEASE_STATUSES,
} from "@storage/core/inventory";
import { emitEvent } from "@storage/core/events";
import {
  noticeShortfallDays,
  settleMoveOut,
  type MoveOutSettlement,
} from "@storage/core/move-out";
import { billingPeriodFor } from "@storage/core/billing";
import { createTask, cancelOpenTask } from "@/lib/admin/tasks";
import { recaptureForLease } from "@/lib/promotions/billing";
import type { Recapture } from "@storage/core/promotions";

// PRD 01 US-707. The tenant's own move-out request: pick a date, see what it
// settles to, confirm. Nothing here finalizes a lease — that stays exactly
// where B-040 built it, gated behind a human actually checking the unit is
// empty. This only ever gets a lease as far as "active, with a date on it,
// and a task asking someone to go look."

export type PortalMoveOutLease = {
  leaseId: string;
  facilityId: string;
  facilityName: string;
  facilityPhone: string;
  unitNumber: string;
  monthlyRateCents: number;
  moveOutNoticeDays: number;
  /// The earliest date the facility's own notice policy allows — the floor
  /// for the date picker, not merely a hint. Unlike the staff screen (B-040,
  /// which treats a short notice as informational because staff route around
  /// real-world urgency), a tenant scheduling ahead has no reason to need an
  /// exception, so this is enforced.
  minMoveOutDate: Date;
  /// Set when this lease already has a pending, unfinalized request —
  /// `status` is still `active` and `moveOutDate` is already on the row.
  /// Distinguishing "pending" from "finalized" needs no extra column: a
  /// finalized lease has `status: 'ended'` and is not in this list at all
  /// (see the query below).
  pendingMoveOutDate: Date | null;
  /// B-164 / D-85. False for a lien-pipeline lease. **Listed rather than
  /// hidden**, the same as the transfer screen: a tenant with one unit who is
  /// told we see no unit on their account has been told something false, and
  /// has nowhere to go next. They get the lease, the reason and the office's
  /// phone number instead.
  schedulable: boolean;
};

function startOfDayUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/// The tenant's own occupying leases, each with what the date picker needs.
/// Scoped to `tenantId` from the session — never a parameter a request could
/// override.
export async function tenantMoveOutLeases(
  tenantId: string,
): Promise<PortalMoveOutLease[]> {
  const leases = await prisma.lease.findMany({
    where: { tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      status: true,
      facilityId: true,
      monthlyRateCents: true,
      moveOutDate: true,
      facility: {
        select: { name: true, phone: true, moveOutNoticeDays: true },
      },
      unit: { select: { number: true } },
    },
  });

  const today = startOfDayUtc(new Date());
  return leases.map((lease) => ({
    leaseId: lease.id,
    facilityId: lease.facilityId,
    facilityName: lease.facility.name,
    facilityPhone: lease.facility.phone ?? "",
    unitNumber: lease.unit.number,
    monthlyRateCents: lease.monthlyRateCents,
    moveOutNoticeDays: lease.facility.moveOutNoticeDays,
    minMoveOutDate: addDays(today, lease.facility.moveOutNoticeDays),
    pendingMoveOutDate: lease.moveOutDate,
    schedulable: isPortalSelfService(lease.status),
  }));
}

export type PortalMoveOutPreview = {
  lease: PortalMoveOutLease;
  balanceCents: number;
  settlement: MoveOutSettlement;
  noticeShortfallDays: number;
  /// B-145. The promotional discount that would be charged back, with the
  /// sentence saying why. This is the surface the row cares about most: the
  /// tenant is the one being charged, and a recapture they first meet on a
  /// final invoice is a chargeback.
  recapture: Recapture;
};

export type PreviewResult =
  | { ok: true; preview: PortalMoveOutPreview }
  | { ok: false; reason: "not_found" | "lien_pipeline" };

/// B-164 / D-85. Said in the tenant's own words, never in ours.
///
/// "Lien process" is the plainest true phrase available: the tenant has had a
/// notice about this unit, so talking around it helps nobody, and D-15's rule
/// is that customer copy explains rather than cites. It never claims the lease
/// does not exist — that is the version of this refusal that produces an angry
/// phone call about a bug that is not one.
///
/// The phone number is deliberately NOT in here. The screen renders it through
/// `phoneFor`/`CallLink`, which falls back to the org line when a facility has
/// none and makes it a real `tel:` link — a refusal whose only next step is a
/// phone call must not be able to ship without a number to call.
export function lienMoveOutRefusal(unitNumber: string): string {
  return `Unit ${unitNumber} is in the lien process, so a move-out has to be arranged with the office rather than online. They'll go through what you owe and what happens next with you.`;
}

/// What a move-out on this date would settle to, for a tenant looking at
/// their own lease. Read-only — nothing is written until `requestMoveOut`.
export async function previewTenantMoveOut(
  tenantId: string,
  leaseId: string,
  moveOutDate: Date,
): Promise<PreviewResult> {
  const lease = await prisma.lease.findFirst({
    where: {
      id: leaseId,
      tenantId,
      status: { in: [...OCCUPYING_LEASE_STATUSES] },
    },
    select: {
      status: true,
      facilityId: true,
      monthlyRateCents: true,
      billingDay: true,
      paidThroughDate: true,
      noticeGivenAt: true,
      id: true,
      startDate: true,
      facility: {
        select: {
          name: true,
          phone: true,
          billingPolicy: true,
          moveOutNoticeDays: true,
          prorateOnMoveOut: true,
          writeOffThresholdCents: true,
        },
      },
      unit: { select: { number: true } },
    },
  });
  if (!lease) return { ok: false, reason: "not_found" };
  // B-164 / D-85. Distinguished from `not_found` deliberately: the lease is
  // theirs and it does exist, and the screen has a real thing to tell them.
  if (!isPortalSelfService(lease.status))
    return { ok: false, reason: "lien_pipeline" };

  const balance = await prisma.ledgerEntry.aggregate({
    where: { leaseId },
    _sum: { amountCents: true },
  });
  const balanceCents = balance._sum.amountCents ?? 0;
  const today = startOfDayUtc(new Date());
  const recapture = await recaptureForLease(lease, moveOutDate);

  return {
    ok: true,
    preview: {
      lease: {
        leaseId,
        facilityId: lease.facilityId,
        facilityName: lease.facility.name,
        facilityPhone: lease.facility.phone ?? "",
        unitNumber: lease.unit.number,
        monthlyRateCents: lease.monthlyRateCents,
        moveOutNoticeDays: lease.facility.moveOutNoticeDays,
        minMoveOutDate: addDays(today, lease.facility.moveOutNoticeDays),
        pendingMoveOutDate: null,
        schedulable: true,
      },
      balanceCents,
      settlement: settleMoveOut({
        balanceCents,
        monthlyRateCents: lease.monthlyRateCents,
        paidThroughDate: lease.paidThroughDate,
        moveOutDate,
        prorateOnMoveOut: lease.facility.prorateOnMoveOut,
        writeOffThresholdCents: lease.facility.writeOffThresholdCents,
        recaptureCents: recapture.amountCents,
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
      recapture,
    },
  };
}

export type RequestMoveOutResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_found"
        | "date_too_soon"
        | "already_requested"
        | "lien_pipeline";
    };

/// Records the tenant's own request: the lease stays `active` (they still
/// have access, still owe rent up to the date), gets a `moveOutDate` and a
/// `noticeGivenAt` stamped now, and a task is raised for staff to verify the
/// unit and finalize (B-040's own screen, unchanged) once it actually is
/// empty. Confirmation is sent through the same rule/template pipeline every
/// other transactional send in this project uses.
export async function requestMoveOut(
  tenantId: string,
  leaseId: string,
  moveOutDate: Date,
): Promise<RequestMoveOutResult> {
  const lease = await prisma.lease.findFirst({
    where: {
      id: leaseId,
      tenantId,
      status: { in: [...OCCUPYING_LEASE_STATUSES] },
    },
    select: {
      status: true,
      facilityId: true,
      moveOutDate: true,
      facility: { select: { moveOutNoticeDays: true } },
    },
  });
  if (!lease) return { ok: false, reason: "not_found" };
  // B-164 / D-85. The screen never offers the control, and this is why that is
  // not the whole fix: the refusal has to hold against a form post that never
  // rendered the screen at all.
  if (!isPortalSelfService(lease.status))
    return { ok: false, reason: "lien_pipeline" };
  if (lease.moveOutDate) return { ok: false, reason: "already_requested" };

  const today = startOfDayUtc(new Date());
  const minDate = addDays(today, lease.facility.moveOutNoticeDays);
  if (moveOutDate.getTime() < minDate.getTime())
    return { ok: false, reason: "date_too_soon" };

  await prisma.$transaction(async (tx) => {
    await tx.lease.update({
      where: { id: leaseId },
      data: {
        moveOutDate,
        moveOutReason: "tenant_request",
        noticeGivenAt: new Date(),
      },
    });
    await createTask({
      facilityId: lease.facilityId,
      type: "move_out_request_review",
      entityType: "Lease",
      entityId: leaseId,
      client: tx,
    });
    await emitEvent(
      {
        name: "lease.move_out_requested",
        facilityId: lease.facilityId,
        entityType: "Lease",
        entityId: leaseId,
        payload: { moveOutDate: moveOutDate.toISOString().slice(0, 10) },
      },
      tx,
    );
  });

  return { ok: true };
}

export type CancelMoveOutResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "nothing_to_cancel" | "too_late" };

/// US-707: "Tenant can cancel a scheduled move-out before the date." Clears
/// exactly what `requestMoveOut` set, puts the lease back to looking like it
/// never had a request, and withdraws the verification task rather than
/// leaving staff a task about a request that no longer exists.
export async function cancelMoveOutRequest(
  tenantId: string,
  leaseId: string,
): Promise<CancelMoveOutResult> {
  const lease = await prisma.lease.findFirst({
    where: {
      id: leaseId,
      tenantId,
      status: { in: [...OCCUPYING_LEASE_STATUSES] },
    },
    select: { moveOutDate: true },
  });
  if (!lease) return { ok: false, reason: "not_found" };
  if (!lease.moveOutDate) return { ok: false, reason: "nothing_to_cancel" };
  // "Before the date" is the AC's own words — once it arrives, staff may
  // already be acting on it, and the honest path from here on is calling the
  // office, not a self-service button quietly pulling the rug out.
  if (lease.moveOutDate.getTime() <= startOfDayUtc(new Date()).getTime()) {
    return { ok: false, reason: "too_late" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.lease.update({
      where: { id: leaseId },
      data: { moveOutDate: null, moveOutReason: null, noticeGivenAt: null },
    });
    await cancelOpenTask("move_out_request_review", leaseId, tx);
  });

  return { ok: true };
}
