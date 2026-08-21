import { prisma, type Prisma } from "@storage/db";
import {
  describeCodeOutcome,
  evaluatePromotions,
  type CodeOutcome,
  type EligibilityResult,
  type PromotionCandidate,
} from "@storage/core/promotions";

// PRD 04 §3.6 FR-PROMO-3/4/5, PRD 02 US-10 (B-070). The database half of the
// promotions engine.
//
// The split is deliberate and it is the PRD's own: "marketing owns definition,
// display, eligibility, and redemption tracking; billing owns money." Nothing
// in this file writes an invoice line. It produces a snapshotted schedule that
// billing later reads.

/// Loads every promotion that could possibly apply, for the pure evaluator.
///
/// Deliberately broad — status and window are checked in core, not here — so
/// there is exactly one place that decides eligibility. A `where` clause that
/// pre-filtered by date would be a second, invisible rule that disagrees with
/// the first the moment somebody changes one of them.
async function candidates(
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const promotions = await client.promotion.findMany({
    where: { status: { in: ["active"] } },
    include: {
      codes: {
        select: {
          id: true,
          code: true,
          expiresAt: true,
          maxUses: true,
          usesCount: true,
        },
      },
    },
  });

  const now = new Date();
  return promotions.map<
    PromotionCandidate & { codeRows: (typeof promotions)[number]["codes"] }
  >((promotion) => ({
    id: promotion.id,
    name: promotion.name,
    type: promotion.type,
    value: promotion.value,
    durationPeriods: promotion.durationPeriods,
    status: promotion.status,
    displayMode: promotion.displayMode,
    facilityIds: promotion.facilityIds,
    unitTypeIds: promotion.unitTypeIds,
    newTenantOnly: promotion.newTenantOnly,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    maxRedemptions: promotion.maxRedemptions,
    redemptionCount: promotion.redemptionCount,
    termsText: promotion.termsText,
    minStayMonths: promotion.minStayMonths,
    // A code that has expired or hit its own cap is not usable, so it never
    // reaches the evaluator — which keeps "why did my code not work" a
    // question about the promo rather than about two overlapping limits.
    codes: promotion.codes
      .filter((row) => !row.expiresAt || row.expiresAt > now)
      .filter((row) => row.maxUses === null || row.usesCount < row.maxUses)
      .map((row) => row.code),
    codeRows: promotion.codes,
  }));
}

export type PromoOffer = {
  promotionId: string;
  promoCodeId: string | null;
  name: string;
  terms: string;
  schedule: { periodIndex: number; amountCents: number }[];
  totalCents: number;
  /// What comes off the FIRST period — the number a unit card and the checkout
  /// total both need.
  firstPeriodCents: number;
};

export type PromoLookup = {
  offer: PromoOffer | null;
  /// Badges for a facility page: automatic promos only, since a code-gated one
  /// is invisible without its code.
  badges: { promotionId: string; terms: string }[];
  /// B-122. What became of a typed code — applied, superseded by a better offer
  /// already applying, or refused and by which rule. Null when none was typed.
  codeOutcome: CodeOutcome | null;
  /// The same thing as one sentence, for a field error or a live region.
  problem: string | null;
};

/// FR-PROMO-3's evaluator, against real rows.
export async function offerFor(input: {
  facilityId: string;
  unitTypeId: string;
  monthlyRateCents: number;
  isNewTenant: boolean;
  code?: string | null;
  client?: Prisma.TransactionClient | typeof prisma;
}): Promise<PromoLookup> {
  const rows = await candidates(input.client);
  const evaluation = evaluatePromotions(rows, {
    facilityId: input.facilityId,
    unitTypeId: input.unitTypeId,
    monthlyRateCents: input.monthlyRateCents,
    isNewTenant: input.isNewTenant,
    at: new Date(),
    code: input.code,
  });

  return {
    offer: evaluation.best ? toOffer(evaluation.best, rows) : null,
    badges: evaluation.automatic.map((result) => ({
      promotionId: result.promotion.id,
      terms: result.terms,
    })),
    codeOutcome: evaluation.codeOutcome,
    // Every outcome gets a sentence, including the two that are not failures —
    // `problem` keeps its name because every existing caller reads it that way,
    // but a code that APPLIED now says so too, and the surfaces decide whether
    // that reads as an error or as confirmation.
    problem: evaluation.codeOutcome
      ? describeCodeOutcome(evaluation.codeOutcome)
      : null,
  };
}

