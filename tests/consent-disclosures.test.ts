import { describe, expect, it } from 'vitest'
import {
  ELECTRONIC_RECORDS_CONSENT,
  MARKETING_EMAIL_CHECKOUT_CONSENT,
  MARKETING_EMAIL_LEAD_CONSENT,
  MARKETING_SMS_CONSENT,
  SMS_CONSENT,
  type Disclosure,
} from '../apps/web/lib/consent/disclosures'
import { LOCALES, type Locale } from '../apps/web/lib/i18n'
import { en } from '../apps/web/lib/i18n/en'
import { es } from '../apps/web/lib/i18n/es'
import {
  PUBLISHED_HELP_KEYWORDS,
  PUBLISHED_START_KEYWORDS,
  PUBLISHED_STOP_KEYWORDS,
  classifySmsKeyword,
} from '../packages/core/comms/sms-keywords'

// B-259 (D-125). The invariants that make a translated consent disclosure
// evidence rather than a liability. Each one is a way the item can silently go
// wrong later, in a diff that looks like a copy edit.

const DISCLOSURES: Record<string, Record<Locale, Disclosure>> = {
  SMS_CONSENT,
  MARKETING_EMAIL_CHECKOUT_CONSENT,
  MARKETING_EMAIL_LEAD_CONSENT,
  MARKETING_SMS_CONSENT,
  ELECTRONIC_RECORDS_CONSENT,
}

describe('consent disclosures', () => {
  it('gives every language its own version, on every disclosure', () => {
    // THE invariant. Recording an English version number against Spanish words
    // asserts a consent nobody gave, which is the whole reason B-090f left
    // these untranslated rather than adding four dictionary entries.
    for (const [name, byLocale] of Object.entries(DISCLOSURES)) {
      const versions = LOCALES.map((locale) => byLocale[locale].version)
      expect(new Set(versions).size, `${name} reuses a version across languages`).toBe(
        LOCALES.length,
      )
    }
  })

  it('has real, distinct text in every language', () => {
    for (const [name, byLocale] of Object.entries(DISCLOSURES)) {
      const texts = LOCALES.map((locale) => byLocale[locale].text)
      for (const text of texts) expect(text.trim().length, name).toBeGreaterThan(40)
      // An untranslated copy would keep the English words under a `-es`
      // version, which is the same lie as the first test's, inverted.
      expect(new Set(texts).size, `${name} repeats the same text in two languages`).toBe(
        LOCALES.length,
      )
    }
  })

  it('keeps the two marketing-email disclosures distinct in every language', () => {
    // B-264. The failure this guards is a paste: the lead form's sentence
    // replaced by the checkout's, or vice versa, in a diff that looks like a
    // tidy-up. They share a channel (`marketing_email`) and differ only in
    // their words and their audience, so nothing else would notice — and the
    // version each row carries would then name text that was never on screen.
    for (const locale of LOCALES) {
      expect(
        MARKETING_EMAIL_LEAD_CONSENT[locale].text,
        `the lead and checkout marketing disclosures are identical in ${locale}`,
      ).not.toBe(MARKETING_EMAIL_CHECKOUT_CONSENT[locale].text)
    }
  })

  it('keeps the SMS keywords in English in every language', () => {
    // STOP and HELP are not words, they are the literal strings
    // `classifySmsKeyword` matches. A translated keyword is an instruction
    // that does nothing, and it reads as a helpful edit.
    for (const name of ['SMS_CONSENT', 'MARKETING_SMS_CONSENT']) {
      for (const locale of LOCALES) {
        const { text } = DISCLOSURES[name][locale]
        expect(text, `${name}.${locale}`).toContain('STOP')
        expect(text, `${name}.${locale}`).toContain('HELP')
      }
    }
  })
})

describe('/messaging-policy keywords', () => {
  it('publishes only keywords the classifier actually accepts', () => {
    // The page's own header comment promises the published sets ARE the code's.
    // Before B-259 that was a hand-copied list in prose and nothing checked it.
    for (const keyword of PUBLISHED_STOP_KEYWORDS) {
      expect(classifySmsKeyword(keyword), keyword).toBe('stop')
    }
    for (const keyword of PUBLISHED_START_KEYWORDS) {
      expect(classifySmsKeyword(keyword), keyword).toBe('start')
    }
    for (const keyword of PUBLISHED_HELP_KEYWORDS) {
      expect(classifySmsKeyword(keyword), keyword).toBe('help')
    }
    expect(PUBLISHED_STOP_KEYWORDS[0]).toBe('STOP')
  })

  it('never writes a keyword into a translated string', () => {
    // The page interpolates them so a translator cannot reach them. A keyword
    // typed into a dictionary value is the drift this guards: it would survive
    // typecheck, render correctly today, and be wrong the moment the set moves.
    const keywords = [
      ...PUBLISHED_STOP_KEYWORDS,
      ...PUBLISHED_START_KEYWORDS,
      ...PUBLISHED_HELP_KEYWORDS,
    ]
    for (const dict of [en, es] as const) {
      for (const [key, value] of Object.entries(dict)) {
        if (!key.startsWith('msgpol.')) continue
        for (const keyword of keywords) {
          expect(value, `${key} hardcodes ${keyword}`).not.toMatch(
            new RegExp(`\\b${keyword}\\b`),
          )
        }
      }
    }
  })
})
