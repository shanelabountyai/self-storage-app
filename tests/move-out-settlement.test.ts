import { describe, expect, it } from "vitest";
import {
  noticeShortfallDays,
  proratedCredit,
  settleMoveOut,
} from "../packages/core/move-out";
import { prorate } from "../packages/core/billing";

// B-040 / PRD 02 US-14 (move-out). Pure money math — no database, no clock.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/// A first-of-month period, so the calendar month and the billing period
/// happen to coincide — the case the old calendar-month denominator got right
/// by accident.
const AUGUST = { start: d("2026-08-01"), end: d("2026-09-01") };

describe("proratedCredit", () => {
  it("credits the unused days of a paid period", () => {
    // 31-day period, left on the 15th. The move-out day itself is not
    // charged (`to` is exclusive), so days 15–31 are refunded: 17 of 31.
    expect(proratedCredit(31_000, AUGUST, d("2026-08-15"))).toBe(17_000);
  });

  it("credits nothing when the tenant leaves on the last day of the period", () => {
    expect(proratedCredit(31_000, AUGUST, d("2026-09-01"))).toBe(0);
  });

  it("credits nothing when the move-out is past the period end", () => {
    // They owe for the overrun; that is the balance's job, not a negative credit.
    expect(proratedCredit(31_000, AUGUST, d("2026-09-10"))).toBe(0);
  });

  it("uses the length of the BILLING PERIOD, not the calendar month (US-18)", () => {
    // B-077's correction. An anniversary lease billing on the 20th has a
    // 20 Aug – 20 Sep period of 31 days. Leaving on 5 Sep leaves 15 unused.
    // Correct: 12900 − round(12900 × 16/31) = 12900 − 6658 = 6242.
    // The old calendar-month denominator used 30 (September) and returned
    // 6450 — $2.08 more than the AC's formula allows.
    const anniversary = { start: d("2026-08-20"), end: d("2026-09-20") };
    expect(proratedCredit(12_900, anniversary, d("2026-09-05"))).toBe(6_242);
  });

  it("reconciles exactly: charged + refunded === the full period", () => {
    // The guarantee `unusedRemainder` exists for. Every day of a 31-day
    // period, checked, so no rounding pair can drift a cent.
    const period = { start: d("2026-08-01"), end: d("2026-09-01") };
    for (let day = 1; day <= 31; day += 1) {
      const moveOut = new Date(Date.UTC(2026, 7, day));
      const refunded = proratedCredit(12_900, period, moveOut);
      const charged = prorate({
        monthlyCents: 12_900,
        period,
        from: period.start,
        to: moveOut,
      }).amountCents;
      expect(charged + refunded).toBe(12_900);
    }
  });

  it("handles a short February period", () => {
    const february = { start: d("2026-02-01"), end: d("2026-03-01") };
    expect(proratedCredit(28_000, february, d("2026-02-15"))).toBe(14_000);
  });
});

