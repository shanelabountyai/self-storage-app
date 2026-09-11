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

/// B-283. The one route whose language comes from a database row rather than
/// the cookie: `/pay/<token>` speaks the language of the tenant the link was
/// minted for. `proxy.ts` copies the token out of the path into this request
/// header, because the root layout — the only thing that renders `<html lang>`
/// — cannot see the path. Here rather than in `pay-links.ts` because the proxy
/// runs on the Edge and cannot import Prisma.
export const PAY_TOKEN_HEADER = 'x-st-pay-token'

/// Display names are written in the language they name, never translated —
/// "Spanish" is useless to somebody who cannot read the English page.
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
}

/// `en` | `es` widened to the BCP-47 tag `Intl` wants. `es-US` rather than
/// `es-MX` or `es-ES`: the reader is a Spanish speaker in the United States,
/// which is what makes the currency `$129.00` (identical to English — the same
/// figure, so a tenant comparing an email to the portal sees one number) while
/// the date becomes "14 de septiembre de 2026".
///
/// B-268 moved it here from `lib/comms/prose.ts`, where B-261 wrote it. It was
/// never a comms concept — every surface that formats a date, a number or a
/// list needs the same widening, and a public page importing the send path's
/// Spanish prose to get two strings is the wrong dependency. Same values, so
/// every existing caller renders character-for-character what it did.
export const LOCALE_TAG: Record<Locale, string> = {
  en: 'en-US',
  es: 'es-US',
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

/// B-290 (D-133). The language a browser's `Accept-Language` ranks highest
/// among the ones this site has, or `null` when it names neither.
///
/// Only ever used to decide whether to OFFER Spanish, never to choose the
/// language: the cookie stays the one thing every surface reads.
///
/// Ranked among the languages we HAVE rather than taking the header's first
/// entry: `fr, es;q=0.9, en;q=0.8` would rather read Spanish than English,
/// which is the only choice this site can give them. `q=0` means "not this
/// one", and a malformed weight is ignored rather than trusted. Ties keep header
/// order, which is how a browser writes equal preference.
export function acceptLanguageLocale(header: string | null | undefined): Locale | null {
  let best: { locale: Locale; q: number } | null = null
  for (const entry of (header ?? '').split(',')) {
    const [range, ...params] = entry.trim().toLowerCase().split(';')
    const primary = range.split('-')[0]
    const weight = params.map((param) => param.trim()).find((param) => param.startsWith('q='))
    const q = weight === undefined ? 1 : Number(weight.slice(2))
    if (isLocale(primary) && q > 0 && (!best || q > best.q)) best = { locale: primary, q }
  }
  return best?.locale ?? null
}

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale]
}


/// Look up a message, substituting `{name}` placeholders.
///
/// A missing key cannot happen — `es` is typed as `Dictionary`, so typecheck
/// fails on an untranslated key rather than a visitor seeing `home.title`.
/// B-272. A var may be RUNS rather than a scalar, and `translate` flattens
/// them: the same `vars` object then feeds both this and `translateSegments`,
/// so the string a live region announces and the nodes a page renders can
/// never be two different sentences.
export type MessageVars = Record<string, string | number | readonly MessageSegment[]>

export function translate(dict: Dictionary, key: MessageKey, vars?: MessageVars): string {
  const message = dict[key]
  if (!vars) return message
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!(name in vars)) return whole
    const value = vars[name]
    return Array.isArray(value) ? segmentsText(value) : String(value)
  })
}

/// B-272. A run of message text and the language it is in, when that is not
/// the page's.
///
/// `lang` is set only on a run that is NOT in the reader's language — an
/// operator's own `termsText`, which D-129 renders as typed. Everything else
/// leaves it undefined, so a renderer emits a bare string and no page gains a
/// span per sentence.
///
/// Plain data on purpose. This type crosses the server-action boundary inside
/// `FormState`, and it is read by client components that must not pull the
/// dictionaries into their bundles.
export type MessageSegment = { text: string; lang?: Locale }

/// `translate`, for a message one of whose vars is itself segmented.
///
/// The three surfaces B-269 left behind all had the same shape and none of
/// them could use `translate`: the operator's words arrive already marked, and
/// interpolating them into a template as a STRING is what threw the marking
/// away. Splitting the template on its own placeholders keeps it.
///
/// Joining the result's `text` reproduces `translate` exactly, which is what
/// lets a caller keep a plain string for a live region beside the segments it
/// renders.
export function translateSegments(
  dict: Dictionary,
  key: MessageKey,
  vars: MessageVars,
): MessageSegment[] {
  const out: MessageSegment[] = []
  const push = (segment: MessageSegment) => {
    // Merge with the run before it when both are unmarked, so a template with
    // three plain vars is one text node rather than seven.
    const last = out[out.length - 1]
    if (last && last.lang === undefined && segment.lang === undefined) last.text += segment.text
    else out.push({ ...segment })
  }

  // The capturing group keeps the placeholders, so odd indexes are the names.
  const parts = dict[key].split(/\{(\w+)\}/g)
  for (const [index, part] of parts.entries()) {
    if (index % 2 === 0) {
      if (part) push({ text: part })
      continue
    }
    const value = vars[part]
    // Unknown name: `translate` leaves the placeholder in place, and so does
    // this — a missing var must be visible, never silently blank.
    if (value === undefined) push({ text: `{${part}}` })
    else if (Array.isArray(value)) for (const segment of value) push(segment)
    else push({ text: String(value) })
  }
  return out
}

/// The segments flattened back to one string.
///
/// For the consumers that genuinely cannot take runs and never could: a
/// templated email, a value handed to `calculateMoveInCost` as a line label,
/// a staff screen D-122 keeps English. Defining the string AS the join is what
/// stops a page and the mail about it describing one discount differently.
export function segmentsText(segments: readonly MessageSegment[]): string {
  return segments.map((segment) => segment.text).join('')
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
  vars?: MessageVars,
): string {
  return translate(dict, count === 1 ? one : other, { count, ...vars })
}
