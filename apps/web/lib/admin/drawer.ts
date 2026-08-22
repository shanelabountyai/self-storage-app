import { prisma } from "@storage/db";
import { recordAudit } from "@storage/core/audit";
import { businessDateFor } from "@storage/core/jobs";
import {
  closeProblem,
  depositSlip,
  expectedDrawer,
  varianceNeedsNote,
  varianceOf,
  type CloseProblem,
  type DepositSlip,
  type DrawerMovement,
} from "@storage/core/pos";
import {
  assertFacilityAccess,
  can,
  ForbiddenError,
} from "@/lib/rbac/authorize";
import { toAuditActor } from "@/lib/rbac/audit-actor";
import type { Actor } from "@/lib/rbac/actor";

// PRD 02 US-33 (B-078). Drawer sessions: the float, the money that moved, and
// the count that has to agree with it.
//
// B-039 shipped the daily deposit slip and said in its own comment why it
// stopped short: "Building a 'close-out' here that reconciled against nothing
// counted would look like accountability without being it." This is the other
// half — a session somebody opens with a counted float and closes with a
// counted total, where the difference is recorded and, past a threshold,
// has to be explained.

function staffIdOf(actor: Actor): string {
  if (actor.kind !== "staff")
    throw new ForbiddenError("Staff session required");
  return actor.staffUserId;
}

function requireDrawer(actor: Actor, facilityId: string): void {
  assertFacilityAccess(actor, facilityId);
  if (!can(actor, "drawer:manage", facilityId)) {
    throw new ForbiddenError(
      "Missing permission drawer:manage",
      "drawer:manage",
      facilityId,
    );
  }
}

export type OpenDrawerResult =
  | { ok: true; sessionId: string }
  | { ok: false; problem: "already_open" | "float_negative" };

/// Opens the day's drawer with a counted float.
///
/// The float is entered by a person, never carried forward from yesterday's
/// close: carrying it would mean the first count of the day was somebody
/// else's, which is exactly the accountability gap a session exists to close.
export async function openDrawer(
  actor: Actor,
  facilityId: string,
  openingFloatCents: number,
): Promise<OpenDrawerResult> {
  requireDrawer(actor, facilityId);
  if (openingFloatCents < 0) return { ok: false, problem: "float_negative" };

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { timezone: true },
  });
  const businessDate = businessDateFor(new Date(), facility.timezone);

  const existing = await prisma.drawerSession.findFirst({
    where: { facilityId, status: "open" },
    select: { id: true },
  });
  if (existing) return { ok: false, problem: "already_open" };

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.drawerSession.create({
      data: {
        facilityId,
        businessDate,
        openingFloatCents,
        openedByStaffId: staffIdOf(actor),
        status: "open",
      },
    });
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId,
        action: "drawer.opened",
        entityType: "DrawerSession",
        entityId: created.id,
        context: {
          openingFloatCents,
          businessDate: businessDate.toISOString().slice(0, 10),
        },
      },
      tx,
    );
    return created;
  });

  return { ok: true, sessionId: session.id };
}

/// The open session for a facility, or null. Used by the payment path to
/// decide which drawer money is going into, and by the screen to decide
/// whether to offer "open" or "close".
export async function openSessionFor(facilityId: string) {
  return prisma.drawerSession.findFirst({
    where: { facilityId, status: "open" },
  });
}

/// Every movement of money attached to a session, as the pure module wants
/// it. Refunds arrive as negative amounts — a cash refund is money out of the
/// same drawer, and netting it here is what keeps `expectedDrawer` one sum.
async function movementsFor(sessionId: string): Promise<DrawerMovement[]> {
  const payments = await prisma.payment.findMany({
    // B-146: `returned` is HERE deliberately. A cheque that bounced on Thursday
    // was still physically in Monday's drawer, and dropping it would make a
    // session somebody already counted and signed off read as short by money
    // that really was there. The bounce is a Thursday fact; this is a Monday
    // record.
    where: {
      drawerSessionId: sessionId,
      status: {
        in: ["succeeded", "partially_refunded", "refunded", "returned"],
      },
    },
    select: {
      method: true,
      amountCents: true,
      changeCents: true,
      refundOfPaymentId: true,
    },
  });

  return payments.map((payment) => ({
    method: payment.method as DrawerMovement["method"],
    // A refund row is money leaving. `refundOfPaymentId` is what marks one
    // (B-048's shape: a refund is its own Payment pointing at the original).
    amountCents: payment.refundOfPaymentId
      ? -payment.amountCents
      : payment.amountCents,
    changeCents: payment.changeCents ?? 0,
  }));
}

