import { describe, expect, it } from 'vitest'
import {
  acceptLanguageLocale,
  DEFAULT_LOCALE,
  LOCALES,
  dictionaryFor,
  isLocale,
  plural,
  segmentsText,
  translate,
  translateSegments,
} from '../apps/web/lib/i18n'
import type { CodeRejection } from '@storage/core/promotions'
import { codeOutcomeMessage } from '../apps/web/lib/promotions/message'
import { en } from '../apps/web/lib/i18n/en'
import { es } from '../apps/web/lib/i18n/es'

// B-090 part 6. The three things about this mechanism that can break silently.
//
// Typecheck already guarantees the KEYS match — `es` is typed as `Dictionary`,
// so an untranslated key fails `npm run typecheck`. What it cannot see is
// anything about the VALUES, and the value bugs are the ones a reader meets:
// a translation that drops `{price}` renders a sentence with the number
// missing, which type-checks perfectly and reads as a broken page.

const PLACEHOLDER = /\{(\w+)\}/g

function placeholders(message: string): Set<string> {
  return new Set([...message.matchAll(PLACEHOLDER)].map((match) => match[1]))
}

describe('i18n dictionaries', () => {
  it('has the same keys in every locale', () => {
    // Belt and braces against an `as never` or a merged object defeating the
    // type: the type is the primary guard, this is the one that survives a
    // cast.
    for (const locale of LOCALES) {
      expect(Object.keys(dictionaryFor(locale)).sort()).toEqual(Object.keys(en).sort())
    }
  })

  it('keeps every placeholder a translation is given', () => {
    // The real defect class. `'{count} sizes available'` translated to
    // `'tamaños disponibles'` loses the number entirely, and nothing but this
    // notices — the string still renders, just without the fact in it.
    const dropped: string[] = []
    for (const [key, english] of Object.entries(en)) {
      const wanted = placeholders(english)
      const got = placeholders(es[key as keyof typeof en])
      for (const name of wanted) if (!got.has(name)) dropped.push(`${key}: {${name}}`)
    }
    expect(dropped).toEqual([])
  })

  it('invents no placeholder a caller will not pass', () => {
    // The mirror image, and it fails LOUDER but no earlier: a Spanish string
    // asking for `{total}` where the English asks for `{amount}` renders the
    // literal braces to the reader, because `translate` leaves an unknown name
    // alone rather than blanking it.
    const invented: string[] = []
    for (const [key, english] of Object.entries(en)) {
      const allowed = placeholders(english)
      for (const name of placeholders(es[key as keyof typeof en])) {
        if (!allowed.has(name)) invented.push(`${key}: {${name}}`)
      }
    }
    expect(invented).toEqual([])
  })

  it('spells English apostrophes the way the JSX did', () => {
    // This is the third time this bug class has been caught by hand and the
    // first time it is caught by a test. The pages these strings came out of
    // wrote `&apos;`, which renders a STRAIGHT apostrophe — so lifting the copy
    // into a dictionary with a typographic one (’) silently changed the English
    // on 56 portal strings, and the only thing that noticed was an e2e
    // assertion on "You're on a payment plan".
    //
    // It is a real change, not a nit: a curly apostrophe breaks every by-text
    // locator and every operator's ⌘F. B-090f had to restore it once
    // character-for-character across the checkout, and B-260 reintroduced it
    // across the portal.
    //
    // Spanish is deliberately NOT checked — nothing in this repo pins its
    // punctuation, and « » and ’ are correct there.
    const curly = Object.entries(en)
      .filter(([, value]) => value.includes('\u2019'))
      .map(([key]) => key)
    expect(curly).toEqual([])
  })

  it('translates every field error, rather than pasting the English (B-263)', () => {
    // Scoped to `err.` on purpose. Plenty of the dictionary is legitimately
    // identical across languages — "Email", "TX", a facility name — but every
    // one of these is a whole sentence a renter reads at the moment they are
    // refused, so an identical value is an untranslated paste, not a
    // coincidence. This is the check that would have caught the defect that
    // made this row: the money path was translated and its refusals were not.
    //
    // B-267 adds the named list. `reserve.holdUpdated` carries exactly the
    // weight of an `err.` sentence and is not one — it is the SUCCESS a renter
    // has to read to understand that their reservation did not vanish, and
    // `status: 'success'` is the only reason the prefix does not cover it.
    //
    // B-266 adds the two promo-code outcomes that are not refusals. A renter
    // told in English that their code WORKED, or that a better offer was kept
    // instead of it, is the same defect as one refused in English — and neither
    // can wear the `err.` prefix, because the checkout styles that branch red.
    //
    // B-268 adds `res.cancelled`. Same argument a third time: it is the
    // `status: 'success'` a renter reads after releasing their unit, which is
    // irreversible, so an untranslated paste there is as bad as one under
    // `err.` — and the `err.` prefix would style it red.
    //
    // B-269 adds the terms themselves. They are the WORDS INSIDE
    // `promo.codeApplied` and the whole text of every unit-card badge, so an
    // identical value here is the exact defect that row was written for — a
    // Spanish sentence quoting an English discount.
    //
    // B-270 adds `waitlist.joined`, on the `res.cancelled` argument again: it is
    // the `status: 'success'` a visitor reads to know a stranger's email address
    // was actually recorded, and the `err.` prefix would style that red.
    //
    // B-284 adds the reason for a move-out recapture — printed as the
    // justification for a charge on the screen where the tenant agrees to it —
    // and the two refusals that stop a stale move-out or transfer committing.
    //
    // B-291 (D-134) adds the five static-page titles. Each is the `<h1>` AND the
    // `<title>` — the page name a screen reader announces first — so a pasted
    // English value is an English page name under `<html lang="es">`.
    const MUST_ALSO_DIFFER = [
      'faq.title',
      'about.title',
      'contact.title',
      'a11y.title',
      'msgpol.title',
      // B-294 (D-134): the five portal screens that still had an English <title>.
      'cont.title',
      'docs.title',
      'doc.title',
      'prot.title',
      'astmt.title',
      'mo.recaptureFullOne',
      'mo.recaptureFullOther',
      'mo.recaptureProratedOne',
      'mo.recaptureProratedOther',
      'mo.staleDate',
      'tr.staleUnit',
      'tr.staleDate',
      'waitlist.joined',
      'reserve.holdUpdated',
      'promo.codeApplied',
      'promo.codeSuperseded',
      'res.cancelled',
      'promo.terms.freeMonthsOne',
      'promo.terms.freeMonthsOther',
      'promo.terms.percentOffOne',
      'promo.terms.percentOffOther',
      'promo.terms.amountOffOne',
      'promo.terms.amountOffOther',
      'promo.terms.minStayOne',
      'promo.terms.minStayOther',
    ] as const
    const untranslated = Object.keys(en)
      .filter((key) => key.startsWith('err.') || MUST_ALSO_DIFFER.includes(key as never))
      .filter((key) => es[key as keyof typeof en] === en[key as keyof typeof en])
    expect(untranslated).toEqual([])
  })

  it('quotes the control it points at by that language\'s own name for it', () => {
    // `err.postalCodeUnknown` tells the renter to open a disclosure, by name.
    // Renaming `details.enterMyself` in one language and not the other leaves
    // a refusal pointing at a control that is not on the page — with no way
    // out, for exactly the renter who cannot read the other language.
    for (const locale of LOCALES) {
      const dict = dictionaryFor(locale)
      expect(dict['err.postalCodeUnknown'], locale).toContain(dict['details.enterMyself'])
      // B-284. Same trap on the two stale-preview refusals.
      expect(dict['tr.staleUnit'], locale).toContain(dict['tr.showCost'])
      expect(dict['tr.staleDate'], locale).toContain(dict['tr.showCost'])
      expect(dict['mo.staleDate'], locale).toContain(dict['mo.update'])
    }
  })

  it('never makes bodega the countable rented thing (B-288)', () => {
    // D-122 binds D-15's one-word-per-concept rule to the Spanish: the thing a
    // renter rents is `unidad`. `bodegas` stays as the category noun ("Buscar
    // bodegas"), which is always plural here, so any singular `bodega` is the
    // other word for a unit creeping back in — "¿Dónde necesita una bodega?",
    // or both words at once in "Unidad de bodega".
    const countNoun = Object.entries(es).filter(([, value]) => /\bbodega\b/i.test(value))
    expect(countNoun).toEqual([])
  })

  it('leads the counter shared-address warning with its question, in under 30 words (B-289)', () => {
    // Read aloud to the person at the desk. A two-word name stands in for
    // {heldBy}, since that is what the staffer actually says.
    for (const dict of [en, es]) {
      const message = dict['details.sharedEmail'].replace('{heldBy}', 'Ada Renter')
      expect(message.match(/[.?!]/)?.[0]).toBe('?')
      expect(message.split(/\s+/).length).toBeLessThan(30)
      expect(message).not.toMatch(/\p{Lu}{2,}/u)
    }
  })

  it('leaves no empty translation', () => {
    // An empty string type-checks and renders a blank label.
    const blank = Object.keys(en).filter((key) => !es[key as keyof typeof en].trim())
    expect(blank).toEqual([])
  })
})

