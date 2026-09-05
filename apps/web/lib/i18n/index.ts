import { en } from './en'
import { es } from './es'

// B-090 part 6 (D-122). Spanish-language support for the move-in path.
//
// Locale is carried by a cookie and the URLs do not change (owner decision,
// 2026-09-05). The alternative — an `app/[locale]` segment with `/es/...`
// URLs and hreflang — buys indexable Spanish pages, and PRD 04 §3 already
// scopes that out ("Multilingual SEO — English-only in MVP"). So the cheap
// shape is the one that matches the written commitment: a renter who asks for
// Spanish gets Spanish, and Googlebot (which carries no cookie) keeps seeing
// exactly the English pages it indexes today.
//
// ponytail: reading the cookie in the root layout opts EVERY route out of
// full-route caching, so the homepage's `revalidate = 3600` and the city
// page's `revalidate = 300` no longer cache rendered HTML. The staleness
// ceilings those numbers exist for (FR-2.1, AC3's ≤15-minute price cache) are
// unaffected — they live on `cachedPublicInventory`, which still caches the
// data reads, so this costs a React render per request and not a database
// round trip. Upgrade path if Core Web Vitals regresses: move the public tree
// under `app/[locale]` and prerender both locales.

export const LOCALES = ['en', 'es'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/// Same `st_` prefix as the consent cookie, so the app's own cookies are
/// distinguishable from a vendor's at a glance in devtools.
export const LOCALE_COOKIE = 'st_locale'
export const LOCALE_COOKIE_DAYS = 365

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
