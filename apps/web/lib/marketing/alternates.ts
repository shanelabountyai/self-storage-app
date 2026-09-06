import type { Metadata } from 'next'
import { absoluteUrl } from '@storage/core/marketing'
import { LOCALES, type Locale } from '@/lib/i18n'
import { isIndexableTwin, localePath } from '@/lib/i18n/routing'
import { siteOrigin } from './origin'

// B-262 (D-123). The `alternates` block every translated page owes a crawler.
//
// Two URLs now render the same page in two languages, and a crawler that is not
// told they are translations of each other reads them as duplicates competing
// for the same query — which is the state D-77's duplicate-content gate exists
// to keep this site out of. `hreflang` is the declaration that they are the
// same page, and it is only believed when it is RECIPROCAL: every URL in the
// set has to name every other, itself included, or Google drops the whole
// cluster. That reciprocity is why this is one helper rather than a block typed
// per page — two pages disagreeing about the set is the failure, and it is
// silent.
//
// `x-default` names the English URL. It is what a crawler serves someone whose
// language matches nothing in the set, and English is the honest answer for a
// site whose legal pages, lease and notices are English-only.

/// Canonical + `hreflang` alternates for a path, in the locale being rendered.
///
/// Takes the UNPREFIXED path — whatever `lib/marketing/paths.ts` builds — and
/// takes it RELATIVE, not absolute: Next resolves both against
/// `metadataBase`, so passing an origin here would be a second reading of the
/// environment that could disagree with the sitemap's.
///
/// The canonical is the CURRENT locale's URL, not English. A Spanish page that
/// declared the English URL canonical would be asking to be dropped from the
/// index — which is the accidental way to reinstate D-122's behaviour while
/// appearing to have replaced it.
export function localeAlternates(locale: (typeof LOCALES)[number], path: string): NonNullable<Metadata['alternates']> {
  if (!isIndexableTwin(path)) {
    // No twin worth advertising: one URL, one canonical, no language set. A
    // page reached only behind a hold or a login is already `noindex`, and
    // naming an alternate for it asks a crawler to fetch something we have
    // told it not to keep.
    return { canonical: localePath(locale, path) }
  }

  const languages: Record<string, string> = {}
  for (const candidate of LOCALES) languages[candidate] = localePath(candidate, path)
  languages['x-default'] = localePath('en', path)

  return { canonical: localePath(locale, path), languages }
}

/// The absolute URL of a path in the locale being rendered.
///
/// For JSON-LD, which is the third place a relative URL is worthless. Every
/// `@id` and `url` a Spanish page emits has to name the Spanish URL: a
/// breadcrumb whose items point at English pages contradicts the canonical in
/// the same document, and a crawler resolving that disagreement is not
/// obliged to resolve it in our favour.
export function localeUrl(locale: Locale, path: string): string {
  return absoluteUrl(siteOrigin(), localePath(locale, path))
}