function toOffer(
  result: EligibilityResult,
  rows: Awaited<ReturnType<typeof candidates>>,
): PromoOffer {
  const row = rows.find((candidate) => candidate.id === result.promotion.id);
  const codeRow = result.code
    ? row?.codeRows.find(
        (one) => one.code.toLowerCase() === result.code!.toLowerCase(),
      )
    : null;

  return {
    promotionId: result.promotion.id,
    promoCodeId: codeRow?.id ?? null,
    name: result.promotion.name,
    terms: result.terms,
    schedule: result.schedule.periods,
    totalCents: result.schedule.totalCents,
    firstPeriodCents:
      result.schedule.periods.find((period) => period.periodIndex === 0)
        ?.amountCents ?? 0,
  };
}

export type RedeemResult =
  | { ok: true; redemptionId: string; totalCents: number }
  /// FR-PROMO-5's graceful fallback: "over-cap attempts fall back gracefully
  /// (reservation completes at standard rate with clear messaging before
  /// payment)." Not an error — the rental proceeds at full price.
  | { ok: false; reason: "cap_reached" | "not_available" };

/// FR-PROMO-4/5. Claims a redemption, atomically.
///
/// **The cap is enforced by a conditional UPDATE, not by a read followed by a
/// write.** Two prospects completing checkout in the same second against the
/// last remaining redemption both pass a `redemptionCount < maxRedemptions`
/// check and both proceed; only one can win an update whose WHERE clause
/// contains the same condition. The loser is told before payment, which is
/// exactly what FR-PROMO-5 asks for.
///
/// Runs inside the caller's transaction so the redemption, the counter and the
/// lease link commit together — a redemption row without its counter increment
/// is a promo that can be over-claimed forever.
export async function redeemPromotion(
  tx: Prisma.TransactionClient,
  input: {
    promotionId: string;
    promoCodeId: string | null;
    facilityId: string;
    reservationId?: string | null;
    leaseId?: string | null;
    schedule: { periodIndex: number; amountCents: number }[];
    totalCents: number;
  },
): Promise<RedeemResult> {
  // One statement. `redemptionCount < maxRedemptions` is a column-to-column
  // comparison, which Prisma's `where` cannot express — so this is raw SQL
  // rather than a read followed by a write. That difference IS the guarantee:
  // Postgres evaluates the WHERE against the row it locks, so of two
  // transactions racing for the last redemption exactly one updates a row and
  // the other updates none. A check-then-write would let both through.
  const claimed = await tx.$executeRaw`
    UPDATE "promotion"
    SET "redemptionCount" = "redemptionCount" + 1
    WHERE "id" = ${input.promotionId}
      AND "status" = 'active'
      AND ("maxRedemptions" IS NULL OR "redemptionCount" < "maxRedemptions")
  `;
  if (claimed === 0) return { ok: false, reason: "cap_reached" };

  if (input.promoCodeId) {
    // FR-PROMO-2's per-code cap, claimed the same way. A code can run out
    // while its promotion has redemptions left — a partner's allocation is
    // exhausted, the promo is not — so the two are separate claims.
    const codeClaimed = await tx.$executeRaw`
      UPDATE "promo_code"
      SET "usesCount" = "usesCount" + 1
      WHERE "id" = ${input.promoCodeId}
        AND ("maxUses" IS NULL OR "usesCount" < "maxUses")
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
    `;
    if (codeClaimed === 0) {
      // The promotion's counter was already incremented above. Giving it back
      // is safe here and only here: the caller's transaction wraps both, so a
      // reader outside it never observes the intermediate state.
      await tx.$executeRaw`
        UPDATE "promotion" SET "redemptionCount" = "redemptionCount" - 1 WHERE "id" = ${input.promotionId}
      `;
      return { ok: false, reason: "cap_reached" };
    }
  }

  const redemption = await tx.promoRedemption.create({
    data: {
      promotionId: input.promotionId,
      promoCodeId: input.promoCodeId,
      facilityId: input.facilityId,
      reservationId: input.reservationId ?? null,
      leaseId: input.leaseId ?? null,
      schedule: input.schedule as unknown as Prisma.InputJsonValue,
      totalCents: input.totalCents,
    },
  });

  return {
    ok: true,
    redemptionId: redemption.id,
    totalCents: input.totalCents,
  };
}
