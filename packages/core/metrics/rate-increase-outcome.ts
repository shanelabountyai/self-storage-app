// PRD 02 US-39 "AC (a rate increase is measured after it lands)" — B-400.
//
// Nothing read `TenantRateIncrease` once it applied, so D-94's default step
// could be neither tuned nor defended. This is the outcome of an applied
// increase: who left, who was given money back to stay, and what the
// increase is worth net of both.

import type { MoveOutCauseKey } from './moves.ts'

export const OUTCOME_WINDOWS = [30, 60, 90] as const
export type OutcomeWindow = (typeof OUTCOME_WINDOWS)[number]

const DAY_MS = 24 * 60 * 60 * 1000

/// One applied increase, as this metric needs to see it. Every date is a
/// facility-local calendar day at UTC midnight — the kind `effectiveDate`,
/// `moveOutDate` and `businessDateFor` already are — so a day count is a
/// subtraction and no timezone is needed here.
export type AppliedIncrease = {
  /// The in-place rate the increase was applied to (`currentRateCents`).
  inPlaceCents: number
  newRateCents: number
  effectiveDate: Date
  /// The lease's move-out, if it has ended. Only one on or after the
  /// effective date counts.
  moveOut: { date: Date; cause: MoveOutCauseKey } | null
  /// Applied B-153 retention saves on the same lease, as monthly reductions.
  retentionCuts: readonly { effectiveDate: Date; reductionCents: number }[]
}

export type WindowOutcome = {
  /// Increases whose window has fully elapsed. Zero means "not yet" — the
  /// caller renders it that way, never as a zero move-out count.
  measured: number
  movedOut: number
  /// Of `movedOut`, those whose recorded cause is `price_or_rate_increase`.
  movedOutForPrice: number
}

export type RateIncreaseOutcome = {
  count: number
  /// Σ(new − in-place). Averages are derived (`averageIncreaseCents`,
  /// `averageIncreasePercent`) so a roll-up can sum these and recompute (D-25).
  increaseCents: number
  inPlaceCents: number
  windows: Record<OutcomeWindow, WindowOutcome>
  /// Over the increases measured at 90 days (`windows[90].measured`).
  /// Leases given a retention cut within 90 days of the increase.
  retentionCutLeases: number
  /// Monthly cents those cuts gave back.
  retentionCutCents: number
  /// Net monthly revenue change over the same 90-day-measured increases:
  /// Σ(increase on leases still occupying, less any retention cut on them)
  /// − Σ(in-place rate of leases that moved out inside 90 days).
  keptIncreaseCents: number
  lostRentCents: number
  netMonthlyCents: number
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

function emptyWindows(): Record<OutcomeWindow, WindowOutcome> {
  return { 30: emptyWindow(), 60: emptyWindow(), 90: emptyWindow() }
}

function emptyWindow(): WindowOutcome {
  return { measured: 0, movedOut: 0, movedOutForPrice: 0 }
}

export function emptyRateIncreaseOutcome(): RateIncreaseOutcome {
  return {
    count: 0,
    increaseCents: 0,
    inPlaceCents: 0,
    windows: emptyWindows(),
    retentionCutLeases: 0,
    retentionCutCents: 0,
    keptIncreaseCents: 0,
    lostRentCents: 0,
    netMonthlyCents: 0,
  }
}

/// `today` is the facility-local business date. A window of N days has
/// elapsed once day N itself is over — `today` is past it — because a
/// move-out dated day N is still inside the window.
export function rateIncreaseOutcome(
  increases: readonly AppliedIncrease[],
  today: Date,
): RateIncreaseOutcome {
  const result = emptyRateIncreaseOutcome()

  for (const increase of increases) {
    result.count += 1
    result.increaseCents += increase.newRateCents - increase.inPlaceCents
    result.inPlaceCents += increase.inPlaceCents

    const age = daysBetween(increase.effectiveDate, today)
    const moveOutDay = increase.moveOut ? daysBetween(increase.effectiveDate, increase.moveOut.date) : null
    const leftWithin = (days: number) => moveOutDay !== null && moveOutDay >= 0 && moveOutDay <= days

    for (const days of OUTCOME_WINDOWS) {
      if (age <= days) continue
      const window = result.windows[days]
      window.measured += 1
      if (leftWithin(days)) {
        window.movedOut += 1
        if (increase.moveOut?.cause === 'price_or_rate_increase') window.movedOutForPrice += 1
      }
    }

    if (age <= 90) continue
    const cutCents = increase.retentionCuts
      .filter((cut) => {
        const day = daysBetween(increase.effectiveDate, cut.effectiveDate)
        return day >= 0 && day <= 90
      })
      .reduce((sum, cut) => sum + cut.reductionCents, 0)
    if (cutCents > 0) {
      result.retentionCutLeases += 1
      result.retentionCutCents += cutCents
    }
    if (leftWithin(90)) {
      result.lostRentCents += increase.inPlaceCents
    } else {
      result.keptIncreaseCents += increase.newRateCents - increase.inPlaceCents - cutCents
    }
  }

  result.netMonthlyCents = result.keptIncreaseCents - result.lostRentCents
  return result
}

/// D-25: sum the components, never average the averages.
export function sumRateIncreaseOutcome(outcomes: readonly RateIncreaseOutcome[]): RateIncreaseOutcome {
  const total = emptyRateIncreaseOutcome()
  for (const outcome of outcomes) {
    total.count += outcome.count
    total.increaseCents += outcome.increaseCents
    total.inPlaceCents += outcome.inPlaceCents
    for (const days of OUTCOME_WINDOWS) {
      total.windows[days].measured += outcome.windows[days].measured
      total.windows[days].movedOut += outcome.windows[days].movedOut
      total.windows[days].movedOutForPrice += outcome.windows[days].movedOutForPrice
    }
    total.retentionCutLeases += outcome.retentionCutLeases
    total.retentionCutCents += outcome.retentionCutCents
    total.keptIncreaseCents += outcome.keptIncreaseCents
    total.lostRentCents += outcome.lostRentCents
  }
  total.netMonthlyCents = total.keptIncreaseCents - total.lostRentCents
  return total
}

export function averageIncreaseCents(outcome: RateIncreaseOutcome): number {
  return outcome.count === 0 ? 0 : Math.round(outcome.increaseCents / outcome.count)
}

/// Σ increase ÷ Σ in-place rate, 0–1+. Weighted by rate on purpose: it is the
/// percentage the rent roll actually moved.
export function averageIncreasePercent(outcome: RateIncreaseOutcome): number {
  return outcome.inPlaceCents === 0 ? 0 : outcome.increaseCents / outcome.inPlaceCents
}