export type DrawerView = {
  sessionId: string;
  status: "open" | "closed";
  businessDate: Date;
  openingFloatCents: number;
  openedAt: Date;
  openedByName: string | null;
  closedAt: Date | null;
  closedByName: string | null;
  countedCashCents: number | null;
  countedChecksCents: number | null;
  varianceCents: number | null;
  note: string | null;
  slip: DepositSlip;
  /// The cheque list US-33's deposit slip asks for by name.
  checks: {
    receiptNumber: number | null;
    checkNumber: string | null;
    amountCents: number;
    tenantName: string;
  }[];
  thresholdCents: number;
};

/// Everything the close-out screen and the deposit slip need.
export async function drawerView(
  actor: Actor,
  sessionId: string,
): Promise<DrawerView> {
  const session = await prisma.drawerSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      facility: { select: { drawerVarianceThresholdCents: true } },
    },
  });
  requireDrawer(actor, session.facilityId);

  const [movements, checkRows, openedBy, closedBy] = await Promise.all([
    movementsFor(sessionId),
    prisma.payment.findMany({
      where: {
        drawerSessionId: sessionId,
        method: { in: ["check", "money_order"] },
        // Same reasoning as `movementsFor`: the deposit slip lists what went to
        // the bank, and a cheque that later bounced did go to the bank.
        status: {
          in: ["succeeded", "partially_refunded", "refunded", "returned"],
        },
      },
      orderBy: { receivedAt: "asc" },
      select: {
        receiptNumber: true,
        checkNumber: true,
        amountCents: true,
        tenant: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.staffUser.findUnique({
      where: { id: session.openedByStaffId },
      select: { firstName: true, lastName: true },
    }),
    session.closedByStaffId
      ? prisma.staffUser.findUnique({
          where: { id: session.closedByStaffId },
          select: { firstName: true, lastName: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    sessionId: session.id,
    status: session.status,
    businessDate: session.businessDate,
    openingFloatCents: session.openingFloatCents,
    openedAt: session.openedAt,
    openedByName: openedBy
      ? `${openedBy.firstName} ${openedBy.lastName}`
      : null,
    closedAt: session.closedAt,
    closedByName: closedBy
      ? `${closedBy.firstName} ${closedBy.lastName}`
      : null,
    countedCashCents: session.countedCashCents,
    countedChecksCents: session.countedChecksCents,
    varianceCents: session.varianceCents,
    note: session.note,
    slip: depositSlip(session.openingFloatCents, movements),
    checks: checkRows.map((row) => ({
      receiptNumber: row.receiptNumber,
      checkNumber: row.checkNumber,
      amountCents: row.amountCents,
      tenantName: `${row.tenant.firstName} ${row.tenant.lastName}`,
    })),
    thresholdCents: session.facility.drawerVarianceThresholdCents,
  };
}

export type CloseDrawerResult =
  | { ok: true; varianceCents: number; settledRefunds: number }
  | { ok: false; problem: CloseProblem };

/// Counts the drawer down and closes it.
///
/// The expected figures are SNAPSHOTTED onto the row rather than recomputed
/// on every later read: a payment backdated into a closed session must not
/// silently rewrite a count somebody signed their name to. The deposits
/// report compares against the snapshot for exactly that reason.
export async function closeDrawer(
  actor: Actor,
  sessionId: string,
  input: { countedCashCents: number; countedChecksCents: number; note: string },
): Promise<CloseDrawerResult> {
  const session = await prisma.drawerSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { facility: { select: { drawerVarianceThresholdCents: true } } },
  });
  requireDrawer(actor, session.facilityId);

  const movements = await movementsFor(sessionId);
  const expectation = expectedDrawer(session.openingFloatCents, movements);
  const varianceCents = varianceOf(
    input.countedCashCents,
    expectation.expectedCashCents,
  );
  const thresholdCents = session.facility.drawerVarianceThresholdCents;

  const problem = closeProblem({
    status: session.status,
    countedCashCents: input.countedCashCents,
    countedChecksCents: input.countedChecksCents,
    varianceCents,
    thresholdCents,
    note: input.note,
  });
  if (problem) return { ok: false, problem };

  const settledRefunds = await prisma.$transaction(async (tx) => {
    await tx.drawerSession.update({
      where: { id: sessionId },
      data: {
        status: "closed",
        closedAt: new Date(),
        closedByStaffId: staffIdOf(actor),
        countedCashCents: input.countedCashCents,
        countedChecksCents: input.countedChecksCents,
        expectedCashCents: expectation.expectedCashCents,
        expectedChecksCents: expectation.expectedChecksCents,
        varianceCents,
        note: input.note.trim() || null,
      },
    });

    // B-048's hand-off, closed here. A cash or cheque refund is recorded
    // `pending` — "the money has not left until somebody opens the drawer or
    // writes the cheque" — and nothing marked it paid, so it sat pending
    // forever. Closing the drawer it was paid out of IS that moment.
    const settled = await tx.payment.updateMany({
      where: {
        drawerSessionId: sessionId,
        status: "pending",
        refundOfPaymentId: { not: null },
      },
      data: { status: "succeeded" },
    });

    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: session.facilityId,
        action: "drawer.closed",
        entityType: "DrawerSession",
        entityId: sessionId,
        context: {
          countedCashCents: input.countedCashCents,
          countedChecksCents: input.countedChecksCents,
          expectedCashCents: expectation.expectedCashCents,
          varianceCents,
          refundsSettled: settled.count,
        },
      },
      tx,
    );

    // A separate, reason-coded entry for the variance itself. The audit
    // catalog marks `drawer.over_short` `requiresReason: true`, so this
    // write is what makes US-33's "requires a manager note" unbypassable —
    // `recordAudit` throws without one.
    if (varianceNeedsNote(varianceCents, thresholdCents)) {
      await recordAudit(
        {
          actor: toAuditActor(actor),
          facilityId: session.facilityId,
          action: "drawer.over_short",
          entityType: "DrawerSession",
          entityId: sessionId,
          reasonCode: input.note.trim(),
          context: {
            varianceCents,
            thresholdCents,
            direction: varianceCents > 0 ? "over" : "short",
          },
        },
        tx,
      );
    }

    return settled.count;
  });

  return { ok: true, varianceCents, settledRefunds };
}

export type DrawerHistoryRow = {
  sessionId: string;
  businessDate: Date;
  status: string;
  openingFloatCents: number;
  countedCashCents: number | null;
  expectedCashCents: number | null;
  varianceCents: number | null;
  note: string | null;
  closedByName: string | null;
};

/// Closed sessions in a range, for the deposits reconciliation report.
export async function drawerHistory(
  actor: Actor,
  facilityId: string,
  from: Date,
  to: Date,
): Promise<DrawerHistoryRow[]> {
  requireDrawer(actor, facilityId);

  const sessions = await prisma.drawerSession.findMany({
    where: { facilityId, businessDate: { gte: from, lt: to } },
    orderBy: [{ businessDate: "desc" }, { openedAt: "desc" }],
    include: { facility: { select: { id: true } } },
  });

  const staffIds = [
    ...new Set(
      sessions
        .map((s) => s.closedByStaffId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const staff = staffIds.length
    ? await prisma.staffUser.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const nameById = new Map(
    staff.map((s) => [s.id, `${s.firstName} ${s.lastName}`]),
  );

  return sessions.map((session) => ({
    sessionId: session.id,
    businessDate: session.businessDate,
    status: session.status,
    openingFloatCents: session.openingFloatCents,
    countedCashCents: session.countedCashCents,
    expectedCashCents: session.expectedCashCents,
    varianceCents: session.varianceCents,
    note: session.note,
    closedByName: session.closedByStaffId
      ? (nameById.get(session.closedByStaffId) ?? null)
      : null,
  }));
}
