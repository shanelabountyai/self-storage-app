import { prisma } from "@storage/db";
import {
  billedByCategory,
  categoryTotal,
  collectedByCategory,
  emptyCategoryTotals,
  sumCategoryTotals,
  type CategoryTotals,
} from "@storage/core/metrics";
import { orderFor } from "@/lib/billing/allocation";
import { financialFacilities } from "@/lib/admin/reports";
import type { Actor } from "@/lib/rbac/actor";
import { REFERRAL_DISCOUNT_PREFIX } from "@/lib/referrals/billing";

// PRD 02 US-39.5 (B-055). Billed vs collected, by category.
//
// The two figures are on different bases on purpose, and the gap between them
// is the entire point of the report:
//
//   * **Billed** is what invoices ISSUED in the range charged. Accrual: the
//     money was asked for, whether or not it arrived.
//   * **Collected** is what payments RECEIVED in the range settled. Cash: the
//     money arrived, whatever period it was billed for.
//
// A facility whose collected trails its billed month after month is not having
// a bad month, it is accumulating AR — which is the same money US-39.4's aging
// report is looking at from the other end.
//
// Every definition comes from @storage/core/metrics; nothing is computed here
// except the queries that feed it (§4.11: no screen or export computes a
// metric inline).

export type RevenueRow = {
  facilityId: string;
  facilityName: string;
  billed: CategoryTotals;
  collected: CategoryTotals;
  /// US-39.5's "discounts/promos given" — invoice lines of type `discount` on
  /// invoices issued in the range. Positive cents: what was given away.
  discountsCents: number;
  /// PRD 10 §5.7 (B-101). The referral share of `discountsCents`, split out.
  ///
  /// "One is acquisition cost and the other is a price decision" — the row's
  /// own words, and the reason this is not a presentation detail. A promotion
  /// is the business choosing to advertise a lower price; a referral reward is
  /// what it paid a tenant for bringing somebody in, and that number is the one
  /// compared against the aggregator fee it displaces. Merged, neither
  /// question can be answered.
  referralRewardsCents: number;
  /// US-39.5's "write-offs" — ledger entries of type `write_off` in the range,
  /// as positive cents. Written off, not collected and no longer expected.
  writeOffsCents: number;
  /// Money received that is not sitting against any invoice: an overpayment
  /// held, or a payment taken before there was anything to apply it to. Never
  /// folded into a category, because guessing which one is how a figure stops
  /// reconciling against a tenant's ledger.
  unappliedCents: number;
  /// Refunds issued in the range. **Informational only** — a refund unwinds
  /// the original payment's allocation rows, so `collected` above is already
  /// net of it. Shown because "we collected $40k" reads differently when $6k
  /// of it went back out, and adding this to anything would double-count.
  refundsCents: number;
};

export type RevenueReport = {
  rows: RevenueRow[];
  total: RevenueRow;
};

function emptyRow(facilityId: string, facilityName: string): RevenueRow {
  return {
    facilityId,
    facilityName,
    billed: emptyCategoryTotals(),
    collected: emptyCategoryTotals(),
    discountsCents: 0,
    referralRewardsCents: 0,
    writeOffsCents: 0,
    unappliedCents: 0,
    refundsCents: 0,
  };
}

/// The four categories plus the standalone lines, per facility and rolled up.
///
/// `start` inclusive, `end` exclusive — the same half-open convention the
/// billing periods use, so two consecutive months tile with no day counted
/// twice and none skipped.
export async function revenueReport(
  actor: Actor,
  start: Date,
  end: Date,
): Promise<RevenueReport> {
  const facilities = await financialFacilities(actor);

  const rows = await Promise.all(
    facilities.map((facility) =>
      facilityRevenue(facility.id, facility.name, start, end),
    ),
  );

  return { rows, total: sumRevenueRows(rows) };
}

