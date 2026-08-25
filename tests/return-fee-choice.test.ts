import { describe, expect, it } from "vitest";
import {
  RETURN_FEE_CHOICES,
  waiveFeeFromForm,
} from "../apps/web/lib/billing/reversals";
import { REASON_CODES, REASON_CODE_LABELS } from "@storage/core/audit";

// B-178. The defect this guards is not a bug in a function — it is a label and
// a stored value drifting apart. The shipped control read "Yes — charge the
// configured fee" and submitted `"no"`, because the field was named for the
// waiver rather than the charge. Nothing could catch that, because label and
// value lived in different expressions.
//
// They now live in one row, and this asserts the coupling: the option whose
// words start with "Charge" is the option that does not waive.

describe("the returned-payment fee choice", () => {
  it("couples each option label to what it actually stores", () => {
    for (const choice of RETURN_FEE_CHOICES) {
      expect(
        choice.label.startsWith("Charge"),
        `"${choice.label}" stores waiveFee=${choice.waiveFee}`,
      ).toBe(!choice.waiveFee);
    }
  });

  it("offers exactly one way to charge and one way not to", () => {
    expect(RETURN_FEE_CHOICES.filter((c) => !c.waiveFee)).toHaveLength(1);
    expect(RETURN_FEE_CHOICES.filter((c) => c.waiveFee)).toHaveLength(1);
  });

  it("names the amount in the charging option, since the amount is the decision", () => {
    const charging = RETURN_FEE_CHOICES.find((c) => !c.waiveFee)!;
    expect(charging.label).toContain("{amount}");
  });

  it("waives when the field is absent or unrecognised, never charges", () => {
    // The control is not rendered when the facility has priced no fee, so an
    // absent field must not post one.
    expect(waiveFeeFromForm(null)).toBe(true);
    expect(waiveFeeFromForm("true")).toBe(true);
    expect(waiveFeeFromForm("yes")).toBe(false);
    expect(waiveFeeFromForm("no")).toBe(true);
  });
});

describe("reason codes", () => {
  it("has an operator-facing label for every code, none of them the raw key", () => {
    for (const code of REASON_CODES) {
      const label = REASON_CODE_LABELS[code];
      expect(label, code).toBeTruthy();
      expect(label, code).not.toContain("_");
    }
  });
});
