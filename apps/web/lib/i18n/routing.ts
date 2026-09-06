import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from './index'

// B-262 (D-123, superseding D-122's cookie strategy). Where a locale lives in
// a URL.
//
// D-122 put the locale in a cookie and left every URL alone, because PRD 04 §3
// scoped multilingual SEO out. That decision was reversed by the owner on
// 2026-09-05, and the reason is the half D-122 could not solve: the SEO
// surfaces. A cookie means a Spanish visitor and Googlebot read different words
// from the same URL, which is the state D-77's duplicate-content gate reasons
// about, and it means Spanish prose no crawler ever sees. It also means a
// Spanish speaker cannot send a Spanish page to anyone — the link they copy
// renders in English for the person who opens it, which is the failure nobody
// reports because it looks like the site working.
//
// So the locale is now IN THE PATH, and the path is the only thing that decides
// it. `/faq` is English, `/es/faq` is Spanish, both exist, each declares the
// other with `hreflang`. English is unprefixed because it is the default and a
// `/en` prefix would retire every URL this site has ever been linked from.
//
// This module is pure and imports nothing from `next` on purpose: `proxy.ts`
// runs on the Edge runtime and needs the same vocabulary the pages use. A URL
// scheme written down twice is a URL scheme that eventually disagrees with
// itself — the same reason `lib/marketing/paths.ts` exists.

/// The request header `proxy.ts` stamps the resolved locale into, and the only
/// thing `getLocale()` reads. It is a header rather than a cookie because the
/// URL is now authoritative: a cookie that disagreed with the path is exactly
/// the divergence this decision exists to end.
export const LOCALE_HEADER = 'x-storage-locale'

/// The path with its locale prefix removed, stamped alongside it. The language
/// toggle needs it to build the twin URL, and the layout that renders the
/// toggle has no other way to learn the path it is on.
export const LOCALE_PATH_HEADER = 'x-storage-path'

/// The prefix each locale's URLs carry. English carries none.
export const LOCALE_PREFIX: Record<Locale, string> = {
  en: '',
  es: '/es',
}

/// Split a request path into the locale it names and the path underneath it.
///
/// `/es/faq` → `{ locale: 'es', path: '/faq' }`; `/es` → `{ locale: 'es', path:
/// '/' }`; `/faq` → `{ locale: 'en', path: '/faq' }`. `/espanol` is NOT a
/// Spanish URL — the segment has to end, which is why this tests for the
/// boundary rather than calling `startsWith('/es')`.
export function splitLocalePath(pathname: string): { locale: Locale; path: string } {
  for (const locale of LOCALES) {
    const prefix = LOCALE_PREFIX[locale]
    if (!prefix) continue
    if (pathname === prefix) return { locale, path: '/' }
    if (pathname.startsWith(`${prefix}/`)) {
      return { locale, path: pathname.slice(prefix.length) }
    }
  }
  return { locale: DEFAULT_LOCALE, path: pathname }
}

/// The URL a path has in a given locale. The inverse of `splitLocalePath`.
///
/// Takes an UNPREFIXED path and returns the prefixed one, so it is safe to call
/// on anything `lib/marketing/paths.ts` builds. A query string rides along
/// untouched — the prefix is a path concern.
export function localePath(locale: Locale, path: string): string {
  const prefix = LOCALE_PREFIX[locale]
  if (!prefix) return path
  if (path === '/') return prefix
  // Anything that is not a root-relative path is left exactly as it is. Three
  // real cases reach this: an absolute URL (`directionsUrl` builds one to a map
  // provider), a bare query link (`href="?"` is how the facility page clears a
  // filter without naming its own route), and a fragment. Prefixing any of the
  // three produces a URL that goes somewhere else entirely.
  if (!path.startsWith('/')) return path
  return `${prefix}${path}`
}

/// The path prefixes that have a Spanish twin.
///
/// An explicit list, and it has to be: a `/es` URL for a page that is not
/// translated would serve English prose from a Spanish URL, which is a
/// duplicate of the English one and the exact thing D-77's gate refuses. Rather
/// than let that happen by default, anything not named here redirects to its
/// English URL — see `hasSpanishTwin`.
///
/// `/terms`, `/privacy` and `/messaging-policy` are deliberately absent. They
/// stay English (D-122's legal carve-out, reaffirmed by the owner on
/// 2026-09-05): a translated TCPA or E-SIGN disclosure recorded against an
/// English version constant is evidence of a consent nobody gave, and B-259
/// owns that. `/admin` is absent because staff screens are English throughout.
const SPANISH_PATHS: readonly string[] = [
  '/',
  '/about',
  '/accessibility',
  '/checkout',
  '/contact',
  '/faq',
  '/guides',
  '/portal',
  '/reservations',
  '/storage',
  '/waitlist',
]

/// Whether an unprefixed path is one a non-default locale is allowed to serve.
export function hasSpanishTwin(path: string): boolean {
  return SPANISH_PATHS.some((allowed) =>
    allowed === '/' ? path === '/' : path === allowed || path.startsWith(`${allowed}/`),
  )
}

/// Whether a translated path is one a crawler should be told about.
///
/// The portal and checkout are translated but are not indexable — they are
/// behind a hold or a login and already carry `noindex`. Advertising an
/// `hreflang` alternate for a page a crawler is told not to index asks it to
/// fetch something and then tells it the fetch was pointless.
export function isIndexableTwin(path: string): boolean {
  return hasSpanishTwin(path) && !path.startsWith('/portal') && !path.startsWith('/checkout')
}

/// Coerce a header value to a locale. Anything unrecognised is English —
/// a hand-set header must not be able to 500 a public page.
export function localeFromHeader(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}

/// The `og:locale` value for each language.
///
/// `es_US` rather than `es_ES` or plain `es`: Open Graph wants a
/// language_TERRITORY pair, and the territory this site operates in is the
/// United States in both languages — a Spanish reader here is in Texas, not
/// Spain, and `es_ES` would be a claim about an audience we do not serve.
export const OPEN_GRAPH_LOCALE: Record<Locale, string> = {
  en: 'en_US',
  es: 'es_US',
}
