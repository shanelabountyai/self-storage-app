import { describeTerms, discountSchedule, type DiscountSchedule, type PromotionTerms } from './schedule.ts'

// PRD 04 FR-PROMO-3 (B-070). "Given (facility, unit type, tenant-newness, date,
// optional code) → applicable promo + computed discount schedule; used by
// facility pages, checkout, and the quote email."
//
// One evaluator for all three surfaces, and that is the requirement rather than
// a convenience: a badge on a unit card that says "first month free" while
// checkout charges full price is the failure mode, and it happens the moment
// two places decide eligibility separately.
//
// Pure. The caller loads candidates and passes the context; nothing here reads
// a database, so the same function answers a server render, a checkout step and
// a nightly job.

export type PromotionStatus = 'draft' | 'active' | 'paused' | 'ended'
export type PromotionDisplayMode = 'auto' | 'code'

export type PromotionCandidate = PromotionTerms & {
  id: string
  name: string
  status: PromotionStatus
  displayMode: PromotionDisplayMode
  /// Empty means every facility / every unit type.
  facilityIds: readonly string[]
  unitTypeIds: readonly string[]
  newTenantOnly: boolean
  startsAt: Date | null
  endsAt: Date | null
  maxRedemptions: number | null
  redemptionCount: number
  /// An operator's own wording, when they wrote one. Otherwise generated.
  termsText: string | null
  /// Codes attached to a `code`-mode promo, already filtered to usable ones by
  /// the caller (not expired, under their own max uses).
  codes: readonly string[]
}

export type EligibilityContext = {
  facilityId: string
  unitTypeId: string
  monthlyRateCents: number
  /// FR-PROMO-1's new-tenant flag. "Has never held a lease at this org."
  isNewTenant: boolean
  at: Date
  /// What the prospect typed, if anything. Case-insensitive by policy —
  /// FR-PROMO-2 says codes are "unique, case-insensitive".
  code?: string | null
}

export type EligibilityResult = {
  promotion: PromotionCandidate
  schedule: DiscountSchedule
  /// US-12 AC1's "plain-language terms".
  terms: string
  /// The code that unlocked it, for `code`-mode promos. Recorded on the
  /// redemption (FR-PROMO-4) so "which code did this come from" is answerable.
  code: string | null
}

/// Why a promo did not apply. Returned rather than swallowed, because a
/// prospect who typed a code deserves to know it was wrong rather than watch
/// the total not change.
export type CodeRejection =
  | 'unknown_code'
  | 'not_for_this_facility'
  | 'not_for_this_size'
  | 'existing_tenant_only'
  | 'window_closed'
  | 'fully_redeemed'
  | 'not_active'

export type Evaluation = {
  /// The best applicable promo, or null.
  best: EligibilityResult | null
  /// Every promo that would apply without a code, for the badges a facility
  /// page shows per unit type.
  automatic: EligibilityResult[]
  /// Set only when a code was typed and did not work.
  rejection: CodeRejection | null
}

/// FR-PROMO-3's evaluator.
export function evaluatePromotions(
  candidates: readonly PromotionCandidate[],
  context: EligibilityContext,
): Evaluation {
  const typed = context.code?.trim().toLowerCase() || null

  const applicable: EligibilityResult[] = []
  let rejection: CodeRejection | null = null

  for (const promotion of candidates) {
    const needsCode = promotion.displayMode === 'code'
    const matchedCode = typed
      ? promotion.codes.find((code) => code.toLowerCase() === typed) ?? null
      : null

    // A code-gated promo is invisible without its code — that is what "gated"
    // means, and showing it as a badge would make the code pointless.
    if (needsCode && !matchedCode) continue

    const problem = disqualify(promotion, context)
    if (problem) {
      // Only report a rejection for the promo the prospect actually named.
      // "Your code is for another facility" is useful; "one of our eleven
      // promos does not apply to you" is noise.
      if (matchedCode && !rejection) rejection = problem
      continue
    }

    const schedule = discountSchedule(promotion, context.monthlyRateCents)
    if (schedule.totalCents <= 0) continue

    applicable.push({
      promotion,
      schedule,
      terms: promotion.termsText?.trim() || describeTerms(promotion, context.monthlyRateCents),
      code: matchedCode,
    })
  }

  if (typed && applicable.every((result) => result.code === null) && !rejection) {
    rejection = 'unknown_code'
  }

  // Best = most money off, and ties go to the one already on the page. A
  // prospect who was shown "first month free" and then typed a code worth the
  // same must not silently lose the badge they were reading.
  const best =
    [...applicable].sort((a, b) => {
      const byValue = b.schedule.totalCents - a.schedule.totalCents
      if (byValue !== 0) return byValue
      return (a.code === null ? 0 : 1) - (b.code === null ? 0 : 1)
    })[0] ?? null

  return {
    best,
    automatic: applicable.filter((result) => result.promotion.displayMode === 'auto'),
    rejection,
  }
}

function disqualify(
  promotion: PromotionCandidate,
  context: EligibilityContext,
): CodeRejection | null {
  if (promotion.status !== 'active') return 'not_active'

  if (promotion.startsAt && context.at < promotion.startsAt) return 'window_closed'
  if (promotion.endsAt && context.at >= promotion.endsAt) return 'window_closed'

  if (promotion.facilityIds.length > 0 && !promotion.facilityIds.includes(context.facilityId)) {
    return 'not_for_this_facility'
  }
  if (promotion.unitTypeIds.length > 0 && !promotion.unitTypeIds.includes(context.unitTypeId)) {
    return 'not_for_this_size'
  }
  if (promotion.newTenantOnly && !context.isNewTenant) return 'existing_tenant_only'

  // Advisory only at this layer. The AUTHORITATIVE cap check is the atomic
  // increment at redemption (FR-PROMO-5) — this one exists to stop showing a
  // badge for something already exhausted, and it is deliberately not trusted
  // to prevent the 101st redemption.
  if (promotion.maxRedemptions !== null && promotion.redemptionCount >= promotion.maxRedemptions) {
    return 'fully_redeemed'
  }

  return null
}

export const REJECTION_MESSAGES: Record<CodeRejection, string> = {
  unknown_code: 'That code is not one of ours. Check it for a typo.',
  not_for_this_facility: 'That code is for a different location.',
  not_for_this_size: 'That code does not apply to this size.',
  existing_tenant_only: 'That code is for new customers only.',
  window_closed: 'That code has expired.',
  fully_redeemed: 'That code has been fully claimed.',
  not_active: 'That code is not currently running.',
}