describe("settleMoveOut", () => {
  const base = {
    monthlyRateCents: 31_000,
    paidThroughDate: d("2026-09-01"),
    moveOutDate: d("2026-08-15"),
    prorateOnMoveOut: true,
    writeOffThresholdCents: 1_000,
    period: AUGUST,
  };

  it("refunds the unused part when the tenant is paid up", () => {
    // Leaving on 15 Aug of a 1 Aug – 1 Sep period: charged for 1–14 (14 days,
    // $140), refunded 15–31 (17 days, $170). The two sum to the full $310,
    // which is the invariant the old calendar-month math did NOT hold — it
    // refunded 16 days and charged 14, quietly keeping one day.
    const result = settleMoveOut({ ...base, balanceCents: 0 });
    expect(result.prorationCreditCents).toBe(17_000);
    expect(result.refundDueCents).toBe(17_000);
    expect(result.amountDueCents).toBe(0);
    expect(result.needsManagerOverride).toBe(false);
  });

  it("credits nothing when the facility does not prorate", () => {
    // The common lease term, and the shipped default.
    const result = settleMoveOut({
      ...base,
      prorateOnMoveOut: false,
      balanceCents: 0,
    });
    expect(result.prorationCreditCents).toBe(0);
    expect(result.refundDueCents).toBe(0);
  });

  it("nets a proration credit against what is owed", () => {
    const result = settleMoveOut({ ...base, balanceCents: 20_000 });
    expect(result.netBalanceCents).toBe(3_000);
    expect(result.amountDueCents).toBe(3_000);
  });

  it("lets a small residual debt be written off", () => {
    const result = settleMoveOut({
      ...base,
      prorateOnMoveOut: false,
      balanceCents: 800,
    });
    expect(result.canWriteOff).toBe(true);
    expect(result.needsManagerOverride).toBe(false);
  });

  it("needs a manager once the debt is over the threshold", () => {
    const result = settleMoveOut({
      ...base,
      prorateOnMoveOut: false,
      balanceCents: 1_001,
    });
    expect(result.canWriteOff).toBe(false);
    expect(result.needsManagerOverride).toBe(true);
  });

  it("treats the threshold itself as writable off, not as an override", () => {
    const result = settleMoveOut({
      ...base,
      prorateOnMoveOut: false,
      balanceCents: 1_000,
    });
    expect(result.canWriteOff).toBe(true);
    expect(result.needsManagerOverride).toBe(false);
  });

  it("never calls a credit balance a write-off", () => {
    // Writing off money we owe back would be keeping it.
    const result = settleMoveOut({
      ...base,
      prorateOnMoveOut: false,
      balanceCents: -5_000,
    });
    expect(result.canWriteOff).toBe(false);
    expect(result.refundDueCents).toBe(5_000);
    expect(result.needsManagerOverride).toBe(false);
  });

  it("has nothing to prorate when nothing was paid ahead", () => {
    const result = settleMoveOut({
      ...base,
      paidThroughDate: null,
      balanceCents: 6_000,
    });
    expect(result.prorationCreditCents).toBe(0);
    expect(result.amountDueCents).toBe(6_000);
  });
});

describe("promotional recapture in the settlement (B-145)", () => {
  const base = {
    monthlyRateCents: 31_000,
    paidThroughDate: null,
    moveOutDate: d("2026-08-15"),
    prorateOnMoveOut: false,
    writeOffThresholdCents: 1_000,
    period: AUGUST,
  };

  it("adds the recapture to what the tenant owes", () => {
    // The property that matters: a recapture shown on the preview but absent
    // from `amountDueCents` would be a figure staff read out and nobody
    // collected.
    const result = settleMoveOut({
      ...base,
      balanceCents: 0,
      recaptureCents: 6_450,
    });
    expect(result.recaptureCents).toBe(6_450);
    expect(result.amountDueCents).toBe(6_450);
    expect(result.netBalanceCents).toBe(6_450);
  });

  it("eats into a refund rather than being paid out alongside one", () => {
    const result = settleMoveOut({
      ...base,
      prorateOnMoveOut: true,
      paidThroughDate: d("2026-09-01"),
      balanceCents: 0,
      recaptureCents: 5_000,
    });
    // $170 credit less the $50 recovered.
    expect(result.refundDueCents).toBe(12_000);
    expect(result.amountDueCents).toBe(0);
  });

  it("can push a close over the write-off threshold and into a manager", () => {
    // A promoted tenant leaving early can owe nothing in rent and still be
    // over the threshold on the recapture alone. Closing that lease is exactly
    // the supervised act US-14's AC describes.
    const result = settleMoveOut({
      ...base,
      balanceCents: 0,
      recaptureCents: 6_450,
    });
    expect(result.needsManagerOverride).toBe(true);
    expect(result.canWriteOff).toBe(false);
  });

  it("is absent by default, so every lease without a promotion is unchanged", () => {
    const result = settleMoveOut({ ...base, balanceCents: 20_000 });
    expect(result.recaptureCents).toBe(0);
    expect(result.amountDueCents).toBe(20_000);
  });
});

describe("noticeShortfallDays", () => {
  it("is zero when the full notice was given", () => {
    expect(noticeShortfallDays(d("2026-08-01"), d("2026-08-15"), 10)).toBe(0);
  });

  it("is zero when exactly the required notice was given", () => {
    expect(noticeShortfallDays(d("2026-08-05"), d("2026-08-15"), 10)).toBe(0);
  });

  it("reports how many days short a late notice was", () => {
    expect(noticeShortfallDays(d("2026-08-11"), d("2026-08-15"), 10)).toBe(6);
  });

  it("counts no notice at all as the whole requirement", () => {
    expect(noticeShortfallDays(null, d("2026-08-15"), 10)).toBe(10);
  });

  it("is zero at a facility that requires no notice", () => {
    expect(noticeShortfallDays(null, d("2026-08-15"), 0)).toBe(0);
  });
});
