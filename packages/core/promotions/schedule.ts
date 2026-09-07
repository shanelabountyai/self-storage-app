// PRD 04 FR-PROMO-1/3 (B-070). What a promotion is worth, period by period.
//
// The output is a SCHEDULE, not a single number, because every promo type here
// is "N periods of something" — "first month free", "50% off for three months".
// US-12 AC2 calls it "a structured discount instruction (promo ID, schedule of
// discounted periods)" and that is exactly the shape billing needs: the nightly
// invoice run asks "what comes off period 3", and a lump sum could not answer.
//
// Pure. This decides how much money a real person is not charged, and every
// number it produces is checkable by hand.

export type PromotionType = "percent_off" | "amount_off" | "free_months";

export type PromotionTerms = {
  type: PromotionType;
  /// Percent (1–100) for `percent_off`, cents for `amount_off`, ignored for
  /// `free_months` — where the count of free periods IS `durationPeriods`.
  value: number;
  durationPeriods: number;
};

export type DiscountPeriod = {
  /// 0 is the first billed period — the one bought at move-in.
  periodIndex: number;
  /// Cents off that period's rent. Never more than the rent itself.
  amountCents: number;
};

export type DiscountSchedule = {
  periods: DiscountPeriod[];
  totalCents: number;
};

/// The schedule for one promotion against one monthly rate.
///
/// Computed from the rate rather than stored as a rate-independent rule,
/// because a percentage of a rent that later changes would silently change what
/// was promised. The schedule is snapshotted at redemption (FR-PROMO-4) for
/// exactly that reason.
export function discountSchedule(
  terms: PromotionTerms,
  monthlyRateCents: number,
): DiscountSchedule {
  const periods: DiscountPeriod[] = [];
  const count = Math.max(0, Math.floor(terms.durationPeriods));

  for (let periodIndex = 0; periodIndex < count; periodIndex += 1) {
    const amountCents = amountForPeriod(terms, monthlyRateCents);
    if (amountCents > 0) periods.push({ periodIndex, amountCents });
  }

  return {
    periods,
    totalCents: periods.reduce((sum, period) => sum + period.amountCents, 0),
  };
}

function amountForPeriod(
  terms: PromotionTerms,
  monthlyRateCents: number,
): number {
  switch (terms.type) {
    case "free_months":
      // "First month free" is modelled as 100% off month 1 — FR-PROMO-1's own
      // wording — so the free period is the whole rent and nothing more. A
      // discount larger than the rent would turn into a credit, and a promo
      // that pays a tenant is not a promo.
      return monthlyRateCents;

    case "percent_off": {
      const percent = Math.min(100, Math.max(0, terms.value));
      // Rounded half-up on the discount itself, so rent minus discount is a
      // whole number of cents and the invoice adds up without a remainder line.
      return Math.min(
        monthlyRateCents,
        Math.round((monthlyRateCents * percent) / 100),
      );
    }

    case "amount_off":
      // Capped at the rent. A $50-off promo on a $39 unit is $39 off, not $50
      // off and $11 owed to the tenant.
      return Math.min(monthlyRateCents, Math.max(0, terms.value));

    default:
      return 0;
  }
}

/// What comes off a given billing period. The question the nightly invoice run
/// asks, answered from a stored schedule.
export function discountForPeriod(
  schedule: DiscountSchedule,
  periodIndex: number,
): number {
  return (
    schedule.periods.find((period) => period.periodIndex === periodIndex)
      ?.amountCents ?? 0
  );
}

/// US-12 AC1's "plain-language terms" — the FACTS a sentence is built from,
/// never the sentence.
///
/// B-269. `describeTerms` and `withMinStay` lived here and returned English
/// prose, so «Código aplicado: 50% off the first month» is what a Spanish
/// renter read on every unit card, in the checkout summary and on the
/// applied-code confirmation. This package is pure and has no request to read
/// a locale from — the same reason `judgeStartDate` (B-263) and
/// `describeCodeOutcome` (B-266) moved out of one. It returns the discriminant
/// and the numbers; `apps/web/lib/promotions/terms.tsx` writes the words.
///
/// **The two halves stay distinguishable, and that is the whole shape.** The
/// generated half can become a key plus its numbers. `termsText` cannot — it
/// is an operator's free text in a database column, with no key to return for
/// it — so it keeps its own variant and is rendered as typed (D-129). Folding
/// them into one string is how an operator's own wording gets silently
/// replaced by a translation of a different sentence.
export type OfferTerms = { minStayMonths: number } & (
  /// The operator wrote their own wording, and it WINS over the generated
  /// sentence.
  | { kind: "operator"; text: string }
  | { kind: "free_months"; periods: number }
  | { kind: "percent_off"; percent: number; periods: number }
  /// Already capped at the rent it describes: a badge saying "$500 off" on a
  /// $129 unit is a promise the invoice cannot keep.
  | { kind: "amount_off"; amountCents: number; periods: number }
);

/// Generated rather than typed per promo, because a badge that says something
/// different from what the invoice does is worse than no badge — and an
/// operator writing "first month free!" on a 50%-off promo is the ordinary way
/// that happens. An operator can still override with their own wording; the
/// generated variants are what get used when they do not.
///
/// `minStayMonths` sits on EVERY variant rather than being appended to a
/// finished string (B-144's `withMinStay`, folded in here). A minimum stay is a
/// term the renter is held to — B-145 charges money on it — so an override must
/// not be able to drop it, and now the type is what guarantees that rather than
/// the discipline of remembering to call a second function.
export function offerTerms(
  promotion: PromotionTerms & {
    termsText?: string | null;
    minStayMonths?: number;
  },
  monthlyRateCents?: number,
): OfferTerms {
  const minStayMonths = Math.max(0, Math.floor(promotion.minStayMonths ?? 0));
  const text = promotion.termsText?.trim();
  if (text) return { kind: "operator", text, minStayMonths };

  const periods = Math.max(1, Math.floor(promotion.durationPeriods));
  switch (promotion.type) {
    case "free_months":
      return { kind: "free_months", periods, minStayMonths };
    case "percent_off":
      return {
        kind: "percent_off",
        percent: Math.min(100, promotion.value),
        periods,
        minStayMonths,
      };
    case "amount_off":
      return {
        kind: "amount_off",
        amountCents:
          monthlyRateCents === undefined
            ? promotion.value
            : Math.min(promotion.value, monthlyRateCents),
        periods,
        minStayMonths,
      };
  }
}
