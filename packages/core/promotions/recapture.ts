// PRD 02 §4.3 US-10 (B-145). What a promotional discount is worth back when
// the lease ends inside the minimum stay it was given under.
//
// US-10's own parenthetical is "min stay implied by **recapture rules**", and
// until this file there were none: B-144 gave `minStayMonths` a control and a
// place on the lease, and a column recording a term nothing enforces is worse
// than no column, because it reads as enforced.
//
// Pure. This decides whether a former tenant is billed money on their way out,
// so every number it produces is checkable by hand, and the caller supplies the
// clock, the policy and the amount already given.

export type PromoRecapturePolicy = "none" | "full" | "prorated";

export type RecaptureInput = {
  policy: PromoRecapturePolicy;
  /// Cents of discount ACTUALLY GIVEN — the sum of the schedule periods that
  /// have been written onto an invoice, never the promised total.
  ///
  /// The distinction is the difference between a charge and a fabrication: a
  /// six-month 50%-off promo on a tenant who leaves in month two has promised
  /// six periods of discount and delivered two, and billing back the four that
  /// were never given would invent money nobody saved.
  discountGivenCents: number;
  /// The promotion's minimum stay, in months. `0` means no condition, which is
  /// the ordinary case and recovers nothing.
  minStayMonths: number;
  /// Whole months the tenant actually served. See `monthsServed`.
  monthsServed: number;
};

export type Recapture = {
  amountCents: number;
  /// Months of the minimum left unserved. Zero when the term was met.
  monthsRemaining: number;
  /// Why this number — the sentence a tenant is owed BEFORE they agree to the
  /// move-out, not after it lands on a final statement. A recapture a tenant
  /// first meets on an invoice is a chargeback.
  reason: string | null;
};

const NONE: Recapture = { amountCents: 0, monthsRemaining: 0, reason: null };

/// Whole months served between two calendar dates.
///
/// Counts COMPLETED months: a tenant who moved in on 3 March and leaves on
/// 2 June has served two, not three, because the third month is not finished.
/// That is the plain reading of "keep the unit for at least six months" and it
/// is the same direction the lease sentence B-144 writes states it in.
///
/// Both dates are calendar days at UTC midnight, which is how `startDate` and
/// `moveOutDate` are stored.
export function monthsServed(startDate: Date, moveOutDate: Date): number {
  const years = moveOutDate.getUTCFullYear() - startDate.getUTCFullYear();
  const months = moveOutDate.getUTCMonth() - startDate.getUTCMonth();
  const whole = years * 12 + months;
  // The day of the month decides whether the final month completed. A move-out
  // on the anniversary day itself HAS completed that month — the tenant held
  // the unit for the whole of it.
  const completed =
    moveOutDate.getUTCDate() >= startDate.getUTCDate() ? whole : whole - 1;
  return Math.max(0, completed);
}

/// B-175. The sentence the SIGNED LEASE states the minimum stay in — including
/// what happens if it is not served.
///
/// Lives here, beside the arithmetic, deliberately. B-144 wrote this sentence
/// in `lib/lease/build.ts` and made it deliberately silent on consequence,
/// because at the time nothing recovered anything and a signed promise to claw
/// a discount back would have been a term the operator did not do. B-145 then
/// built `recaptureFor` and the charge became real — and the sentence stayed
/// silent, so the word "recovered" first reached the tenant on the move-out
/// screen, at the moment the amount was already computed and they were already
/// leaving. A charge whose first mention is the final statement is a chargeback
/// with paperwork.
///
/// The two now move together or not at all: a test pins each policy's sentence
/// against what `recaptureFor` actually returns under that policy. Putting the
/// wording in the same file as the calculation is what makes that check the
/// obvious thing to write rather than a thing somebody has to remember.
export function minStayTermSummary(
  policy: PromoRecapturePolicy,
  minStayMonths: number,
): string {
  const minStay = Math.max(0, Math.floor(minStayMonths));
  if (minStay < 1) return "There is no fixed term and no penalty for leaving.";

  const condition = `There is no fixed term and you may leave at any time. The promotional rate on this agreement is offered on the basis that you keep this unit for at least ${minStay} ${minStay === 1 ? "month" : "months"}.`;

  // `none` is left exactly as B-144 wrote it, and that is not an oversight: at
  // a facility that recovers nothing, a sentence saying we will charge the
  // discount back is the same defect mirrored — a signed term the operator does
  // not do. The minimum stay is a condition with no consequence there, which is
  // its own problem and B-176's.
  if (policy === "none") return condition;

  return policy === "full"
    ? `${condition} If you leave before then, we will charge back the whole discount you were given.`
    : `${condition} If you leave before then, we will charge back the share of the discount covering the months you did not stay.`;
}

/// The charge-back, under the facility's configured policy.
export function recaptureFor(input: RecaptureInput): Recapture {
  const minStay = Math.max(0, Math.floor(input.minStayMonths));
  const given = Math.max(0, Math.round(input.discountGivenCents));
  const served = Math.max(0, Math.floor(input.monthsServed));

  if (input.policy === "none" || minStay < 1 || given === 0) return NONE;

  const monthsRemaining = minStay - served;
  // The term was met. Not a special case worth a policy branch — a tenant who
  // stayed the minimum owes nothing back whatever the policy says.
  if (monthsRemaining <= 0) return NONE;

  const amountCents =
    input.policy === "full"
      ? given
      : // Prorated: the share of the discount matching the part of the minimum
        // that was not served. Rounded to whole cents like every other money
        // figure here, and capped at what was given — `monthsRemaining` can
        // never exceed `minStay` because `served` is clamped at zero, but the
        // cap is stated rather than reasoned about at the call site.
        Math.min(given, Math.round((given * monthsRemaining) / minStay));

  if (amountCents <= 0) return NONE;

  const months = (count: number) =>
    `${count} ${count === 1 ? "month" : "months"}`;
  return {
    amountCents,
    monthsRemaining,
    reason:
      input.policy === "full"
        ? `Promotional discount recovered in full — the offer asked for a ${minStay}-month minimum stay and this lease ran ${months(served)}.`
        : `Promotional discount recovered for the ${months(monthsRemaining)} of the ${minStay}-month minimum stay not served.`,
  };
}