describe('translate', () => {
  it('substitutes named placeholders', () => {
    expect(translate(en, 'facility.onlyLeftOther', { count: 2 })).toBe('Only 2 left')
    expect(translate(es, 'facility.onlyLeftOther', { count: 2 })).toBe('Quedan solo 2')
  })

  it('leaves an unsupplied placeholder alone rather than blanking it', () => {
    // Deliberate: a visible `{price}` is a bug report. A silently empty gap in
    // a sentence about money is a support call nobody can reproduce.
    expect(translate(en, 'facility.from', {})).toBe('From {price}')
  })

  it('returns the message untouched when there is nothing to substitute', () => {
    expect(translate(en, 'checkout.continue')).toBe('Continue')
  })
})

describe('plural', () => {
  it('picks the singular only at exactly one', () => {
    // Spanish agrees the verb with the count where English does not, which is
    // why `facility.onlyLeft*` is split at all — the English pair is identical
    // on purpose and the Spanish one is not.
    expect(plural(es, 1, 'facility.onlyLeftOne', 'facility.onlyLeftOther')).toBe('Queda solo 1')
    expect(plural(es, 4, 'facility.onlyLeftOne', 'facility.onlyLeftOther')).toBe('Quedan solo 4')
    expect(plural(en, 1, 'card.onlyLeftOne', 'card.onlyLeftOther')).toBe('Only 1 unit left')
    expect(plural(en, 2, 'card.onlyLeftOne', 'card.onlyLeftOther')).toBe('Only 2 units left')
    // Zero takes the plural in both languages, which is what "0 units left"
    // needs to read as.
    expect(plural(es, 0, 'card.onlyLeftOne', 'card.onlyLeftOther')).toBe(
      'Quedan solo 0 unidades',
    )
  })

  it('passes extra variables through alongside the count', () => {
    expect(plural(en, 3, 'search.countOne', 'search.countOther', { miles: 25 })).toBe(
      '3 facilities within 25 miles, nearest first',
    )
  })
})

