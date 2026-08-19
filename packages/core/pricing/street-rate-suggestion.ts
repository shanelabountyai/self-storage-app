// PRD 02 US-12 (B-088 part 1). "Rules-based revenue management: automatic
// street-rate suggestions from occupancy per unit type (e.g., raise when type
// occupancy > 92%), one-click apply."
//
// Pure, and beside `rate-increase.ts` on purpose: that file holds the rules for
// raising an EXISTING tenant, this one holds the rule for the rate a NEW tenant
// is quoted. They are different prices with different consequences and the two
// must never be confused — nothing here reads or writes `Lease.monthlyRateCents`.

/// A suggestion needs enough units for occupancy to mean anything.
///
/// Three units at 100% is one vacancy away from 67% and is not a signal; it is
/// the smallest sample that can look like one. Five is a floor rather than a
/// finding — with no observed usage to tune against (the same position D-73
/// took for the frequency flag), it is set where a single move-out can no
/// longer swing the answer across a threshold.
export const MIN_UNITS_FOR_SUGGESTION = 5

/// How long a rate must have been on sale before this proposes moving it again.
///
/// **This is the most important rule in the file, and it exists because
/// "one-click apply" invites the failure it prevents.** Occupancy does not fall
/// the day a rate rises — the tight type stays tight for weeks — so a rule that
/// re-suggests on every visit would have an operator applying +8% weekly and
/// ratcheting a price up 50% in a quarter, each click individually reasonable.
/// The suggestion is silent until the market has had a quarter to answer the
/// last one.
export const COOLDOWN_DAYS = 90

/// Street rates land on round money. $137.44 is a number a spreadsheet
/// produced; $138 is a price somebody set.
///
/// **A dollar, not five, and the difference is not cosmetic.** Rounding up to
/// the nearest $5 distorts the band more than the band itself: +4% on a $100
/// rate becomes $105, which is +5%, and on a $37 rate becomes $40, which is
/// +8% — double what the rule decided. The whole point of a ladder is that the
/// operator can reason about the step, so the rounding must not silently
/// rewrite it. At $1 the distortion is at most 99 cents on any rate.
export const ROUNDING_CENTS = 100

export type SuggestionRule = {
  /// Occupancy at or above this suggests the paired increase. Highest first.
  readonly bands: readonly { readonly minRatio: number; readonly increase: number }[]
}

/// The ladder. US-12's own example is "raise when type occupancy > 92%"; this
/// is that with one step above it, because 99% and 93% are not the same market
/// and a single threshold prices them identically.
///
/// **It only ever suggests increases (D-74).** A soft type gets no suggestion
/// and a pointer to promotions, rather than a proposed cut.
export const DEFAULT_SUGGESTION_RULE: SuggestionRule = {
  bands: [
    { minRatio: 0.95, increase: 0.08 },
    { minRatio: 0.92, increase: 0.04 },
  ],
}

export type SuggestionInput = {
  unitTypeId: string
  /// From the metrics module's `occupancy()`, never recomputed here.
  occupiedCount: number
  rentableCount: number
  occupancyRatio: number
  streetRateCents: number
  webRateCents: number
  /// Whole days since the current street rate took effect. Null when the type
  /// has never had a rate published.
  daysSinceRateChange: number | null
  /// True when a rate row is already queued with a future effective date.
  ///
  /// `/admin/units/types` lets an operator schedule one, and a suggestion on
  /// top of a queued change is a double application: they apply this, the
  /// scheduled row lands next week, and the price has moved twice for one
  /// decision. The person has already answered this question.
  hasScheduledChange: boolean
}

export type SuggestionReason =
  | 'no_rate'
  | 'too_few_units'
  | 'change_scheduled'
  | 'cooling_off'
  | 'demand_is_soft'
  | 'raise'

export type Suggestion = {
  unitTypeId: string
  reason: SuggestionReason
  /// Present only when `reason` is `raise`.
  suggestedStreetRateCents: number | null
  suggestedWebRateCents: number | null
  /// The band that fired, as a ratio (0.08 = +8%).
  increase: number | null
}

