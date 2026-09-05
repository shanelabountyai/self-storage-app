import { MARKETING_LOCALES, type MarketingLocale } from '@storage/core/marketing'
import { en } from './en'
import { es } from './es'

// B-090 part 6 (D-122), rewritten by B-262 (D-123). Spanish-language support.
//
// The locale is carried by the URL — `/faq` is English, `/es/faq` is Spanish —
// and `lib/i18n/routing.ts` owns that vocabulary. D-122 originally carried it
// in a cookie with the URLs unchanged, because PRD 04 §3 scoped multilingual
// SEO out ("English-only in MVP"); the owner reversed that on 2026-09-05 for
// the reason D-122 could not answer, which is that a cookie leaves a Spanish
// visitor and Googlebot reading different words from one URL and leaves a
// Spanish speaker unable to share a Spanish page at all.
//
// ponytail: this file stays PURE. `translate` runs in the browser bundle, so
// anything that needs a request (`next/headers`) lives in `server.ts` and
// anything the Edge proxy needs lives in `routing.ts`.

/// B-262: re-exported from `packages/core` rather than declared here, because
/// the generated SEO copy lives in that package and is generated per language.
/// One list, so a third language cannot reach the dictionaries without reaching
/// the city intros as well.
export const LOCALES = MARKETING_LOCALES
export type Locale = MarketingLocale

export const DEFAULT_LOCALE: Locale = 'en'

/// Display names are written in the language they name, never translated —
/// "Spanish" is useless to somebody who cannot read the English page.
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
}

/// `en` is `as const`, so its keys are the message names and its values are
/// literal types. `Dictionary` widens the values back to `string` — without
/// that, `es.ts` would have to repeat the English text to satisfy the type,
/// which is the opposite of the point. The KEYS stay exact, which is the half
/// that catches an untranslated string at typecheck.
export type MessageKey = keyof typeof en
export type Dictionary = Record<MessageKey, string>

const DICTIONARIES: Record<Locale, Dictionary> = { en, es }

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale]
}


/// Look up a message, substituting `{name}` placeholders.
///
/// A missing key cannot happen — `es` is typed as `Dictionary`, so typecheck
/// fails on an untranslated key rather than a visitor seeing `home.title`.
export function translate(
  dict: Dictionary,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const message = dict[key]
  if (!vars) return message
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}

/// Pick a singular or plural message.
///
/// ponytail: `n === 1` is the whole rule, and it is correct for English and
/// Spanish — both have exactly a one/other split for counts of things. A
/// language with a dual or paucal form (Polish, Arabic, Russian) needs
/// `Intl.PluralRules` and suffixed keys instead; adding that machinery for two
/// languages that do not need it would be a rule nobody could check.
export function plural(
  dict: Dictionary,
  count: number,
  one: MessageKey,
  other: MessageKey,
  vars?: Record<string, string | number>,
): string {
  return translate(dict, count === 1 ? one : other, { count, ...vars })
}
