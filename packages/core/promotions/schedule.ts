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

/// US-12 AC1's "plain-language terms".
///
/// Generated rather than typed per promo, because a badge that says something
/// different from what the invoice does is worse than no badge — and an
/// operator writing "first month free!" on a 50%-off promo is the ordinary way
/// that happens. An operator can still override with their own wording; this is
/// what gets used when they do not.
export function describeTerms(
  terms: PromotionTerms,
  monthlyRateCents?: number,
): string {
  const periods = Math.max(1, Math.floor(terms.durationPeriods));
  const months =
    periods === 1 ? "the first month" : `the first ${periods} months`;

  switch (terms.type) {
    case "free_months":
      return periods === 1
        ? "First month free"
        : `First ${periods} months free`;
    case "percent_off":
      return `${Math.min(100, terms.value)}% off ${months}`;
    case "amount_off": {
      const amount = formatCents(
        monthlyRateCents === undefined
          ? terms.value
          : Math.min(terms.value, monthlyRateCents),
      );
      return `${amount} off ${months}`;
    }
    default:
      return "";
  }
}

/// B-144. The minimum stay, appended to whatever wording the offer already
/// has.
///
/// Appended rather than folded into `describeTerms`, and that is the point:
/// `termsText` lets an operator write their own wording and it WINS over the
/// generated sentence, so a condition living only inside `describeTerms` would
/// vanish the moment somebody typed "First month free!" into the box. A minimum
/// stay is a term the renter is held to — B-145 charges money on it — so it is
/// not a thing an override may quietly drop.
///
/// `0` means no condition, which is the column's default and the ordinary case.
export function withMinStay(terms: string, minStayMonths: number): string {
  const months = Math.max(0, Math.floor(minStayMonths));
  if (months < 1 || terms === "") return terms;
  return `${terms} — ${months === 1 ? "1-month" : `${months}-month`} minimum stay`;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