/// Rounds UP to the nearest `ROUNDING_CENTS`, never down.
///
/// Up rather than nearest so a suggested increase is always at least the band
/// it came from: rounding 4% on a $103 rate to the nearest $5 would land back
/// on $105 — fine — but on a $101 rate it would round $105.04 down to $105 and
/// on smaller rates could round a raise back to where it started, producing a
/// "suggestion" that changes nothing.
function roundUpTo(cents: number, step: number): number {
  return Math.ceil(cents / step) * step
}

/// The whole rule, per unit type.
///
/// Order matters and is the order an operator would ask the questions in: is
/// there a price at all, is there enough inventory for the number to mean
/// something, has the last change had time to work, and only then is demand
/// telling us anything.
export function suggestStreetRate(
  input: SuggestionInput,
  rule: SuggestionRule = DEFAULT_SUGGESTION_RULE,
  options: { minUnits?: number; cooldownDays?: number } = {},
): Suggestion {
  const none = (reason: SuggestionReason): Suggestion => ({
    unitTypeId: input.unitTypeId,
    reason,
    suggestedStreetRateCents: null,
    suggestedWebRateCents: null,
    increase: null,
  })

  // A type with no published rate needs a price set, not a percentage applied
  // to nothing. `currentRatesForFacility` already omits these rather than
  // defaulting to zero, and this is the same refusal one layer up.
  if (input.streetRateCents <= 0) return none('no_rate')

  if (input.rentableCount < (options.minUnits ?? MIN_UNITS_FOR_SUGGESTION)) {
    return none('too_few_units')
  }

  // Ahead of the cooldown, because it is a different sentence to a reader: not
  // "wait and see" but "you have already decided this one".
  if (input.hasScheduledChange) return none('change_scheduled')

  // A rate that has never been published has no cooldown to serve — but it
  // also cannot reach here, because `streetRateCents > 0` implies a row.
  // Null is therefore "unknown", and unknown waits rather than fires: the same
  // posture `isEligibleForIncrease` takes for a lease with no known history.
  if (input.daysSinceRateChange === null) return none('cooling_off')
  if (input.daysSinceRateChange < (options.cooldownDays ?? COOLDOWN_DAYS)) {
    return none('cooling_off')
  }

  const band = rule.bands.find((candidate) => input.occupancyRatio >= candidate.minRatio)
  if (!band) return none('demand_is_soft')

  const suggestedStreetRateCents = roundUpTo(
    Math.round(input.streetRateCents * (1 + band.increase)),
    ROUNDING_CENTS,
  )

  // The web rate moves by the SAME PROPORTION rather than to the same number,
  // so whatever discount the operator chose to offer online survives the
  // increase. Setting both to the street rate would silently retire the online
  // discount, which is a pricing decision nobody made.
  const suggestedWebRateCents =
    input.webRateCents > 0
      ? roundUpTo(
          Math.round(input.webRateCents * (suggestedStreetRateCents / input.streetRateCents)),
          ROUNDING_CENTS,
        )
      : suggestedStreetRateCents

  // Rounding up can only ever raise, so this cannot produce a no-op — but it is
  // asserted rather than assumed, because a rule that "suggests" the current
  // price is worse than one that stays quiet.
  if (suggestedStreetRateCents <= input.streetRateCents) return none('demand_is_soft')

  return {
    unitTypeId: input.unitTypeId,
    reason: 'raise',
    suggestedStreetRateCents,
    suggestedWebRateCents,
    increase: band.increase,
  }
}

/// What applying every `raise` suggestion would add to monthly revenue at
/// today's occupancy — the figure an owner is actually deciding on.
///
/// **Occupied units only, and that is the honest half.** A raise applies to the
/// rate a NEW tenant is quoted, so it earns nothing until a unit turns over;
/// counting vacant units would promise revenue that arrives only when they
/// rent. This is therefore the ceiling on what the change is worth per month
/// once the existing tenants have cycled — which is what the screen has to say
/// rather than let a reader assume it is next month's money.
export function projectedMonthlyUpliftCents(
  rows: readonly { occupiedCount: number; streetRateCents: number; suggestion: Suggestion }[],
): number {
  return rows.reduce((total, row) => {
    if (row.suggestion.reason !== 'raise' || row.suggestion.suggestedStreetRateCents === null) {
      return total
    }
    return total + (row.suggestion.suggestedStreetRateCents - row.streetRateCents) * row.occupiedCount
  }, 0)
}
