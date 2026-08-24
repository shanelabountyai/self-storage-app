// PRD 02 §4.4 US-14 (B-162, D-93). What rate a transfer opens the new lease at.
//
// Pure and separated for the same reason the rate-increase rules are: this
// decides whether somebody's rent goes up, and it should be checkable across
// every combination of policy, direction and missing rate without a database.
//
// ── Why the default is not `street` ─────────────────────────────────────────
//
// `street` is what shipped, and on a like-for-like move between two 10×10s it
// is a rent increase — served with no notice period, no approval and no
// `TenantRateIncrease` record, through a screen whose whole purpose is a
// service request the tenant asked for. Every protection US-11 puts around
// raising a rent is bypassed by moving the tenant sideways.
//
// `in_place` avoids that and prices a downsize absurdly: a tenant paying
// 10×20 money keeps paying it for a 5×10, which can be more than that unit's
// street rate.
//
// `preserve_discount` is the only one that is right in all three directions,
// because it carries the thing the tenant actually holds — their position
// relative to street — rather than a dollar figure that only means anything
// against the unit they are leaving.

export type TransferRatePolicy = 'preserve_discount' | 'street' | 'in_place'

export type TransferRateInput = {
  policy: TransferRatePolicy
  /// What the tenant pays today, on the unit they are leaving.
  inPlaceRateCents: number
  /// The published street rate for the unit type they are leaving, as of the
  /// transfer date. Null when that type has no published rate — which happens
  /// on a legacy unit type nobody prices any more.
  fromStreetRateCents: number | null
  /// The published street rate for the unit type they are moving into.
  toStreetRateCents: number
}

/// The rate the new lease opens at, before any staff override.
///
/// Rounded to whole cents (money is integer cents everywhere here) and never
/// above the new unit type's street rate: a tenant paying ABOVE street on the
/// old unit — which happens when the market softens after an increase — must
/// not carry that premium onto a unit nobody else pays it for.
export function transferRateFor(input: TransferRateInput): number {
  const { policy, inPlaceRateCents, fromStreetRateCents, toStreetRateCents } = input

  if (policy === 'street') return toStreetRateCents
  if (policy === 'in_place') return inPlaceRateCents

  // `preserve_discount`. With no published rate on the unit they are leaving
  // there is no discount to measure, so there is nothing to preserve and the
  // street rate is the honest answer — NOT the in-place rate, which would let
  // a de-priced legacy unit type freeze a rate for ever.
  if (fromStreetRateCents === null || fromStreetRateCents <= 0) return toStreetRateCents

  const scaled = Math.round((toStreetRateCents * inPlaceRateCents) / fromStreetRateCents)
  return Math.min(scaled, toStreetRateCents)
}

/// Whether this transfer raises what the tenant pays.
///
/// Used to say so on the preview rather than to refuse: an upsize legitimately
/// costs more, and the figure staff confirm should state which way it moved.
export function isRateRise(currentRateCents: number, newRateCents: number): boolean {
  return newRateCents > currentRateCents
}
