import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../packages/db";
import { applyPayment } from "../apps/web/lib/billing/allocation";
import {
  refundPayment,
  refundablePayments,
} from "../apps/web/lib/billing/refunds";
import {
  returnPayment,
  returnablePayments,
} from "../apps/web/lib/billing/reversals";
import { portalPayments } from "../apps/web/lib/portal/documents";
import { ForbiddenError } from "../apps/web/lib/rbac/authorize";
import type { Actor } from "../apps/web/lib/rbac/actor";
import type { PermissionKey } from "@storage/db/rbac-catalog";

// B-048 / PRD 02 US-22, US-23. Allocation and refunds against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
const suffix = randomUUID().slice(0, 8);

let facilityId = "";
let tenantId = "";
let leaseId = "";
let unitTypeId = "";
let staffId = "";
let invoiceCounter = 0;

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function actorWith(
  options: {
    permissions?: PermissionKey[];
    maxRefundCents?: number | null;
  } = {},
): Actor {
  return {
    kind: "staff",
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: "manager",
        rank: 20,
        permissions: new Set<PermissionKey>(
          options.permissions ?? ["refunds:approve"],
        ),
        limits: {
          maxFeeWaiverCents: 0,
          maxRefundCents:
            options.maxRefundCents === undefined
              ? 50_000
              : options.maxRefundCents,
          maxCreditCents: 0,
        },
      },
    ],
  };
}

async function invoice(options: {
  kind?: "rent" | "fee";
  dueDate: Date;
  lines: { type: "rent" | "tax" | "fee" | "protection"; amountCents: number }[];
}): Promise<string> {
  invoiceCounter += 1;
  const total = options.lines.reduce((sum, line) => sum + line.amountCents, 0);
  const row = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `RF${String(invoiceCounter).padStart(5, "0")}`,
      kind: options.kind ?? "rent",
      status: "open",
      issueDate: options.dueDate,
      dueDate: options.dueDate,
      periodStart: options.dueDate,
      periodEnd: new Date(options.dueDate.getTime() + 30 * 86_400_000),
      subtotalCents: total,
      totalCents: total,
      lineItems: {
        create: options.lines.map((line) => ({
          type: line.type,
          description: line.type,
          quantity: 1,
          unitAmountCents: line.amountCents,
          amountCents: line.amountCents,
        })),
      },
    },
  });
  return row.id;
}

async function succeededPayment(amountCents: number): Promise<string> {
  const payment = await prisma.payment.create({
    data: {
      facilityId,
      tenantId,
      amountCents,
      method: "card",
      status: "succeeded",
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      type: "payment",
      amountCents: -amountCents,
      description: "Payment",
      paymentId: payment.id,
    },
  });
  await prisma.$transaction(async (tx) => {
    await applyPayment(tx, {
      id: payment.id,
      tenantId,
      facilityId,
      amountCents,
    });
  });
  return payment.id;
}

