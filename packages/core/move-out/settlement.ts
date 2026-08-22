import { unusedRemainder, type BillingPeriod } from "../billing/index.ts";

// PRD 02 US-14 (move-out). What a lease is worth on the day it ends.
//
// Pure: no database, no clock, no facility. Every input is passed in, so the
// proration boundaries and the write-off decision are testable exactly — this
// is the code that decides whether a former tenant is refunded, billed, or
// let go.
//
// ── The proration denominator, corrected in B-077 ───────────────────────────
//
// This file used to divide by the days in the move-out date's CALENDAR MONTH.
// US-18's AC states the formula: "daily rate = monthly rate / days in billing
// period". Under D-27's default (anniversary billing) a billing period is not
// a calendar month — a lease that bills on the 20th has a 20 Aug–20 Sep period
// of 31 days, while `daysInMonthOf(5 Sep)` is 30 — so the old denominator was
// simply the wrong one, and a $129 lease refunded $64.50 where the AC says
// $62.42.
//
// It now calls `unusedRemainder` from `@storage/core/billing`, which is the
// implementation US-18 and US-14 both say is the only one ("proration math is
// built once, in the shared core package, in both directions"). That also
// makes B-077's transfer coherent: a transfer is a prorated move-out and a
// prorated move-in on one day, and the two halves must not use different
// arithmetic.

/// Whole days from `from` to `to`, exclusive of `to`. Both are calendar dates
/// (UTC midnight), which is how move-out and paid-through are stored.
function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/// The unused portion of an already-paid billing period, as a credit.
///
/// Delegates to `unusedRemainder`, so "charged + refunded === the full period"
/// holds to the penny — that guarantee comes from subtracting the charged
/// amount from the whole rather than rounding the refund independently, and
/// is the reason this is a delegation rather than a second formula.
export function proratedCredit(
  monthlyRateCents: number,
  period: BillingPeriod,
  moveOutDate: Date,
): number {
  // Nothing to refund once the period is already over, or when the move-out
  // is at or after its end.
  if (moveOutDate.getTime() >= period.end.getTime()) return 0;
  return unusedRemainder({
    monthlyCents: monthlyRateCents,
    period,
    from: period.start,
    to: moveOutDate,
  }).amountCents;
}

export type MoveOutSettlementInput = {
  /// The lease's current ledger balance. Positive means the tenant owes.
  balanceCents: number;
  monthlyRateCents: number;
  /// The last day covered by what has been paid. Null when nothing is paid
  /// ahead, in which case there is nothing to prorate back.
  paidThroughDate: Date | null;
  moveOutDate: Date;
  prorateOnMoveOut: boolean;
  writeOffThresholdCents: number;
  /// B-145. A promotional discount charged back because the lease ended inside
  /// its minimum stay. Zero under the default policy and for every lease that
  /// carried no promotion.
  ///
  /// An INPUT rather than something computed here, for the same reason
  /// `period` is: this file is pure and the amount depends on a redemption's
  /// applied periods, a promotion's term and a facility's policy — three rows
  /// only the caller can read. What this file owns is that the figure lands in
  /// the settlement rather than beside it.
  recaptureCents?: number;
  /// The billing period the move-out falls in — the denominator US-18's AC
  /// specifies. Supplied by the caller because only it knows the facility's
  /// billing policy and the lease's billing day.
  period: BillingPeriod;
};

export type MoveOutSettlement = {
  /// Credit posted for the unused part of a paid period. Zero when the
  /// facility does not prorate, or when the tenant leaves owing.
  prorationCreditCents: number;
  /// B-145. Promotional discount charged back on the way out, as a debit.
  recaptureCents: number;
  /// What is left after any proration credit. Positive = owed by the tenant,
  /// negative = owed back to them.
  netBalanceCents: number;
  /// True when the residual is a debt small enough to write off under policy.
  canWriteOff: boolean;
  /// True when the lease cannot be closed without a manager: a debt above the
  /// write-off threshold.
  needsManagerOverride: boolean;
  /// What the tenant is owed back, if anything.
  refundDueCents: number;
  /// What the tenant still owes, if anything.
  amountDueCents: number;
};

export function settleMoveOut(
  input: MoveOutSettlementInput,
): MoveOutSettlement {
  // `paidThroughDate` remains the gate rather than the arithmetic: it answers
  // "is any of this period actually paid for", which is what makes a refund
  // owed at all. The period answers "how much of it is unused", which is the
  // part US-18 specifies.
  const paidBeyondMoveOut =
    input.paidThroughDate !== null &&
    input.paidThroughDate.getTime() > input.moveOutDate.getTime();

  const prorationCreditCents =
    input.prorateOnMoveOut && paidBeyondMoveOut
      ? proratedCredit(input.monthlyRateCents, input.period, input.moveOutDate)
      : 0;

  // Added to what is owed, not netted against the credit separately: a
  // recapture is a charge on this lease like any other, so it moves the write-
  // off and manager-override decisions below exactly as a rent arrear would.
  // A recapture that showed on the preview but not in `amountDueCents` would be
  // a figure staff read out and nobody collected.
  const recaptureCents = Math.max(0, Math.round(input.recaptureCents ?? 0));

  const netBalanceCents =
    input.balanceCents - prorationCreditCents + recaptureCents;

  const refundDueCents = netBalanceCents < 0 ? -netBalanceCents : 0;
  const amountDueCents = netBalanceCents > 0 ? netBalanceCents : 0;

  // A write-off only ever forgives a debt. A credit balance is money we hold
  // and owe back — "writing off" a refund would be keeping it.
  const canWriteOff =
    amountDueCents > 0 && amountDueCents <= input.writeOffThresholdCents;

  return {
    prorationCreditCents,
    recaptureCents,
    netBalanceCents,
    canWriteOff,
    needsManagerOverride: amountDueCents > input.writeOffThresholdCents,
    refundDueCents,
    amountDueCents,
  };
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
  if (requiredNoticeDays <= 0) return 0;
  if (!noticeGivenAt) return requiredNoticeDays;
  const given = Date.UTC(
    noticeGivenAt.getUTCFullYear(),
    noticeGivenAt.getUTCMonth(),
    noticeGivenAt.getUTCDate(),
  );
  const days = daysBetween(new Date(given), moveOutDate);
  return Math.max(0, requiredNoticeDays - days);
}
