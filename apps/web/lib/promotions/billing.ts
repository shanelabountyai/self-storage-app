import { prisma, type Prisma } from "@storage/db";
import {
  discountForPeriod,
  monthsServed,
  recaptureFor,
  type DiscountPeriod,
  type Recapture,
} from "@storage/core/promotions";

/// The answer for every lease that carried no promotion, every facility whose
/// policy is `none`, and every tenant who served their term — which is nearly
/// all of them, so it is named rather than rebuilt at four return sites.
const NO_RECAPTURE: Recapture = {
  amountCents: 0,
  monthsRemaining: 0,
  reason: null,
};

// PRD 04 US-12 AC2 / FR-PROMO-4 (B-070). The billing side of the hand-off.
//
// "Billing owns applying it to invoices." Marketing decided what the discount
// is and snapshotted the schedule at redemption; this reads that snapshot and
// answers one question for the nightly invoice run: what comes off THIS period.

export type PeriodDiscount = {
  redemptionId: string;
  amountCents: number;
  description: string;
  periodIndex: number;
};

/// What comes off a lease's invoice for the period starting `periodStart`.
///
/// The period index is counted from the redemption's own first billed period,
/// not from the lease start. They are usually the same; they are not when a
/// promo is attached to a lease that already had an invoice, and counting from
/// the lease would then silently discount the wrong month.
export async function discountForLeasePeriod(
  leaseId: string,
  periodIndex: number,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PeriodDiscount | null> {
  const redemption = await client.promoRedemption.findUnique({
    where: { leaseId },
    select: {
      id: true,
      schedule: true,
      appliedPeriods: true,
      promotion: { select: { name: true, termsText: true } },
    },
  });
  if (!redemption) return null;

  // Already discounted. `appliedPeriods` is what makes the nightly run
  // re-runnable (FR-4) without paying a promotion twice — the catch-up path
  // regenerates missed dates, and without this a caught-up week would apply the
  // first month's discount seven times.
  if (redemption.appliedPeriods.includes(periodIndex)) return null;

  // `PromoRedemption.schedule` stores the PERIODS ARRAY, not the whole
  // `DiscountSchedule` object — the total has its own column, so wrapping it
  // would store the same number twice and give them a chance to disagree.
  // Named here rather than cast loosely, because reading an array as an object
  // silently yields `undefined.periods` and a discount of zero, which is the
  // shape of a promotion that quietly never applies.
  const periods = (redemption.schedule ?? []) as unknown as DiscountPeriod[];
  const amountCents = Array.isArray(periods)
    ? discountForPeriod({ periods, totalCents: 0 }, periodIndex)
    : 0;
  if (amountCents <= 0) return null;

  return {
    redemptionId: redemption.id,
    amountCents,
    description:
      redemption.promotion.termsText?.trim() || redemption.promotion.name,
    periodIndex,
  };
}

/// Records that a period's discount has been written onto an invoice.
///
/// Called inside the same transaction as the invoice, so a rolled-back invoice
/// does not leave a promotion looking spent.
export async function markDiscountApplied(
  tx: Prisma.TransactionClient,
  redemptionId: string,
  periodIndex: number,
): Promise<void> {
  await tx.promoRedemption.update({
    where: { id: redemptionId },
    data: { appliedPeriods: { push: periodIndex } },
  });
}

/// PRD 02 US-10 (B-145). The recapture owed on a lease that is ending.
///
/// Three rows decide it and this is the only place that reads all three: the
/// redemption (what discount was actually applied), the promotion (the minimum
/// stay it was given under), and the facility (the policy — `none` by default,
/// so most facilities never get past the first branch).
///
/// **The amount given is summed from `appliedPeriods`, not from `totalCents`.**
/// A six-month promo on a tenant who leaves in month two has PROMISED six
/// periods and DELIVERED two, and `totalCents` is the promise. Billing the
/// promise back would invent money nobody ever saved — the same distinction
/// `discountForLeasePeriod` already relies on to stay re-runnable.
export async function recaptureForLease(
  lease: { id: string; startDate: Date; facilityId: string },
  moveOutDate: Date,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Recapture> {
  const facility = await client.facility.findUniqueOrThrow({
    where: { id: lease.facilityId },
    select: { promoRecapturePolicy: true },
  });
  if (facility.promoRecapturePolicy === "none") return NO_RECAPTURE;

  const redemption = await client.promoRedemption.findUnique({
    where: { leaseId: lease.id },
    select: {
      schedule: true,
      appliedPeriods: true,
      promotion: { select: { minStayMonths: true } },
    },
  });
  if (!redemption || redemption.promotion.minStayMonths < 1)
    return NO_RECAPTURE;

  const periods = (redemption.schedule ?? []) as unknown as DiscountPeriod[];
  const discountGivenCents = Array.isArray(periods)
    ? periods
        .filter((period) =>
          redemption.appliedPeriods.includes(period.periodIndex),
        )
        .reduce((sum, period) => sum + period.amountCents, 0)
    : 0;

  return recaptureFor({
    policy: facility.promoRecapturePolicy,
    discountGivenCents,
    minStayMonths: redemption.promotion.minStayMonths,
    monthsServed: monthsServed(lease.startDate, moveOutDate),
  });
}