describeDb("partial payments and refunds", () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: "Refund Test",
        slug: `refund-${suffix}`,
        addressLine1: "1 Storage Way",
        city: "Austin",
        state: "TX",
        postalCode: "78704",
        timezone: "America/Chicago",
      },
    });
    facilityId = facility.id;

    const tenant = await prisma.tenant.create({
      data: {
        email: `refund-${suffix}@example.com`,
        firstName: "Ada",
        lastName: "Renter",
      },
    });
    tenantId = tenant.id;

    const staff = await prisma.staffUser.create({
      data: {
        email: `refund-staff-${suffix}@example.com`,
        firstName: "Mo",
        lastName: "Manager",
      },
    });
    staffId = staff.id;

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    });
    unitTypeId = unitType.id;
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId, number: "R-1" },
    });
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: "active",
        startDate: d("2026-08-01"),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    });
    leaseId = lease.id;
  });

  afterEach(async () => {
    await prisma.paymentAllocation.deleteMany({
      where: { payment: { facilityId } },
    });
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } });
    await prisma.payment.deleteMany({
      where: { facilityId, refundOfPaymentId: { not: null } },
    });
    await prisma.payment.deleteMany({ where: { facilityId } });
    await prisma.invoiceLineItem.deleteMany({
      where: { invoice: { facilityId } },
    });
    await prisma.invoice.deleteMany({ where: { facilityId } });
    await prisma.domainEvent.deleteMany({ where: { facilityId } });
    await prisma.task.deleteMany({ where: { facilityId } });
    await prisma.feeSchedule.deleteMany({ where: { facilityId } });
    await prisma.facility.update({
      where: { id: facilityId },
      data: { paymentAllocationOrder: ["tax", "fee", "protection", "rent"] },
    });
  });

  afterAll(async () => {
    if (!hasDatabase) return;
    await prisma.task.deleteMany({ where: { facilityId } });
    await prisma.feeSchedule.deleteMany({ where: { facilityId } });
    await prisma.lease.deleteMany({ where: { facilityId } });
    await prisma.unit.deleteMany({ where: { facilityId } });
    await prisma.unitType.deleteMany({ where: { facilityId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  describe("returned payments — US-46 / FR-8 (B-146)", () => {
    // `reversalOfId` had existed since B-002, cited FR-8 in its own schema
    // comment, and was written by no code; `FeeType.nsf` was configurable and
    // read by no code. So a bounced cheque left the money recorded as
    // collected, the invoice reading `paid`, and the arrears invisible to
    // ageing — forever.

    async function nsfFeeOf(amountCents: number) {
      await prisma.feeSchedule.create({
        data: {
          facilityId,
          feeType: "nsf",
          amountCents,
          effectiveFrom: d("2026-01-01"),
        },
      });
    }

    it("reverses the entry, reopens the invoice and leaves the original alone", async () => {
      const invoiceId = await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);
      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } }))
          .status,
      ).toBe("paid");

      const result = await returnPayment(actorWith(), paymentId, {
        reasonCode: "insufficient_funds",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.reopenedInvoiceIds).toEqual([invoiceId]);

      // FR-8: append-only. The original entry is untouched — money DID arrive
      // that day against a receipt the tenant holds — and the correction points
      // back at it through the column that had never been written.
      const original = await prisma.ledgerEntry.findFirstOrThrow({
        where: { paymentId, type: "payment" },
      });
      expect(original.amountCents).toBe(-12_900);
      const reversal = await prisma.ledgerEntry.findUniqueOrThrow({
        where: { id: result.reversalEntryId },
      });
      expect(reversal.reversalOfId).toBe(original.id);
      expect(reversal.amountCents).toBe(12_900);

      // The invoice is open again and the balance is back where it was.
      const invoiceAfter = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      expect(invoiceAfter.status).toBe("open");
      expect(invoiceAfter.amountPaidCents).toBe(0);
      // The ORIGINAL due date, not today: `daysPastDue` anchors to the oldest
      // unpaid invoice's original due date (D-25), so the arrears reappear with
      // the age they always had rather than starting the clock again.
      expect(invoiceAfter.dueDate).toEqual(d("2026-08-01"));

      const balance = await prisma.ledgerEntry.aggregate({
        where: { leaseId },
        _sum: { amountCents: true },
      });
      expect(balance._sum.amountCents).toBe(0);
    });

    it("charges the configured NSF fee as its own waivable fee invoice", async () => {
      await nsfFeeOf(3_000);
      await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);

      const result = await returnPayment(actorWith(), paymentId, {
        reasonCode: "account_closed",
      });
      if (!result.ok) throw new Error("unreachable");
      expect(result.feeCents).toBe(3_000);

      // `kind: 'fee'` is what makes it waivable like any other fee (US-21) and
      // collectable by autopay — a fee posted only to the ledger would be
      // neither.
      const fee = await prisma.invoice.findFirstOrThrow({
        where: { facilityId, kind: "fee", number: result.feeInvoiceNumber! },
      });
      expect(fee.totalCents).toBe(3_000);
      expect(fee.status).toBe("open");

      // Rent owed again, plus the fee.
      const balance = await prisma.ledgerEntry.aggregate({
        where: { leaseId },
        _sum: { amountCents: true },
      });
      expect(balance._sum.amountCents).toBe(3_000);
    });

    it("charges no fee when the facility has configured none", async () => {
      // The shipped state — `FeeType.nsf` has never had a reader, so no
      // facility has ever had a reason to set one.
      await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const result = await returnPayment(
        actorWith(),
        await succeededPayment(12_900),
        {
          reasonCode: "insufficient_funds",
        },
      );
      if (!result.ok) throw new Error("unreachable");
      expect(result.feeInvoiceNumber).toBeNull();
      expect(result.feeCents).toBe(0);
    });

    it("skips the fee when it is waived, and records that as a choice", async () => {
      await nsfFeeOf(3_000);
      await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const result = await returnPayment(
        actorWith(),
        await succeededPayment(12_900),
        {
          reasonCode: "bank_error",
          waiveFee: true,
        },
      );
      if (!result.ok) throw new Error("unreachable");
      expect(result.feeCents).toBe(0);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { facilityId, action: "payment.returned" },
        orderBy: { occurredAt: "desc" },
      });
      // Recorded as a decision — an absent fee otherwise reads identically to a
      // facility that configured none.
      // `context` is merged into `after` by `recordAudit`.
      expect((audit.after as { feeWaived?: boolean }).feeWaived).toBe(true);
      expect(audit.reasonCode).toBe("bank_error");
    });

    it("raises the existing bounced-payment task rather than a new queue", async () => {
      await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);
      await returnPayment(actorWith(), paymentId, {
        reasonCode: "stop_payment",
      });

      const task = await prisma.task.findFirstOrThrow({
        where: { facilityId, entityId: paymentId },
      });
      // US-41's rule: one queue. `settling_payment_failed` already exists for
      // exactly this conversation (B-103) — a tenant holding a receipt who is
      // about to be chased — rather than a second type per source.
      expect(task.type).toBe("settling_payment_failed");
      expect(task.priority).toBe("high");
    });

    it("is not a refund: no second payment row, no drawer movement", async () => {
      // The row's own warning. `refundPayment` pulls cash from the open drawer
      // for cash and cheque, so recording a bounce that way makes the till
      // short by money that never left it.
      await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);
      await returnPayment(actorWith(), paymentId, {
        reasonCode: "insufficient_funds",
      });

      expect(
        await prisma.payment.count({
          where: { facilityId, refundOfPaymentId: { not: null } },
        }),
      ).toBe(0);
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      expect(payment.status).toBe("returned");
      expect(payment.drawerSessionId).toBeNull();
      // And no `refund`-type entry, which the revenue report reads as money out.
      expect(
        await prisma.ledgerEntry.count({
          where: { facilityId, type: "refund" },
        }),
      ).toBe(0);
    });

    it("refuses to return the same payment twice", async () => {
      await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);
      await returnPayment(actorWith(), paymentId, {
        reasonCode: "insufficient_funds",
      });

      expect(
        await returnPayment(actorWith(), paymentId, {
          reasonCode: "insufficient_funds",
        }),
      ).toEqual({
        ok: false,
        reason: "already_returned",
      });
      // One reversal, not two — `reversalOfId` is unique, so a second would
      // throw rather than double the balance, but the guard is what makes the
      // refusal a sentence instead of a stack trace.
      expect(
        await prisma.ledgerEntry.count({
          where: { facilityId, type: "adjustment" },
        }),
      ).toBe(1);
    });

    it("refuses a reason-less return, because the bank reason is the record", async () => {
      await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      expect(
        await returnPayment(actorWith(), await succeededPayment(12_900), {
          reasonCode: "  ",
        }),
      ).toEqual({
        ok: false,
        reason: "missing_reason",
      });
    });

    it("refuses a payment that never settled", async () => {
      // B-103's case: an ACH accepted and then failed before settling. Nothing
      // was posted, so — as `reconcile.ts` says — the balance is already
      // correct and there is nothing to reverse.
      const pending = await prisma.payment.create({
        data: {
          facilityId,
          tenantId,
          amountCents: 12_900,
          method: "ach",
          status: "processing",
        },
      });
      expect(
        await returnPayment(actorWith(), pending.id, {
          reasonCode: "insufficient_funds",
        }),
      ).toEqual({
        ok: false,
        reason: "not_settled",
      });
    });

    it("needs the same authority as a refund, and no refund limit", async () => {
      await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);

      await expect(
        returnPayment(
          actorWith({ permissions: ["payments:take"] }),
          paymentId,
          {
            reasonCode: "insufficient_funds",
          },
        ),
      ).rejects.toThrow(ForbiddenError);

      // But NOT the monetary limit. The bank chose the amount, and refusing to
      // record a large returned cheque would leave it recorded as collected —
      // which is the defect, not a control.
      const result = await returnPayment(
        actorWith({ maxRefundCents: 100 }),
        paymentId,
        {
          reasonCode: "insufficient_funds",
        },
      );
      expect(result.ok).toBe(true);
    });

    it("lists what could still come back, and drops it once it has", async () => {
      await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);
      expect(
        (await returnablePayments(tenantId)).map((row) => row.paymentId),
      ).toEqual([paymentId]);

      await returnPayment(actorWith(), paymentId, {
        reasonCode: "insufficient_funds",
      });
      expect(await returnablePayments(tenantId)).toEqual([]);
      // And it can no longer be refunded — giving back money the bank already
      // took would pay the tenant twice.
      expect(
        (await refundablePayments(tenantId)).map((row) => row.paymentId),
      ).not.toContain(paymentId);
    });
  });

  describe("allocation", () => {
    it("splits a partial payment across categories in the configured order", async () => {
      await invoice({
        dueDate: d("2026-09-01"),
        lines: [
          { type: "rent", amountCents: 12_900 },
          { type: "tax", amountCents: 806 },
        ],
      });

      const paymentId = await succeededPayment(2_000);

      const allocation = await prisma.paymentAllocation.findFirstOrThrow({
        where: { paymentId },
      });
      expect(allocation.amountCents).toBe(2_000);
      const settled = await prisma.invoice.findFirstOrThrow({
        where: { leaseId },
      });
      expect(settled.amountPaidCents).toBe(2_000);
      expect(settled.status).toBe("partially_paid");
    });

    it("clears an older invoice before a newer one", async () => {
      const older = await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 5_000 }],
      });
      const newer = await invoice({
        dueDate: d("2026-09-01"),
        lines: [{ type: "rent", amountCents: 5_000 }],
      });

      await succeededPayment(5_000);

      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: older } }))
          .status,
      ).toBe("paid");
      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: newer } }))
          .status,
      ).toBe("open");
    });

    it("clears a fee invoice before rent under the default order", async () => {
      const rent = await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const fee = await invoice({
        kind: "fee",
        dueDate: d("2026-09-01"),
        lines: [{ type: "fee", amountCents: 2_000 }],
      });

      await succeededPayment(2_000);

      // Fee before rent even though the rent invoice is older — the category
      // order outranks the date, which is what US-22 asks for.
      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: fee } })).status,
      ).toBe("paid");
      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: rent } }))
          .status,
      ).toBe("open");
    });

    it("honours a facility that puts rent first", async () => {
      await prisma.facility.update({
        where: { id: facilityId },
        data: { paymentAllocationOrder: ["rent", "fee", "protection", "tax"] },
      });
      const rent = await invoice({
        dueDate: d("2026-08-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      await invoice({
        kind: "fee",
        dueDate: d("2026-09-01"),
        lines: [{ type: "fee", amountCents: 2_000 }],
      });

      await succeededPayment(2_000);

      const rentInvoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: rent },
      });
      expect(rentInvoice.amountPaidCents).toBe(2_000);
    });

    it("is idempotent — reapplying the same payment does not double the paid total", async () => {
      await invoice({
        dueDate: d("2026-09-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(5_000);

      await prisma.$transaction(async (tx) => {
        await applyPayment(tx, {
          id: paymentId,
          tenantId,
          facilityId,
          amountCents: 5_000,
        });
      });

      const settled = await prisma.invoice.findFirstOrThrow({
        where: { leaseId },
      });
      expect(settled.amountPaidCents).toBe(5_000);
      expect(
        await prisma.paymentAllocation.count({ where: { paymentId } }),
      ).toBe(1);
    });

    it("never resurrects a waived fee", async () => {
      // A voided invoice is money a manager deliberately forgave (B-047).
      const fee = await invoice({
        kind: "fee",
        dueDate: d("2026-09-01"),
        lines: [{ type: "fee", amountCents: 2_000 }],
      });
      await prisma.invoice.update({
        where: { id: fee },
        data: { status: "void" },
      });

      await succeededPayment(2_000);

      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: fee } })).status,
      ).toBe("void");
    });
  });

  describe("refunds", () => {
    it("records a cash refund as a payable, not as money already gone", async () => {
      await invoice({
        dueDate: d("2026-09-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);

      const result = await refundPayment(actorWith(), paymentId, {
        amountCents: 5_000,
        reasonCode: "billing_error",
        asMethod: "cash",
      });
      expect(result).toMatchObject({ ok: true, method: "cash" });
      if (!result.ok) throw new Error("unreachable");

      const refund = await prisma.payment.findUniqueOrThrow({
        where: { id: result.refundPaymentId },
      });
      // Pending, because nobody has handed the cash over yet. Marking it
      // succeeded would put a refund in the books that has not happened.
      expect(refund.status).toBe("pending");
      expect(refund.refundOfPaymentId).toBe(paymentId);

      const original = await prisma.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      expect(original.status).toBe("partially_refunded");
    });

    it("posts a refund to the ledger that increases what is owed", async () => {
      await invoice({
        dueDate: d("2026-09-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);
      await refundPayment(actorWith(), paymentId, {
        amountCents: 12_900,
        reasonCode: "billing_error",
        asMethod: "cash",
      });

      const entry = await prisma.ledgerEntry.findFirstOrThrow({
        where: { leaseId, type: "refund" },
      });
      // The money went back, so the tenant owes it again.
      expect(entry.amountCents).toBe(12_900);
    });

    it("unwinds the allocation so the invoice stops reading as paid", async () => {
      // The bug this prevents: an invoice left `paid` on money that went back
      // is uncollected forever and invisible to every ageing report.
      const invoiceId = await invoice({
        dueDate: d("2026-09-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);
      expect(
        (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } }))
          .status,
      ).toBe("paid");

      await refundPayment(actorWith(), paymentId, {
        amountCents: 12_900,
        reasonCode: "billing_error",
        asMethod: "cash",
      });

      const after = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      expect(after.status).toBe("open");
      expect(after.amountPaidCents).toBe(0);
    });

    it("partially unwinds a partial refund", async () => {
      const invoiceId = await invoice({
        dueDate: d("2026-09-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);

      await refundPayment(actorWith(), paymentId, {
        amountCents: 4_000,
        reasonCode: "customer_goodwill",
        asMethod: "cash",
      });

      const after = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      expect(after.amountPaidCents).toBe(8_900);
      expect(after.status).toBe("partially_paid");
    });

    it("audits the refund with its reason, and flags a changed method", async () => {
      // Refunding a card payment in cash is the shape an internal fraud takes;
      // the log says it happened rather than leaving it to be inferred.
      await invoice({
        dueDate: d("2026-09-01"),
        lines: [{ type: "rent", amountCents: 12_900 }],
      });
      const paymentId = await succeededPayment(12_900);
      await refundPayment(actorWith(), paymentId, {
        amountCents: 1_000,
        reasonCode: "customer_goodwill",
        asMethod: "cash",
      });

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "refund.issued", entityId: paymentId },
      });
      expect(audit.reasonCode).toBe("customer_goodwill");
      expect((audit.after as { methodChanged: boolean }).methodChanged).toBe(
        true,
      );
    });

    it("refuses without a reason code", async () => {
      const paymentId = await succeededPayment(12_900);
      expect(
        await refundPayment(actorWith(), paymentId, {
          amountCents: 100,
          reasonCode: " ",
          asMethod: "cash",
        }),
      ).toMatchObject({ ok: false, reason: "missing_reason" });
    });

    it("refuses a staffer without the permission", async () => {
      const paymentId = await succeededPayment(12_900);
      expect(
        await refundPayment(
          actorWith({ permissions: ["tenants:view"] }),
          paymentId,
          {
            amountCents: 100,
            reasonCode: "billing_error",
            asMethod: "cash",
          },
        ),
      ).toMatchObject({ ok: false, reason: "forbidden" });
    });

    it("refuses over the actor’s limit and names it", async () => {
      const paymentId = await succeededPayment(12_900);
      expect(
        await refundPayment(actorWith({ maxRefundCents: 500 }), paymentId, {
          amountCents: 10_000,
          reasonCode: "billing_error",
          asMethod: "cash",
        }),
      ).toMatchObject({ ok: false, reason: "over_limit", limitCents: 500 });
    });

    it("refuses more than was paid, across several refunds", async () => {
      const paymentId = await succeededPayment(12_900);
      await refundPayment(actorWith(), paymentId, {
        amountCents: 10_000,
        reasonCode: "billing_error",
        asMethod: "cash",
      });
      expect(
        await refundPayment(actorWith(), paymentId, {
          amountCents: 5_000,
          reasonCode: "billing_error",
          asMethod: "cash",
        }),
      ).toMatchObject({ ok: false, reason: "over_original" });
    });

    it("refuses to refund a payment that never succeeded", async () => {
      const failed = await prisma.payment.create({
        data: {
          facilityId,
          tenantId,
          amountCents: 5_000,
          method: "card",
          status: "failed",
        },
      });
      expect(
        await refundPayment(actorWith(), failed.id, {
          amountCents: 100,
          reasonCode: "billing_error",
          asMethod: "cash",
        }),
      ).toMatchObject({ ok: false, reason: "not_refundable" });
    });

    it("marks the original fully refunded once nothing is left", async () => {
      const paymentId = await succeededPayment(12_900);
      await refundPayment(actorWith(), paymentId, {
        amountCents: 12_900,
        reasonCode: "billing_error",
        asMethod: "cash",
      });
      expect(
        (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }))
          .status,
      ).toBe("refunded");
    });

    it("lists what is still refundable, and never a refund itself", async () => {
      const paymentId = await succeededPayment(12_900);
      await refundPayment(actorWith(), paymentId, {
        amountCents: 4_000,
        reasonCode: "billing_error",
        asMethod: "cash",
      });

      const rows = await refundablePayments(tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        paymentId,
        refundedCents: 4_000,
        refundableCents: 8_900,
      });
    });
  });
  // B-179 / PRD 01 §4.7 US-705. What the TENANT sees, on the same rows the
  // staff-side tests above create.
  //
  // The screen used to read "Returned unpaid by the bank. This amount is owed
  // again — please call us" beside a figure still showing the full payment as
  // though it had landed, with a pay route one tap away on the dashboard. These
  // pin the three facts that turn the instruction into an action, and the one
  // that decides whether the tenant understands their own total.
  describe("the tenant's view of a returned payment — US-705 (B-179)", () => {
    async function nsfFeeOf(amountCents: number) {
      await prisma.feeSchedule.create({
        data: {
          facilityId,
          feeType: "nsf",
          amountCents,
          effectiveFrom: d("2026-01-01"),
        },
      });
    }

    /// A rent charge on the ledger, so the lease has a balance to pay. The
    /// `invoice` helper above writes invoices only — the ledger in this file
    /// carries payments, so without this a returned payment nets to zero and
    /// there is correctly nothing to offer.
    async function charge(amountCents: number) {
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: "charge",
          amountCents,
          description: "Rent",
        },
      });
    }

    it("names the fee that was charged and offers the balance to pay", async () => {
      await nsfFeeOf(3_000);
      await prisma.facility.update({
        where: { id: facilityId },
        data: { phone: "(512) 555-0199" },
      });
      await charge(12_900);
      const paymentId = await succeededPayment(12_900);
      await returnPayment(actorWith(), paymentId, {
        reasonCode: "insufficient_funds",
      });

      const rows = await portalPayments(tenantId);
      const row = rows.find((r) => r.paymentId === paymentId);
      expect(row?.returned).toBe(true);
      // The fee is on the ledger, so it is in what the pay route will collect —
      // and the tenant is told the figure, because a balance $30 larger than
      // the payment they are looking at otherwise has no explanation.
      expect(row?.return?.feeCents).toBe(3_000);
      expect(row?.return?.payableCents).toBe(12_900 + 3_000);
      expect(row?.return?.leaseId).toBe(leaseId);
      // The FACILITY's line, not the org one — the whole point of routing it
      // through `phoneFor` on the page.
      expect(row?.return?.facilityPhone).toBe("(512) 555-0199");
    });

    it("reports no fee when the return was waived", async () => {
      await nsfFeeOf(3_000);
      await charge(12_900);
      const paymentId = await succeededPayment(12_900);
      await returnPayment(actorWith(), paymentId, {
        reasonCode: "bank_error",
        waiveFee: true,
      });

      const rows = await portalPayments(tenantId);
      const row = rows.find((r) => r.paymentId === paymentId);
      // Zero, not "the facility's configured amount" — the tenant is not shown
      // a charge nobody made.
      expect(row?.return?.feeCents).toBe(0);
      expect(row?.return?.payableCents).toBe(12_900);
    });

    it("offers nothing to pay when the return left the lease settled", async () => {
      // No charge on the ledger, so the reversal nets the lease to zero. The
      // page falls back to the facility's phone rather than linking at a pay
      // screen that would answer "we couldn't find that unit".
      const paymentId = await succeededPayment(12_900);
      await returnPayment(actorWith(), paymentId, {
        reasonCode: "stop_payment",
      });

      const rows = await portalPayments(tenantId);
      const row = rows.find((r) => r.paymentId === paymentId);
      expect(row?.returned).toBe(true);
      expect(row?.return?.payableCents).toBeNull();
    });

    it("carries no return context on an ordinary payment", async () => {
      await charge(12_900);
      const paymentId = await succeededPayment(12_900);

      const rows = await portalPayments(tenantId);
      const row = rows.find((r) => r.paymentId === paymentId);
      expect(row?.returned).toBe(false);
      expect(row?.return).toBeNull();
    });
  });
});
