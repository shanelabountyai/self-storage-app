import type { CodeOutcome, CodeRejection } from '@storage/core/promotions'
import type { FieldMessage } from '@/lib/admin/form-state'
import type { MessageKey } from '@/lib/i18n'

// B-266. The renter-facing sentence for whatever became of a typed promo code.
//
// This lived in `@storage/core/promotions` as `describeCodeOutcome` until B-266
// and could only ever be English there — the package is pure and has no request
// to read a locale from, which is exactly the reason B-263 moved `judgeStartDate`
// to the same shape. `CodeOutcome` already carried everything a sentence needs,
// so nothing was added to it: the discriminant, the rule that refused, and the
// terms crossed the boundary all along.
//
// One module rather than a copy per surface, because there are two renter-facing
// ones — the checkout's field error and the facility page's live region — and a
// second copy is how the two come to disagree about what a `superseded` code
// means. The admin promotion screens read `CodeOutcome` through neither and stay
// English by D-122, which is the third surface and the reason this cannot live
// in the package.

const REJECTION_KEY: Record<CodeRejection, MessageKey> = {
  unknown_code: 'err.promoUnknown',
  not_for_this_facility: 'err.promoWrongFacility',
  not_for_this_size: 'err.promoWrongSize',
  existing_tenant_only: 'err.promoNewTenantOnly',
  window_closed: 'err.promoExpired',
  fully_redeemed: 'err.promoFullyClaimed',
  not_active: 'err.promoNotRunning',
}

/// The key and its numbers, never the sentence.
///
/// Returns a `FieldMessage` because the checkout's branch is a field error and
/// `keyedFieldError` takes exactly this — the facility page's live region is not
/// a field and reads the same value through `t`.
///
/// Not every outcome is a refusal, and that is the trap B-122 set here: a code
/// that APPLIED and a code SUPERSEDED by a better offer both produce a sentence,
/// and a renter told in English that their code worked is the same defect as one
/// told in English that it did not. Every branch is translated; only `rejected`
/// is styled as an error, and its callers decide that from `outcome.kind`.
export function codeOutcomeMessage(outcome: CodeOutcome): FieldMessage {
  switch (outcome.kind) {
    case 'applied':
      return { key: 'promo.codeApplied', vars: { terms: outcome.terms } }
    case 'superseded':
      return { key: 'promo.codeSuperseded', vars: { terms: outcome.keptTerms } }
    case 'rejected':
      return { key: REJECTION_KEY[outcome.rejection] }
  }
}