// B-290 (D-133). This decides who is OFFERED Spanish, so a wrong answer is an
// offer in front of somebody who never wanted it, or none for the person it
// exists for.
describe('acceptLanguageLocale', () => {
  it('ranks among the languages the site has, by weight, keeping header order on ties', () => {
    expect(acceptLanguageLocale('es-MX,es;q=0.9,en;q=0.8')).toBe('es')
    expect(acceptLanguageLocale('en-US,en;q=0.9,es;q=0.8')).toBe('en')
    expect(acceptLanguageLocale('fr-FR, es;q=0.9, en;q=0.8')).toBe('es')
    expect(acceptLanguageLocale('en;q=0.5, ES-us;q=0.7')).toBe('es')
    expect(acceptLanguageLocale('es, en')).toBe('es')
    expect(acceptLanguageLocale('en, es')).toBe('en')
  })

  it('answers null when the header names neither language, or refuses both', () => {
    for (const header of [null, undefined, '', '*', 'fr-FR,de;q=0.9', 'es;q=0', 'es;q=abc']) {
      expect(acceptLanguageLocale(header)).toBeNull()
    }
    expect(acceptLanguageLocale('es;q=0, en;q=0.1')).toBe('en')
  })
})

describe('isLocale', () => {
  it('accepts the locales we ship and nothing else', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('es')).toBe(true)
    // A hand-edited or stale cookie must fall back, never throw — this is the
    // guard `getLocale` leans on, and it runs on every public page.
    expect(isLocale('fr')).toBe(false)
    expect(isLocale('')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale('EN')).toBe(false)
  })

  it('defaults to a locale it accepts', () => {
    expect(isLocale(DEFAULT_LOCALE)).toBe(true)
  })
})