/// One facility's revenue. Exported for B-084 part 3's scheduled emails, which
/// report on a facility a permitted staff member already subscribed — the job
/// itself has no actor to scope by, and inventing one would mean either a fake
/// staff identity or a superuser system actor.
export async function facilityRevenue(
  facilityId: string,
  facilityName: string,
  start: Date,
  end: Date,
): Promise<RevenueRow> {
  const row = emptyRow(facilityId, facilityName);

  const settings = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { paymentAllocationOrder: true },
  });
  const order = orderFor(settings.paymentAllocationOrder);

  // ── Billed ──────────────────────────────────────────────────────────
  // Void invoices are excluded: an invoice that was voided was never a real
  // charge, and leaving it in would report revenue that was withdrawn.
  const issued = await prisma.invoice.findMany({
    where: {
      facilityId,
      status: { not: "void" },
      issueDate: { gte: start, lt: end },
    },
    // `description` too (B-101): it is what tells a referral reward from a
    // promotional discount, since both are the same line TYPE.
    select: {
      lineItems: {
        select: { type: true, amountCents: true, description: true },
      },
    },
  });
  row.billed = sumCategoryTotals(
    issued.map((invoice) => billedByCategory(invoice.lineItems)),
  );
  const discountLines = issued
    .flatMap((invoice) => invoice.lineItems)
    .filter((line) => line.type === "discount");
  row.discountsCents = discountLines.reduce(
    (sum, line) => sum + line.amountCents,
    0,
  );
  // Identified by the description the referral hand-off writes
  // (`lib/referrals/billing.ts`), which is the only thing distinguishing the
  // two on an invoice line — they are deliberately the same line TYPE, because
  // to billing they are the same thing: money off. The split is a reporting
  // question, not a billing one, so it lives here rather than as a second
  // line-item type nothing else would use.
  row.referralRewardsCents = discountLines
    .filter((line) => line.description.startsWith(REFERRAL_DISCOUNT_PREFIX))
    .reduce((sum, line) => sum + line.amountCents, 0);

  // ── Collected ───────────────────────────────────────────────────────
  //
  // Every allocation against every invoice this facility has touched in the
  // range — INCLUDING allocations from outside it. The out-of-range ones are
  // not counted, but they are needed: an invoice paid $10 in March and $90 in
  // April has categories settled in the facility's order, so April's share is
  // `split($100) − split($10)` and cannot be worked out from April alone.
  const paidInvoiceIds = (
    await prisma.paymentAllocation.findMany({
      where: {
        payment: { facilityId, receivedAt: { gte: start, lt: end } },
        amountCents: { gt: 0 },
      },
      select: { invoiceId: true },
      distinct: ["invoiceId"],
    })
  ).map((allocation) => allocation.invoiceId);

  if (paidInvoiceIds.length > 0) {
    const invoices = await prisma.invoice.findMany({
      where: { id: { in: paidInvoiceIds } },
      select: {
        id: true,
        lineItems: { select: { type: true, amountCents: true } },
        allocations: {
          where: { amountCents: { gt: 0 } },
          select: {
            id: true,
            amountCents: true,
            payment: { select: { receivedAt: true } },
          },
        },
      },
    });

    const collected: CategoryTotals[] = [];
    for (const invoice of invoices) {
      const gross = billedByCategory(invoice.lineItems);
      // Oldest payment first, then by id so two payments on the same instant
      // split the same way on every run — a report that reorders between two
      // refreshes is one nobody can reconcile.
      const ordered = [...invoice.allocations].sort((a, b) => {
        const byTime =
          a.payment.receivedAt.getTime() - b.payment.receivedAt.getTime();
        return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
      });

      let cumulative = 0;
      for (const allocation of ordered) {
        const before = collectedByCategory(gross, cumulative, order);
        cumulative += allocation.amountCents;
        const after = collectedByCategory(gross, cumulative, order);
        const inRange =
          allocation.payment.receivedAt >= start &&
          allocation.payment.receivedAt < end;
        if (!inRange) continue;
        const delta = emptyCategoryTotals();
        for (const category of Object.keys(delta) as (keyof CategoryTotals)[]) {
          delta[category] = after[category] - before[category];
        }
        collected.push(delta);
      }
    }
    row.collected = sumCategoryTotals(collected);
  }

  // ── The standalone lines ────────────────────────────────────────────
  const payments = await prisma.payment.findMany({
    where: {
      facilityId,
      receivedAt: { gte: start, lt: end },
      // B-146: `returned` deliberately ABSENT, unlike the drawer and deposit
      // queries. Those answer "what was in the till"; this one answers "what
      // did we collect", and money the bank took back was not collected. D-25's
      // economic occupancy is collected ÷ gross potential, so counting a
      // bounced cheque here would overstate it.
      status: { in: ["succeeded", "partially_refunded", "refunded"] },
    },
    select: {
      amountCents: true,
      refundOfPaymentId: true,
      allocations: { select: { amountCents: true } },
      refunds: { select: { amountCents: true, status: true } },
    },
  });

  for (const payment of payments) {
    if (payment.refundOfPaymentId) {
      row.refundsCents += payment.amountCents;
      continue;
    }
    const allocated = payment.allocations.reduce(
      (sum, one) => sum + one.amountCents,
      0,
    );
    const refunded = payment.refunds
      .filter((refund) => refund.status !== "failed")
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    // What we took, less what is sitting against an invoice, less what went
    // back out. Floored at zero: a refund can outpace the unwinding within a
    // rounding of each other, and a negative "unapplied" would be nonsense on
    // a screen.
    row.unappliedCents += Math.max(
      0,
      payment.amountCents - allocated - refunded,
    );
  }

  const writeOffs = await prisma.ledgerEntry.aggregate({
    where: {
      facilityId,
      type: "write_off",
      occurredAt: { gte: start, lt: end },
    },
    _sum: { amountCents: true },
  });
  // Write-offs are stored as negative cents (they reduce the balance). Reported
  // positive, because "wrote off $400" is the sentence an owner reads.
  row.writeOffsCents = Math.abs(writeOffs._sum.amountCents ?? 0);

  return row;
}

/// US-39's roll-up rule: the total is the sum of the facility rows, with no
/// double counting. Asserted in a test, not just stated here.
export function sumRevenueRows(rows: readonly RevenueRow[]): RevenueRow {
  const total = emptyRow("", "All facilities");
  total.billed = sumCategoryTotals(rows.map((row) => row.billed));
  total.collected = sumCategoryTotals(rows.map((row) => row.collected));
  for (const row of rows) {
    total.discountsCents += row.discountsCents;
    total.referralRewardsCents += row.referralRewardsCents;
    total.writeOffsCents += row.writeOffsCents;
    total.unappliedCents += row.unappliedCents;
    total.refundsCents += row.refundsCents;
  }
  return total;
}

export function billedTotal(row: RevenueRow): number {
  return categoryTotal(row.billed);
}

/// Collected across every category PLUS the money that has not landed on an
/// invoice — the honest answer to "how much came in", which is not the same as
/// the sum of the four columns.
export function collectedTotal(row: RevenueRow): number {
  return categoryTotal(row.collected) + row.unappliedCents;
}
