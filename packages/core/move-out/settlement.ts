// PRD 02 US-14 (move-out). What a lease is worth on the day it ends.
//
// Pure: no database, no clock, no facility. Every input is passed in, so the
// proration boundaries and the write-off decision are testable exactly — this
// is the code that decides whether a former tenant is refunded, billed, or
// let go.

/// Whole days from `from` to `to`, exclusive of `to`. Both are calendar dates
/// (UTC midnight), which is how move-out and paid-through are stored.
function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
}

export function daysInMonthOf(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
}

/// The unused portion of an already-paid period, as a credit.
///
/// Rounded DOWN to whole cents in the tenant's favour is not possible in both
/// directions at once, so the rule is: a refund rounds down (we never refund a
/// fraction we did not collect), and a charge rounds down too (we never bill a
/// fraction of a cent). Both use the same floor, so the arithmetic is
/// symmetric and a reconciliation never finds a stray cent.
export function proratedCredit(
  monthlyRateCents: number,
  paidThroughDate: Date,
  moveOutDate: Date,
): number {
  const unusedDays = daysBetween(moveOutDate, paidThroughDate)
  if (unusedDays <= 0) return 0
  const daysInMonth = daysInMonthOf(moveOutDate)
  return Math.floor((monthlyRateCents * unusedDays) / daysInMonth)
}

export type MoveOutSettlementInput = {
  /// The lease's current ledger balance. Positive means the tenant owes.
  balanceCents: number
  monthlyRateCents: number
  /// The last day covered by what has been paid. Null when nothing is paid
  /// ahead, in which case there is nothing to prorate back.
  paidThroughDate: Date | null
  moveOutDate: Date
  prorateOnMoveOut: boolean
  writeOffThresholdCents: number
}

export type MoveOutSettlement = {
  /// Credit posted for the unused part of a paid period. Zero when the
  /// facility does not prorate, or when the tenant leaves owing.
  prorationCreditCents: number
  /// What is left after any proration credit. Positive = owed by the tenant,
  /// negative = owed back to them.
  netBalanceCents: number
  /// True when the residual is a debt small enough to write off under policy.
  canWriteOff: boolean
  /// True when the lease cannot be closed without a manager: a debt above the
  /// write-off threshold.
  needsManagerOverride: boolean
  /// What the tenant is owed back, if anything.
  refundDueCents: number
  /// What the tenant still owes, if anything.
  amountDueCents: number
}

export function settleMoveOut(input: MoveOutSettlementInput): MoveOutSettlement {
  const prorationCreditCents =
    input.prorateOnMoveOut && input.paidThroughDate
      ? proratedCredit(input.monthlyRateCents, input.paidThroughDate, input.moveOutDate)
      : 0

  const netBalanceCents = input.balanceCents - prorationCreditCents

  const refundDueCents = netBalanceCents < 0 ? -netBalanceCents : 0
  const amountDueCents = netBalanceCents > 0 ? netBalanceCents : 0

  // A write-off only ever forgives a debt. A credit balance is money we hold
  // and owe back — "writing off" a refund would be keeping it.
  const canWriteOff = amountDueCents > 0 && amountDueCents <= input.writeOffThresholdCents

  return {
    prorationCreditCents,
    netBalanceCents,
    canWriteOff,
    needsManagerOverride: amountDueCents > input.writeOffThresholdCents,
    refundDueCents,
    amountDueCents,
  }
}

/// Whether the notice a lease requires was actually given.
///
/// Reported rather than enforced: staff complete move-outs for tenants who
/// gave no notice all the time, and the lease's remedy is a charge, not a
/// refusal. Blocking the workflow would only teach people to back-date the
/// notice field.
export function noticeShortfallDays(
  noticeGivenAt: Date | null,
  moveOutDate: Date,
  requiredNoticeDays: number,
): number {
  if (requiredNoticeDays <= 0) return 0
  if (!noticeGivenAt) return requiredNoticeDays
  const given = Date.UTC(
    noticeGivenAt.getUTCFullYear(),
    noticeGivenAt.getUTCMonth(),
    noticeGivenAt.getUTCDate(),
  )
  const days = daysBetween(new Date(given), moveOutDate)
  return Math.max(0, requiredNoticeDays - days)
}