// B-266. The promo-code outcome, said in the renter's own language.
//
// `describeCodeOutcome` built these sentences inside `@storage/core/promotions`
// and could only ever build them in English. What the dictionary guards above
// cannot see is the MAPPING — a rejection wired to the wrong key refuses in the
// right language with the wrong reason, and every dictionary assertion still
// passes.
describe('codeOutcomeMessage — B-266', () => {
  const REJECTIONS: CodeRejection[] = [
    'unknown_code',
    'not_for_this_facility',
    'not_for_this_size',
    'existing_tenant_only',
    'window_closed',
    'fully_redeemed',
    'not_active',
  ]

  it('gives every refusal its own sentence, in both languages', () => {
    // Seven distinct reasons is the whole point of the row B-070 wrote them
    // for: "that code is not valid" is a support call, and 3.3.3 wants a
    // refusal the renter can act on. A map that collapsed two of them would
    // translate perfectly and say the wrong thing.
    for (const locale of LOCALES) {
      const dict = dictionaryFor(locale)
      const said = REJECTIONS.map((rejection) => {
        const message = codeOutcomeMessage({ kind: 'rejected', rejection }, dict)
        return translate(dict, message.key, message.vars)
      })
      expect(new Set(said).size, locale).toBe(REJECTIONS.length)
    }
  })

  it('says the terms in the two outcomes that are not refusals', () => {
    // The trap B-122 set here. A code that APPLIED and one SUPERSEDED by a
    // better offer both produce a sentence, and both name the terms the renter
    // is actually getting — a `superseded` message that quoted the code's own
    // terms would tell them they had a discount they do not have.
    //
    // B-269 made the terms facts rather than a sentence, so an operator's own
    // wording is what stays verbatim in both languages (D-129) — which is what
    // makes it usable as the fixture here.
    const halfOff = { kind: 'operator', text: 'Half off', minStayMonths: 0 } as const
    const firstFree = { kind: 'operator', text: 'First month free', minStayMonths: 0 } as const

    for (const locale of LOCALES) {
      const dict = dictionaryFor(locale)
      const applied = codeOutcomeMessage({ kind: 'applied', terms: halfOff }, dict)
      const superseded = codeOutcomeMessage(
        { kind: 'superseded', keptTerms: firstFree },
        dict,
      )
      expect(translate(dict, applied.key, applied.vars), locale).toContain('Half off')
      expect(translate(dict, superseded.key, superseded.vars), locale).toContain(
        'First month free',
      )
    }

    const applied = codeOutcomeMessage({ kind: 'applied', terms: halfOff }, en)
    const superseded = codeOutcomeMessage({ kind: 'superseded', keptTerms: firstFree }, en)

    // Neither is an `err.` key: the checkout styles that branch red and wires
    // `aria-invalid`, so a success wearing the prefix would tell somebody who
    // succeeded that they failed.
    expect(applied.key.startsWith('err.')).toBe(false)
    expect(superseded.key.startsWith('err.')).toBe(false)
  })
})

// B-272. The three surfaces B-269 left behind — and a fourth it had not
// counted, the facility page's own code box — all lost an operator's `lang`
// marking at the same step: interpolating already-marked terms into a
// translated sentence as a STRING. `translateSegments` is the fix, and what
// makes the fix safe is that it agrees with `translate` exactly, since one of
// them feeds a live region and the other the DOM beside it.
describe('translateSegments (B-272)', () => {
  const dict = dictionaryFor('es')
  const terms = [
    { text: '50% off the first month', lang: 'en' as const },
    { text: ' — mínimo 3 meses' },
  ]

  it('joins back to exactly what translate produces', () => {
    // The invariant `FormState.messageParts` rests on. If these ever disagree,
    // a screen reader hears one sentence and the page shows another.
    for (const key of ['promo.codeApplied', 'promo.currentlyApplied'] as const) {
      expect(segmentsText(translateSegments(dict, key, { terms }))).toBe(
        translate(dict, key, { terms }),
      )
    }
  })

  it('keeps the operator run marked and leaves the translated ones bare', () => {
    const parts = translateSegments(dict, 'promo.codeApplied', { terms })
    expect(parts.filter((p) => p.lang === 'en').map((p) => p.text)).toEqual([
      '50% off the first month',
    ])
    // The Spanish frame and the minimum-stay clause are one language, so
    // neither may carry a `lang` — marking them `en` is the mirror-image 3.1.2
    // failure and is not caught by "some span exists".
    expect(parts.some((p) => p.lang === undefined && p.text.includes('mínimo'))).toBe(true)
  })

  it('merges adjacent unmarked runs so a plain sentence is still one node', () => {
    const parts = translateSegments(dict, 'promo.codeApplied', {
      terms: [{ text: 'medio mes gratis' }],
    })
    expect(parts).toHaveLength(1)
    expect(parts[0].lang).toBeUndefined()
  })

  it('leaves an unknown placeholder visible, the same as translate', () => {
    // A var that silently vanishes is worse than one that shows its own name:
    // "Code applied: ." reads as a bug nobody can report.
    const key = 'promo.codeApplied'
    expect(segmentsText(translateSegments(dict, key, {}))).toBe(translate(dict, key, {}))
    expect(segmentsText(translateSegments(dict, key, {}))).toContain('{terms}')
  })
})
