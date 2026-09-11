import type { CodeOutcome, CodeRejection, RecaptureReason } from '@storage/core/promotions'
import type { FieldMessage } from '@/lib/admin/form-state'
import { plural, type Dictionary, type MessageKey } from '@/lib/i18n'
import { offerTermsSegments } from './terms'

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
/// B-269 added the dictionary. `outcome.terms` stopped being a sentence and
/// became the facts one is written from, so the terms quoted INSIDE this
/// sentence are now resolved in the same language as the sentence around them
/// — «Código aplicado: 50% off the first month» is the defect that row names.
///
/// B-272 returns the terms as RUNS in `vars`, which is what closes D-129's
/// residual. `translate` flattens them for `FormState.message` — the string a
/// live region announces — and `translateSegments` keeps the operator's own
/// wording marked `lang="en"` for the two places that render this as nodes:
/// the facility page's code box and the checkout's `messageParts`.
export function codeOutcomeMessage(outcome: CodeOutcome, dict: Dictionary): FieldMessage {
  switch (outcome.kind) {
    case 'applied':
      return { key: 'promo.codeApplied', vars: { terms: offerTermsSegments(dict, outcome.terms) } }
    case 'superseded':
      return {
        key: 'promo.codeSuperseded',
        vars: { terms: offerTermsSegments(dict, outcome.keptTerms) },
      }
    case 'rejected':
      return { key: REJECTION_KEY[outcome.rejection] }
  }
}

/// B-284. Why a move-out recovers a promotional discount, in the reader's
/// language — the `judgeStartDate` / `codeOutcomeMessage` move a third time.
/// `recaptureFor` returned this as an English sentence, and the portal's
/// move-out screen showed it to a Spanish tenant as the reason for a charge.
///
/// The admin screen and the invoice line call this with `dictionaryFor('en')`
/// (D-122), so the English wording lives in one set of keys, not in a copy
/// that can drift from what the tenant was shown.
///
/// Picked by the minimum stay's count because Spanish needs "1 mes" and
/// "6 meses" where English writes "6-month" either way.
export function recaptureReasonText(dict: Dictionary, reason: RecaptureReason): string {
  const months = (count: number) => plural(dict, count, 'mo.monthsOne', 'mo.monthsOther')
  return reason.policy === 'full'
    ? plural(dict, reason.minStayMonths, 'mo.recaptureFullOne', 'mo.recaptureFullOther', {
        served: months(reason.monthsServed),
      })
    : plural(dict, reason.minStayMonths, 'mo.recaptureProratedOne', 'mo.recaptureProratedOther', {
        remaining: months(reason.monthsRemaining),
      })
}
