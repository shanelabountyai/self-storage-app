import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALES,
  dictionaryFor,
  isLocale,
  plural,
  translate,
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
    // B-274 adds the three sentences the waitlist cancel page answers with.
    // `res.cancelled`'s argument, on the other unsubscribe this site has: they
    // are the `status: 'success'` prose a visitor reads after taking themselves
    // off a list, reached from a link in a mail that was written in their own
    // language, so an untranslated paste is a reply in the wrong language to
    // somebody who is already gone and will not write in to say so.
    //
    // `wait.joined` and `wait.alreadyOn` stay OFF the list, alongside
    // `lead.thanks` and for the same reason: they are the ordinary confirmation
    // of an ordinary form submit, reversible from the mail that follows, and
    // the line has to be somewhere.
    //
    // B-269 adds the terms themselves. They are the WORDS INSIDE
    // `promo.codeApplied` and the whole text of every unit-card badge, so an
    // identical value here is the exact defect that row was written for — a
    // Spanish sentence quoting an English discount.
    const MUST_ALSO_DIFFER = [
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
      'wait.cancelOff',
      'wait.cancelDone',
      'wait.cancelAlready',
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
