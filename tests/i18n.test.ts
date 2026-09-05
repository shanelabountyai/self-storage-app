import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALES,
  dictionaryFor,
  isLocale,
  plural,
  translate,
} from '../apps/web/lib/i18n'
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
