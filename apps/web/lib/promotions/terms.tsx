import { Fragment } from 'react'
import type { OfferTerms } from '@storage/core/promotions'
import { formatRate } from '@/lib/format'
import { plural, type Dictionary } from '@/lib/i18n'

// B-269. A promotion's terms, said in the reader's own language.
//
// `describeTerms` and `withMinStay` built these sentences inside
// `@storage/core/promotions` and could only ever build them in English — the
// package is pure and has no request to read a locale from. B-266 translated
// the sentence AROUND the terms and stopped there, which left
// «Código aplicado — 50% off the first month»: a 3.1.2 Language of Parts
// failure inside a sentence that had just stopped being one. Same move as
// `codeOutcomeMessage` beside this file, for the same reason.
//
// One module rather than a copy per surface, because there are five that read
// it — every unit-card badge on a facility page (the biggest by far), the
// facility page's "what you'd pay" lines, the checkout price summary, the
// applied-code confirmation and the "currently applied" line in the checkout's
// code box. A copy per surface is how two of them come to describe one
// discount differently, which is the thing that gets argued about at the
// counter.

/// A run of terms text and the language it is in.
///
/// Two segments at most, and they exist for the half that CANNOT be
/// translated: `termsText` is an operator's free text in a database column, so
/// D-129 renders it as typed and marks it `lang="en"` rather than leaving
/// English unannounced inside `<html lang="es">`. A minimum stay appended to it
/// IS translated, so the two cannot share one element — marking the whole span
/// `en` would mislabel the Spanish clause.
export type TermsSegment = { text: string; lang?: 'en' }

export function offerTermsSegments(dict: Dictionary, terms: OfferTerms): TermsSegment[] {
  const segments: TermsSegment[] =
    terms.kind === 'operator'
      ? [{ text: terms.text, lang: 'en' }]
      : [{ text: generated(dict, terms) }]

  // B-144's condition, and it is appended rather than folded into the sentence
  // for the reason `withMinStay` was: an operator's own wording wins over the
  // generated half, so a minimum living only inside the generated branch would
  // vanish the moment somebody typed "First month FREE!" into the box.
  if (terms.minStayMonths >= 1) {
    segments.push({
      text: ` — ${plural(dict, terms.minStayMonths, 'promo.terms.minStayOne', 'promo.terms.minStayOther')}`,
    })
  }
  return segments
}

/// The terms as one string, for the surfaces that can only take one.
///
/// `FormState.message` and `fieldErrors` are string-typed end to end, and
/// `costLineLabel` returns the text of a `<dt>` — so the applied-code
/// confirmation, the checkout's "currently applied" line and the cost lines
/// use this and lose the `lang` marking on an operator override. That is a
/// residual of D-129, named in `/accessibility`, not an oversight: turning
/// `FormState` into nodes is a change to the form machinery every admin screen
/// shares, which is a bigger item than this one.
export function offerTermsText(dict: Dictionary, terms: OfferTerms): string {
  return offerTermsSegments(dict, terms)
    .map((segment) => segment.text)
    .join('')
}

/// The terms as nodes, with the operator's own wording marked.
export function OfferTermsText({ dict, terms }: { dict: Dictionary; terms: OfferTerms }) {
  return (
    <>
      {offerTermsSegments(dict, terms).map((segment, index) =>
        segment.lang ? (
          <span key={index} lang={segment.lang}>
            {segment.text}
          </span>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  )
}

function generated(
  dict: Dictionary,
  terms: Exclude<OfferTerms, { kind: 'operator' }>,
): string {
  switch (terms.kind) {
    case 'free_months':
      return plural(dict, terms.periods, 'promo.terms.freeMonthsOne', 'promo.terms.freeMonthsOther')
    case 'percent_off':
      return plural(
        dict,
        terms.periods,
        'promo.terms.percentOffOne',
        'promo.terms.percentOffOther',
        { percent: terms.percent },
      )
    case 'amount_off':
      // `formatRate`, not `formatCents`: the customer-facing form, whole
      // dollars unless the amount genuinely has cents. Character-for-character
      // what `describeTerms` produced, which `smoke.spec.ts` asserts on.
      //
      // It still hardcodes `$` — B-228's class, not fixed here. The figure is
      // identical in `es-US` anyway (a tenant comparing an email against the
      // portal must see one number), so this is a currency question rather
      // than a language one.
      return plural(
        dict,
        terms.periods,
        'promo.terms.amountOffOne',
        'promo.terms.amountOffOther',
        { amount: formatRate(terms.amountCents) },
      )
  }
}
