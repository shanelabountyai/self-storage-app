import { describe, expect, it } from "vitest";
import { monthsServed, recaptureFor } from "../packages/core/promotions";

// B-145 / PRD 02 §4.3 US-10. Pure — no database, no clock.
//
// US-10's parenthetical is "min stay implied by recapture rules" and B-144
// shipped the minimum with no rules behind it, which is worse than no column:
// it reads as enforced. This is the arithmetic that enforces it, and every
// number below is checkable by hand because it decides whether a former tenant
// is billed money on their way out.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("monthsServed", () => {
  it("counts completed months, not started ones", () => {
    // In on 3 March, out on 2 June: the third month did not finish.
    expect(monthsServed(d("2026-03-03"), d("2026-06-02"))).toBe(2);
  });

  it("counts the anniversary day itself as completing the month", () => {
    // Out on 3 June, having held the unit for the whole of the third month.
    expect(monthsServed(d("2026-03-03"), d("2026-06-03"))).toBe(3);
  });

  it("crosses a year boundary", () => {
    expect(monthsServed(d("2026-11-10"), d("2027-02-10"))).toBe(3);
  });

  it("is zero for a lease that ends the month it started", () => {
    expect(monthsServed(d("2026-03-03"), d("2026-03-28"))).toBe(0);
    // And never negative, whatever a back-dated abandonment date says.
    expect(monthsServed(d("2026-03-03"), d("2026-01-01"))).toBe(0);
  });
});

describe("recaptureFor", () => {
  const base = {
    discountGivenCents: 12_900,
    minStayMonths: 6,
    monthsServed: 2,
  } as const;

  it("recovers nothing under the default policy", () => {
    // `none` is the shipped default, and the reason it is: a facility that has
    // not chosen a recapture rule must not start billing former tenants
    // because a column appeared.
    expect(recaptureFor({ ...base, policy: "none" })).toEqual({
      amountCents: 0,
      monthsRemaining: 0,
      reason: null,
    });
  });

  it("recovers the whole discount given under `full`", () => {
    const result = recaptureFor({ ...base, policy: "full" });
    expect(result.amountCents).toBe(12_900);
    expect(result.monthsRemaining).toBe(4);
    expect(result.reason).toContain("6-month minimum stay");
    expect(result.reason).toContain("ran 2 months");
  });

  it("recovers the unserved share under `prorated`", () => {
    // Four of the six months unserved: $129.00 × 4/6 = $86.00.
    const result = recaptureFor({ ...base, policy: "prorated" });
    expect(result.amountCents).toBe(8_600);
    expect(result.monthsRemaining).toBe(4);
  });

  it("recovers nothing once the minimum has been served", () => {
    for (const policy of ["full", "prorated"] as const) {
      expect(
        recaptureFor({ ...base, policy, monthsServed: 6 }).amountCents,
      ).toBe(0);
      // And nothing extra for staying longer than the term asked for.
      expect(
        recaptureFor({ ...base, policy, monthsServed: 11 }).amountCents,
      ).toBe(0);
    }
  });

  it("recovers nothing from a promotion that carried no minimum", () => {
    expect(
      recaptureFor({ ...base, policy: "full", minStayMonths: 0 }).amountCents,
    ).toBe(0);
  });

  it("recovers nothing when no discount was ever given", () => {
    // The distinction this whole feature turns on: a promotion that promised
    // six discounted periods and delivered none has saved the tenant nothing,
    // and billing back a promise would invent money.
    expect(
      recaptureFor({ ...base, policy: "full", discountGivenCents: 0 })
        .amountCents,
    ).toBe(0);
  });

  it("never recovers more than was given", () => {
    // Belt and braces on the prorated branch: a tenant who served none of a
    // one-month minimum owes back exactly what they got, not a rounded-up
    // fraction more.
    const result = recaptureFor({
      policy: "prorated",
      discountGivenCents: 999,
      minStayMonths: 1,
      monthsServed: 0,
    });
    expect(result.amountCents).toBe(999);
  });

  it("rounds to whole cents", () => {
    // $100.00 over a 3-month minimum, one month served: 2/3 of 10000 is
    // 6666.67, and a fraction of a cent on a ledger row is a balance that
    // never settles.
    const result = recaptureFor({
      policy: "prorated",
      discountGivenCents: 10_000,
      minStayMonths: 3,
      monthsServed: 1,
    });
    expect(Number.isInteger(result.amountCents)).toBe(true);
    expect(result.amountCents).toBe(6_667);
  });

  it("says why, in the words the tenant reads before agreeing", () => {
    // The row's own point: a recapture a tenant first meets on a final invoice
    // is a chargeback. The reason travels with the amount so the screen, the
    // ledger description and the sentence staff read out cannot diverge.
    const result = recaptureFor({
      policy: "prorated",
      discountGivenCents: 5_000,
      minStayMonths: 6,
      monthsServed: 5,
    });
    expect(result.reason).toBe(
      "Promotional discount recovered for the 1 month of the 6-month minimum stay not served.",
    );
  });
});
