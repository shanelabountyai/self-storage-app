import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { prisma } from "../packages/db";
import {
  completeMoveOut,
  formerTenantDebts,
  markUnitReadyToRent,
  previewMoveOut,
  recordNoticeGiven,
} from "../apps/web/lib/admin/move-out";
import {
  confirmOverlockApplied,
  requestOverlock,
} from "../apps/web/lib/delinquency/overlock";
import { completeTask } from "../apps/web/lib/admin/tasks";
import { waiveFeeInvoice } from "../apps/web/lib/billing/late-fees";
import { isOccupied, isRentable } from "@storage/core/metrics";
import type { Actor } from "../apps/web/lib/rbac/actor";
import { ForbiddenError } from "../apps/web/lib/rbac/authorize";
import type { PermissionKey } from "@storage/db/rbac-catalog";

// B-040 / PRD 02 US-14 (move-out), PRD 03 US-2.

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
const suffix = randomUUID().slice(0, 8);
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let facilityId = "";
let tenantId = "";
let unitAId = "";
let unitBId = "";
let counterId = "";
let managerId = "";

/// B-168. The same actor with fee-waiver authority, which is the ladder a
/// recapture reduction is measured against. `null` is unlimited.
function waiverOf(
  staffUserId: string,
  rank: number,
  maxFeeWaiverCents: number | null,
): Extract<Actor, { kind: "staff" }> {
  const base = actorOf(staffUserId, rank);
  return {
    ...base,
    assignments: [
      {
        ...base.assignments[0]!,
        permissions: new Set<PermissionKey>([
          ...base.assignments[0]!.permissions,
          "fees:waive",
        ]),
        limits: { maxFeeWaiverCents, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  };
}

function actorOf(staffUserId: string, rank: number): Extract<Actor, { kind: "staff" }> {
  return {
    kind: "staff",
    staffUserId,
    assignments: [
      {
        facilityId,
        roleKey: rank >= 20 ? "manager" : "counter",
        rank,
        permissions: new Set<PermissionKey>([
          "tenants:view",
          "leases:move_out",
          "units:edit",
          "reports:financial",
        ]),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  };
}

async function makeLease(unitId: string, balanceCents: number) {
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId,
      status: "active",
      startDate: d("2026-01-01"),
      monthlyRateCents: 31_000,
      billingDay: 1,
      paidThroughDate: d("2026-08-31"),
    },
  });
  if (balanceCents !== 0) {
    await prisma.ledgerEntry.create({
      data: {
        facilityId,
        leaseId: lease.id,
        type: "charge",
        amountCents: balanceCents,
        description: "Rent",
      },
    });
  }
  return lease;
}

describeDb("move-out", () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Move-out Test ${suffix}`,
        slug: `moveout-${suffix}`,
        addressLine1: "1 Storage Way",
        city: "Austin",
        state: "TX",
        postalCode: "78704",
        timezone: "America/Chicago",
        prorateOnMoveOut: true,
        writeOffThresholdCents: 1_000,
        moveOutNoticeDays: 10,
      },
    });
    facilityId = facility.id;

    const [counter, manager] = await Promise.all([
      prisma.staffUser.create({
        data: {
          email: `mo-counter-${suffix}@example.com`,
          firstName: "Cal",
          lastName: "Counter",
        },
      }),
      prisma.staffUser.create({
        data: {
          email: `mo-manager-${suffix}@example.com`,
          firstName: "Mel",
          lastName: "Manager",
        },
      }),
    ]);
    counterId = counter.id;
    managerId = manager.id;

    const tenant = await prisma.tenant.create({
      data: {
        email: `mo-tenant-${suffix}@example.com`,
        firstName: "Ada",
        lastName: "Renter",
      },
    });
    tenantId = tenant.id;

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    });
    const [a, b] = await Promise.all([
      prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: "A-1" },
      }),
      prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: "B-2" },
      }),
    ]);
    unitAId = a.id;
    unitBId = b.id;
  });

  beforeEach(async () => {
    await prisma.domainEvent.deleteMany({ where: { facilityId } });
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } });
    await prisma.accessCredential.deleteMany({ where: { facilityId } });
    await prisma.accessGrant.deleteMany({ where: { facilityId } });
    await prisma.unitOverlock.deleteMany({ where: { facilityId } });
    await prisma.task.deleteMany({ where: { facilityId } });
    // B-168. The recapture is a fee INVOICE now, and an invoice holds the
    // lease down — before this item a move-out created none, so nothing here
    // had to know about them. The redemption goes first: it points at the
    // invoice.
    await prisma.promoRedemption.deleteMany({ where: { facilityId } });
    await prisma.invoiceLineItem.deleteMany({
      where: { invoice: { facilityId } },
    });
    await prisma.invoice.deleteMany({ where: { facilityId } });
    await prisma.lease.deleteMany({ where: { facilityId } });
    await prisma.unit.updateMany({
      where: { facilityId },
      data: { operationalStatus: "available" },
    });
  });

  afterAll(async () => {
    if (!hasDatabase) return;
    await prisma.domainEvent.deleteMany({ where: { facilityId } });
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } });
    await prisma.accessCredential.deleteMany({ where: { facilityId } });
    await prisma.accessGrant.deleteMany({ where: { facilityId } });
    await prisma.promoRedemption.deleteMany({ where: { facilityId } });
    await prisma.invoiceLineItem.deleteMany({
      where: { invoice: { facilityId } },
    });
    await prisma.invoice.deleteMany({ where: { facilityId } });
    await prisma.lease.deleteMany({ where: { facilityId } });
    await prisma.unit.deleteMany({ where: { facilityId } });
    await prisma.unitType.deleteMany({ where: { facilityId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it("previews the settlement without writing anything", async () => {
    const lease = await makeLease(unitAId, 0);
    const before = await prisma.lease.findUniqueOrThrow({
      where: { id: lease.id },
    });

    const preview = await previewMoveOut(
      actorOf(counterId, 10),
      lease.id,
      d("2026-08-15"),
    );
    expect(preview.settlement.prorationCreditCents).toBe(17_000);
    expect(preview.settlement.refundDueCents).toBe(17_000);
    expect(preview.noticeShortfallDays).toBe(10);

    const after = await prisma.lease.findUniqueOrThrow({
      where: { id: lease.id },
    });
    expect(after.status).toBe(before.status);
    expect(after.moveOutDate).toBeNull();
  });

  it("ends the lease, posts the proration credit, and releases the unit to maintenance", async () => {
    const lease = await makeLease(unitAId, 0);
    const result = await completeMoveOut(actorOf(counterId, 10), {
      leaseId: lease.id,
      moveOutDate: d("2026-08-15"),
      reason: "tenant_request",
    });
    expect(result.ok).toBe(true);

    const ended = await prisma.lease.findUniqueOrThrow({
      where: { id: lease.id },
    });
    expect(ended.status).toBe("ended");
    expect(ended.moveOutDate?.toISOString().slice(0, 10)).toBe("2026-08-15");
    expect(ended.moveOutReason).toBe("tenant_request");

    const credit = await prisma.ledgerEntry.findFirstOrThrow({
      where: { leaseId: lease.id, type: "credit" },
    });
    expect(credit.amountCents).toBe(-17_000);

    // Never straight to available: a human has to open the door first.
    const unit = await prisma.unit.findUniqueOrThrow({
      where: { id: unitAId },
    });
    expect(unit.operationalStatus).toBe("maintenance");
    expect(unit.status).toBe("maintenance");
  });

  describe("off-platform notice (B-186)", () => {
    it("a walk-in reads as full shortfall until someone records the date they actually gave notice", async () => {
      const lease = await makeLease(unitAId, 0);
      const before = await previewMoveOut(
        actorOf(counterId, 10),
        lease.id,
        d("2026-08-15"),
      );
      expect(before.noticeGivenAt).toBeNull();
      expect(before.noticeShortfallDays).toBe(10);

      const result = await recordNoticeGiven(
        actorOf(counterId, 10),
        lease.id,
        d("2026-08-01"),
      );
      expect(result.ok).toBe(true);

      const after = await previewMoveOut(
        actorOf(counterId, 10),
        lease.id,
        d("2026-08-15"),
      );
      expect(after.noticeGivenAt?.toISOString().slice(0, 10)).toBe(
        "2026-08-01",
      );
      expect(after.noticeShortfallDays).toBe(0);
    });

    it("clears back to unset rather than defaulting to today", async () => {
      const lease = await makeLease(unitAId, 0);
      await recordNoticeGiven(actorOf(counterId, 10), lease.id, d("2026-08-01"));
      const cleared = await recordNoticeGiven(
        actorOf(counterId, 10),
        lease.id,
        null,
      );
      expect(cleared.ok).toBe(true);

      const stored = await prisma.lease.findUniqueOrThrow({
        where: { id: lease.id },
      });
      expect(stored.noticeGivenAt).toBeNull();
    });

    it("refuses a date in the future", async () => {
      const lease = await makeLease(unitAId, 0);
      const result = await recordNoticeGiven(
        actorOf(counterId, 10),
        lease.id,
        new Date(Date.now() + 24 * 60 * 60 * 1000),
      );
      expect(result).toEqual({ ok: false, problem: "future_date" });
    });

    it("refuses to record notice on a lease that already ended", async () => {
      const lease = await makeLease(unitAId, 0);
      await completeMoveOut(actorOf(counterId, 10), {
        leaseId: lease.id,
        moveOutDate: d("2026-08-15"),
        reason: "tenant_request",
      });
      const result = await recordNoticeGiven(
        actorOf(counterId, 10),
        lease.id,
        d("2026-08-01"),
      );
      expect(result).toEqual({ ok: false, problem: "not_occupying" });
    });
  });

  describe("an overlock does not outlive the lease (B-151)", () => {
    // The delinquency engine queued a removal only on CURE. A lease that ends
    // still owing halts as `moved_out` instead, so the lock stayed on: the unit
    // read `overlocked` forever (it wins over the `maintenance` the move-out
    // sets), the reconciliation screen saw system and physical agreeing — both
    // wrong — and the unit was out of sellable inventory with nothing
    // reporting it.

    it("queues the physical removal when the lease ends still owing", async () => {
      const lease = await makeLease(unitAId, 40_000);
      const requested = await requestOverlock({
        leaseId: lease.id,
        facilityId,
        reason: "Delinquent",
      });
      await confirmOverlockApplied(actorOf(managerId, 20), requested!.overlockId);
      expect(
        (await prisma.unit.findUniqueOrThrow({ where: { id: unitAId } })).status,
      ).toBe("overlocked");

      const result = await completeMoveOut(actorOf(managerId, 20), {
        leaseId: lease.id,
        moveOutDate: d("2026-08-15"),
        reason: "tenant_request",
      });
      expect(result.ok).toBe(true);

      const removal = await prisma.task.findFirstOrThrow({
        where: { facilityId, type: "overlock_remove", entityId: lease.id },
      });
      expect(removal.status).toBe("open");
      expect(removal.priority).toBe("high");

      // Deliberately still `overlocked`: there is a real lock on the door. What
      // changed is that somebody has now been ASKED to take it off.
      const stillLocked = await prisma.unit.findUniqueOrThrow({ where: { id: unitAId } });
      expect(stillLocked.status).toBe("overlocked");
      expect(isOccupied(stillLocked.status)).toBe(true);
    });

    it("returns the unit to the rentable denominator once the lock comes off", async () => {
      const lease = await makeLease(unitAId, 40_000);
      const requested = await requestOverlock({
        leaseId: lease.id,
        facilityId,
        reason: "Delinquent",
      });
      await confirmOverlockApplied(actorOf(managerId, 20), requested!.overlockId);
      await completeMoveOut(actorOf(managerId, 20), {
        leaseId: lease.id,
        moveOutDate: d("2026-08-15"),
        reason: "tenant_request",
      });

      // Through the TASK the fix raised, not by calling the service directly —
      // otherwise this passes with the release removed and guards nothing.
      const removal = await prisma.task.findFirstOrThrow({
        where: { facilityId, type: "overlock_remove", entityId: lease.id },
      });
      // `completeTask` wants `tenants:edit`, which the move-out actor in this
      // file does not carry. Extended here rather than in `actorOf`, so no
      // refusal test in this file quietly gains a permission. Copied rather
      // than mutated: `permissions` is a `ReadonlySet`.
      const base = actorOf(managerId, 20);
      const closer: Actor = {
        ...base,
        assignments: [
          {
            ...base.assignments[0]!,
            permissions: new Set<PermissionKey>([
              ...base.assignments[0]!.permissions,
              "tenants:edit",
            ]),
          },
        ],
      };
      await completeTask(closer, removal.id, { note: "Lock off, unit empty" });

      const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitAId } });
      // `maintenance`, not `available` — a human still has to open the door
      // (US-14). But it is back IN the denominator and out of the numerator,
      // which is the figure the site was quietly losing a unit from.
      expect(unit.status).toBe("maintenance");
      expect(isRentable(unit.status)).toBe(true);
      expect(isOccupied(unit.status)).toBe(false);
    });
  });

  it("emits lease.moved_out so the confirmation can be sent", async () => {
    const lease = await makeLease(unitAId, 0);
    await completeMoveOut(actorOf(counterId, 10), {
      leaseId: lease.id,
      moveOutDate: d("2026-08-15"),
      reason: "tenant_request",
    });
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { entityId: lease.id, name: "lease.moved_out" },
    });
    expect((event.payload as { refundDueCents: number }).refundDueCents).toBe(
      17_000,
    );
  });

  describe("write-off authority", () => {
    it("stops counter staff closing a lease that owes more than the threshold", async () => {
      const lease = await makeLease(unitAId, 20_000);
      const result = await completeMoveOut(actorOf(counterId, 10), {
        leaseId: lease.id,
        // No proration credit: leaving after what they paid for.
        moveOutDate: d("2026-09-30"),
        reason: "tenant_request",
      });
      expect(result).toEqual({ ok: false, problem: "needs_manager" });
      expect(
        (await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } }))
          .status,
      ).toBe("active");
    });

    it("lets a manager close it", async () => {
      const lease = await makeLease(unitAId, 20_000);
      const result = await completeMoveOut(actorOf(managerId, 20), {
        leaseId: lease.id,
        moveOutDate: d("2026-09-30"),
        reason: "tenant_request",
      });
      expect(result.ok).toBe(true);
    });

    it("writes off a small residual and clears the balance", async () => {
      const lease = await makeLease(unitAId, 800);
      const result = await completeMoveOut(actorOf(counterId, 10), {
        leaseId: lease.id,
        moveOutDate: d("2026-09-30"),
        reason: "tenant_request",
        writeOff: true,
        reasonCode: "collections_uneconomic",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.wroteOff).toBe(true);

      const balance = await prisma.ledgerEntry.aggregate({
        where: { leaseId: lease.id },
        _sum: { amountCents: true },
      });
      expect(balance._sum.amountCents).toBe(0);

      const audited = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: lease.id, action: "balance.written_off" },
      });
      expect(audited.reasonCode).toBe("collections_uneconomic");
    });

    it("refuses a write-off with no reason code", async () => {
      const lease = await makeLease(unitAId, 800);
      const result = await completeMoveOut(actorOf(counterId, 10), {
        leaseId: lease.id,
        moveOutDate: d("2026-09-30"),
        reason: "tenant_request",
        writeOff: true,
      });
      expect(result).toEqual({ ok: false, problem: "reason_code_required" });
    });
  });

  describe("access revocation (PRD 03 US-2)", () => {
    it("revokes the gate grant when the last lease ends", async () => {
      const lease = await makeLease(unitAId, 0);
      const grant = await prisma.accessGrant.create({
        data: {
          facilityId,
          tenantId,
          state: "active",
          stateCause: "system:move_in",
        },
      });

      await completeMoveOut(actorOf(counterId, 10), {
        leaseId: lease.id,
        moveOutDate: d("2026-08-15"),
        reason: "tenant_request",
      });

      expect(
        (
          await prisma.accessGrant.findUniqueOrThrow({
            where: { id: grant.id },
          })
        ).state,
      ).toBe("revoked");
    });

    it("leaves access alone while another lease at the facility remains", async () => {
      // AC1: someone with two units keeps their code for the one they still have.
      const leaving = await makeLease(unitAId, 0);
      await makeLease(unitBId, 0);
      const grant = await prisma.accessGrant.create({
        data: {
          facilityId,
          tenantId,
          state: "active",
          stateCause: "system:move_in",
        },
      });

      await completeMoveOut(actorOf(counterId, 10), {
        leaseId: leaving.id,
        moveOutDate: d("2026-08-15"),
        reason: "tenant_request",
      });

      expect(
        (
          await prisma.accessGrant.findUniqueOrThrow({
            where: { id: grant.id },
          })
        ).state,
      ).toBe("active");
    });
  });

  it("marks a unit rentable only as a separate, deliberate act", async () => {
    const lease = await makeLease(unitAId, 0);
    await completeMoveOut(actorOf(counterId, 10), {
      leaseId: lease.id,
      moveOutDate: d("2026-08-15"),
      reason: "tenant_request",
    });
    expect(
      (await prisma.unit.findUniqueOrThrow({ where: { id: unitAId } })).status,
    ).toBe("maintenance");

    await markUnitReadyToRent(actorOf(counterId, 10), facilityId, unitAId);
    expect(
      (await prisma.unit.findUniqueOrThrow({ where: { id: unitAId } })).status,
    ).toBe("available");
  });

  it("records an abandonment without forgiving the balance", async () => {
    const lease = await makeLease(unitAId, 500);
    const result = await completeMoveOut(actorOf(managerId, 20), {
      leaseId: lease.id,
      moveOutDate: d("2026-09-30"),
      reason: "abandonment",
    });
    expect(result.ok).toBe(true);

    const ended = await prisma.lease.findUniqueOrThrow({
      where: { id: lease.id },
    });
    expect(ended.moveOutReason).toBe("abandonment");
    const balance = await prisma.ledgerEntry.aggregate({
      where: { leaseId: lease.id },
      _sum: { amountCents: true },
    });
    expect(balance._sum.amountCents, "abandonment forgave the debt").toBe(500);
  });

  it("lists a former tenant who left owing, and not one who did not", async () => {
    const owing = await makeLease(unitAId, 500);
    const settled = await makeLease(unitBId, 0);
    const actor = actorOf(managerId, 20);
    await completeMoveOut(actor, {
      leaseId: owing.id,
      moveOutDate: d("2026-09-30"),
      reason: "tenant_request",
    });
    await completeMoveOut(actor, {
      leaseId: settled.id,
      // Paid ahead, so this one ends in credit rather than debt.
      moveOutDate: d("2026-08-15"),
      reason: "tenant_request",
    });

    const debts = await formerTenantDebts(actor, facilityId);
    expect(debts.map((row) => row.leaseId)).toEqual([owing.id]);
    expect(debts[0].balanceCents).toBe(500);
  });

  describe("promotional recapture (B-145)", () => {
    // Six months of the minimum, a lease that ran two, and a $64.50 discount
    // that WAS applied against a $129 promised total. The gap between those two
    // numbers is the whole feature: `totalCents` is what was promised and
    // `appliedPeriods` is what was given, and only the second is recoverable.
    async function promotedLease(options: {
      policy: "none" | "full" | "prorated";
      minStayMonths: number;
      appliedPeriods: number[];
    }) {
      await prisma.facility.update({
        where: { id: facilityId },
        data: { promoRecapturePolicy: options.policy },
      });
      const lease = await makeLease(unitAId, 0);
      const promotion = await prisma.promotion.create({
        data: {
          name: `Recapture ${suffix}`,
          type: "percent_off",
          value: 50,
          durationPeriods: 2,
          status: "active",
          displayMode: "auto",
          facilityIds: [facilityId],
          minStayMonths: options.minStayMonths,
        },
      });
      await prisma.promoRedemption.create({
        data: {
          promotionId: promotion.id,
          facilityId,
          leaseId: lease.id,
          schedule: [
            { periodIndex: 0, amountCents: 6_450 },
            { periodIndex: 1, amountCents: 6_450 },
          ],
          totalCents: 12_900,
          appliedPeriods: options.appliedPeriods,
        },
      });
      return lease;
    }

    afterEach(async () => {
      await prisma.promoRedemption.deleteMany({ where: { facilityId } });
      await prisma.promotion.deleteMany({
        where: { name: { contains: suffix } },
      });
      await prisma.facility.update({
        where: { id: facilityId },
        data: { promoRecapturePolicy: "none" },
      });
    });

    it("recovers only the discount actually applied, not the promised total", async () => {
      // One of the two scheduled periods was ever discounted. Billing back
      // $129.00 would charge for a month the tenant never got cheap.
      const lease = await promotedLease({
        policy: "full",
        minStayMonths: 6,
        appliedPeriods: [0],
      });
      const preview = await previewMoveOut(
        actorOf(managerId, 20),
        lease.id,
        d("2026-03-01"),
      );
      expect(preview.recapture.amountCents).toBe(6_450);
      expect(preview.settlement.recaptureCents).toBe(6_450);
      expect(preview.recapture.reason).toContain("6-month minimum stay");
    });

    it("prorates to the months not served", async () => {
      // In 1 Jan, out 1 Mar: two months served of six, so four of the six
      // remain. $129.00 given × 4/6 = $86.00.
      const lease = await promotedLease({
        policy: "prorated",
        minStayMonths: 6,
        appliedPeriods: [0, 1],
      });
      const preview = await previewMoveOut(
        actorOf(managerId, 20),
        lease.id,
        d("2026-03-01"),
      );
      expect(preview.recapture.monthsRemaining).toBe(4);
      expect(preview.recapture.amountCents).toBe(8_600);
    });

    it("recovers nothing under the default policy", async () => {
      // The shipped default, and the reason a facility that has chosen nothing
      // does not start billing former tenants because a column appeared.
      const lease = await promotedLease({
        policy: "none",
        minStayMonths: 6,
        appliedPeriods: [0, 1],
      });
      const preview = await previewMoveOut(
        actorOf(managerId, 20),
        lease.id,
        d("2026-03-01"),
      );
      expect(preview.recapture.amountCents).toBe(0);
      expect(preview.recapture.reason).toBeNull();
    });

    it("recovers nothing once the tenant has served the minimum", async () => {
      const lease = await promotedLease({
        policy: "full",
        minStayMonths: 2,
        appliedPeriods: [0, 1],
      });
      const preview = await previewMoveOut(
        actorOf(managerId, 20),
        lease.id,
        d("2026-08-15"),
      );
      expect(preview.recapture.amountCents).toBe(0);
    });

    it("posts it to the ledger with the same words the tenant agreed to", async () => {
      const lease = await promotedLease({
        policy: "full",
        minStayMonths: 6,
        appliedPeriods: [0, 1],
      });
      const preview = await previewMoveOut(
        actorOf(managerId, 20),
        lease.id,
        d("2026-03-01"),
      );

      const result = await completeMoveOut(actorOf(managerId, 20), {
        leaseId: lease.id,
        moveOutDate: d("2026-03-01"),
        reason: "tenant_request",
      });
      expect(result.ok).toBe(true);

      const charge = await prisma.ledgerEntry.findFirstOrThrow({
        where: {
          leaseId: lease.id,
          type: "charge",
          description: { contains: "Promotional" },
        },
      });
      expect(charge.amountCents).toBe(12_900);
      // The ledger row must not be a different form of words from the screen
      // that got consent — one sentence, produced once. B-168 appended the
      // invoice number to it, and nothing else changed.
      expect(charge.description).toContain(preview.recapture.reason);
      // The invariant worth having: what the preview said the lease settles to
      // is what the ledger actually holds once it is closed. This fixture is
      // paid through August, so the $310 proration credit outweighs the $129
      // recovered and the tenant still leaves with money back — the recapture
      // eats into a refund rather than being collected beside one.
      const balance = await prisma.ledgerEntry.aggregate({
        where: { leaseId: lease.id },
        _sum: { amountCents: true },
      });
      expect(balance._sum.amountCents).toBe(preview.settlement.netBalanceCents);
      expect(preview.settlement.refundDueCents).toBe(18_100);
    });

    // B-168. The recapture used to be a bare `type: 'charge'` ledger row, so
    // no existing tool could see it and the only lever over a disputed one was
    // `writeOff` — all or nothing across the whole residual.
    it("posts it as a fee invoice every existing tool can reach", async () => {
      const lease = await promotedLease({
        policy: "full",
        minStayMonths: 6,
        appliedPeriods: [0, 1],
      });
      const preview = await previewMoveOut(
        actorOf(managerId, 20),
        lease.id,
        d("2026-03-01"),
      );

      await completeMoveOut(actorOf(managerId, 20), {
        leaseId: lease.id,
        moveOutDate: d("2026-03-01"),
        reason: "tenant_request",
      });

      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { leaseId: lease.id, kind: "fee" },
        include: { lineItems: true },
      });
      expect(invoice.totalCents).toBe(12_900);
      // Aged from the move-out, not from tonight: the charge is for a term
      // that ended on that day.
      expect(invoice.dueDate.toISOString().slice(0, 10)).toBe("2026-03-01");
      // The sentence the tenant agreed to, on the line they read.
      expect(invoice.lineItems[0]?.description).toBe(preview.recapture.reason);

      // Reachable by the waiver path, which is the whole reason it is an
      // invoice: `waivableFees` lists fee invoices and `waiveFeeInvoice` voids
      // them, so a recapture disputed a fortnight later has a lever.
      const waived = await waiveFeeInvoice(
        waiverOf(managerId, 20, null),
        invoice.id,
        { reasonCode: "goodwill" },
      );
      expect(waived).toEqual({ ok: true, amountCents: 12_900 });
    });

    it("reduces it at the counter, records both halves, and audits why", async () => {
      const lease = await promotedLease({
        policy: "full",
        minStayMonths: 6,
        appliedPeriods: [0, 1],
      });

      const result = await completeMoveOut(waiverOf(managerId, 20, null), {
        leaseId: lease.id,
        moveOutDate: d("2026-03-01"),
        reason: "tenant_request",
        recaptureChargeCents: 5_000,
        recaptureReasonCode: "goodwill",
      });
      expect(result.ok).toBe(true);
      expect(result.ok && result.settlement.recaptureCents).toBe(5_000);

      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { leaseId: lease.id, kind: "fee" },
        include: { lineItems: true },
      });
      expect(invoice.totalCents).toBe(5_000);
      // The sentence says what happened to the number beside it.
      expect(invoice.lineItems[0]?.description).toContain("reduced by $79.00");

      // Both halves on the redemption, which is what makes the term
      // reportable: charged alone cannot show a term being given away.
      const redemption = await prisma.promoRedemption.findFirstOrThrow({
        where: { leaseId: lease.id },
      });
      expect(redemption.recaptureChargedCents).toBe(5_000);
      expect(redemption.recaptureWaivedCents).toBe(7_900);
      expect(redemption.recaptureInvoiceId).toBe(invoice.id);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "promo.recapture_reduced", entityId: lease.id },
      });
      expect(audit.reasonCode).toBe("goodwill");
      expect(audit.after).toMatchObject({
        ruledCents: 12_900,
        chargedCents: 5_000,
        forgivenCents: 7_900,
      });
    });

    it("waives it in full without touching the rest of the residual", async () => {
      // The defect this closes: `writeOff` is all-or-nothing across the ENTIRE
      // residual, so forgiving a disputed recapture also forgave every arrear
      // beside it under one reason code.
      const lease = await promotedLease({
        policy: "full",
        minStayMonths: 6,
        appliedPeriods: [0, 1],
      });
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId: lease.id,
          type: "charge",
          amountCents: 40_000,
          description: "Rent arrears nobody disputed",
        },
      });

      const result = await completeMoveOut(waiverOf(managerId, 20, null), {
        leaseId: lease.id,
        moveOutDate: d("2026-03-01"),
        reason: "tenant_request",
        recaptureChargeCents: 0,
        recaptureReasonCode: "goodwill",
      });
      expect(result.ok).toBe(true);

      // No recapture invoice at all — nothing was charged.
      expect(
        await prisma.invoice.count({ where: { leaseId: lease.id, kind: "fee" } }),
      ).toBe(0);
      const redemption = await prisma.promoRedemption.findFirstOrThrow({
        where: { leaseId: lease.id },
      });
      expect(redemption.recaptureChargedCents).toBe(0);
      expect(redemption.recaptureWaivedCents).toBe(12_900);

      // The arrears survived. That is the entire point.
      expect(
        await prisma.ledgerEntry.count({
          where: { leaseId: lease.id, type: "write_off" },
        }),
      ).toBe(0);
      const balance = await prisma.ledgerEntry.aggregate({
        where: { leaseId: lease.id },
        _sum: { amountCents: true },
      });
      expect(balance._sum.amountCents).toBe(
        result.ok ? result.settlement.netBalanceCents : -1,
      );
    });

    it("refuses a reduction with no reason, and one beyond the actor's waiver limit", async () => {
      const lease = await promotedLease({
        policy: "full",
        minStayMonths: 6,
        appliedPeriods: [0, 1],
      });

      expect(
        await completeMoveOut(waiverOf(managerId, 20, null), {
          leaseId: lease.id,
          moveOutDate: d("2026-03-01"),
          reason: "tenant_request",
          recaptureChargeCents: 5_000,
        }),
      ).toMatchObject({ ok: false, problem: "recapture_reason_required" });

      // $79 forgiven against a $50 limit. RBAC-2: the refusal names who can.
      const overLimit = await completeMoveOut(waiverOf(managerId, 20, 5_000), {
        leaseId: lease.id,
        moveOutDate: d("2026-03-01"),
        reason: "tenant_request",
        recaptureChargeCents: 5_000,
        recaptureReasonCode: "goodwill",
      });
      expect(overLimit).toMatchObject({
        ok: false,
        problem: "recapture_over_limit",
        forgivenCents: 7_900,
        limitCents: 5_000,
      });

      // No fee-waiver permission at all is a different refusal from being
      // over the limit, and says so.
      expect(
        await completeMoveOut(actorOf(managerId, 20), {
          leaseId: lease.id,
          moveOutDate: d("2026-03-01"),
          reason: "tenant_request",
          recaptureChargeCents: 5_000,
          recaptureReasonCode: "goodwill",
        }),
      ).toMatchObject({ ok: false, problem: "recapture_forbidden" });

      // Refused means refused: the lease is still open.
      expect(
        (await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } })).status,
      ).not.toBe("ended");
    });

    it("cannot be used to charge MORE than the promotion gave away", async () => {
      const lease = await promotedLease({
        policy: "full",
        minStayMonths: 6,
        appliedPeriods: [0, 1],
      });
      const result = await completeMoveOut(waiverOf(managerId, 20, null), {
        leaseId: lease.id,
        moveOutDate: d("2026-03-01"),
        reason: "tenant_request",
        recaptureChargeCents: 99_000,
        recaptureReasonCode: "goodwill",
      });
      // Clamped to the ruled figure, not billed at 99,000 — and no reason is
      // needed, because nothing was forgiven.
      expect(result.ok && result.settlement.recaptureCents).toBe(12_900);
    });

    it("recovers nothing on a transfer — a transferred tenant is still a tenant", async () => {
      // The `MoveOutReason` enum's own words. A move between units at the same
      // site does not break the promotion's minimum stay, and charging one back
      // would bill somebody for staying.
      const lease = await promotedLease({
        policy: "full",
        minStayMonths: 6,
        appliedPeriods: [0, 1],
      });
      const result = await completeMoveOut(actorOf(managerId, 20), {
        leaseId: lease.id,
        moveOutDate: d("2026-03-01"),
        reason: "transfer",
      });
      expect(result.ok && result.settlement.recaptureCents).toBe(0);
      expect(
        await prisma.ledgerEntry.count({
          where: {
            leaseId: lease.id,
            description: { contains: "Promotional" },
          },
        }),
      ).toBe(0);
    });
  });

  it("refuses a facility the actor is not assigned to", async () => {
    const other = await prisma.facility.create({
      data: {
        name: `Other ${suffix}`,
        slug: `moveout-other-${suffix}`,
        addressLine1: "9 Elsewhere",
        city: "Dallas",
        state: "TX",
        postalCode: "75201",
        timezone: "America/Chicago",
      },
    });
    await expect(
      formerTenantDebts(actorOf(counterId, 10), other.id),
    ).rejects.toThrow(ForbiddenError);
    await prisma.facility.delete({ where: { id: other.id } });
  });
});
