import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCALES } from '../apps/web/lib/i18n'
import {
  hasSpanishTwin,
  isIndexableTwin,
  localeFromHeader,
  localePath,
  splitLocalePath,
  LOCALE_PREFIX,
} from '../apps/web/lib/i18n/routing'
import { localeAlternates } from '../apps/web/lib/marketing/alternates'
import { LEGAL_PAGES } from '../apps/web/lib/site-config'

// B-262 (D-123). The locale lives in the URL now, and these are the ways that
// breaks without anything looking broken.
//
// Every failure this file guards is SILENT in the browser: a Spanish visitor
// lands on an English page, or a crawler is handed two URLs it reads as
// duplicates. Nothing throws, nothing 500s, and the page renders — which is
// exactly why none of it can be left to review.

describe('splitLocalePath', () => {
  it('reads the prefix off a Spanish URL', () => {
    expect(splitLocalePath('/es/faq')).toEqual({ locale: 'es', path: '/faq' })
    expect(splitLocalePath('/es/storage/tx/austin/demo-austin-south')).toEqual({
      locale: 'es',
      path: '/storage/tx/austin/demo-austin-south',
    })
  })

  it('treats the bare prefix as the Spanish homepage', () => {
    // `/es` and `/es/` both arrive here as `/es` — the proxy canonicalises the
    // trailing slash before splitting — and both mean the homepage. Returning
    // `''` instead of `/` would make every downstream `startsWith('/')` test
    // false at once.
    expect(splitLocalePath('/es')).toEqual({ locale: 'es', path: '/' })
  })

  it('needs the segment to END, not merely to start', () => {
    // The bug a `startsWith('/es')` test would ship: a facility slug, a city or
    // a guide beginning with those two letters would be read as a Spanish URL
    // and rendered from a path with its first three characters cut off.
    expect(splitLocalePath('/espanol')).toEqual({ locale: 'en', path: '/espanol' })
    expect(splitLocalePath('/estimates')).toEqual({ locale: 'en', path: '/estimates' })
    expect(splitLocalePath('/storage/tx/escondido')).toEqual({
      locale: 'en',
      path: '/storage/tx/escondido',
    })
  })

  it('defaults an unprefixed path to English', () => {
    expect(splitLocalePath('/faq')).toEqual({ locale: 'en', path: '/faq' })
    expect(splitLocalePath('/')).toEqual({ locale: 'en', path: '/' })
  })
})

describe('localePath', () => {
  it('round-trips with splitLocalePath for every locale', () => {
    // The two halves are used in different runtimes — `localePath` builds links
    // in the app, `splitLocalePath` reads them at the edge — so a disagreement
    // would show up as a link that works nowhere rather than as a failure here.
    const paths = ['/', '/faq', '/storage/search', '/portal/pay', '/guides/packing-tips']
    for (const locale of LOCALES) {
      for (const path of paths) {
        expect(splitLocalePath(localePath(locale, path))).toEqual({ locale, path })
      }
    }
  })

  it('leaves English URLs completely alone', () => {
    expect(LOCALE_PREFIX.en).toBe('')
    expect(localePath('en', '/faq')).toBe('/faq')
    expect(localePath('en', '/')).toBe('/')
  })

  it('does not touch a link that is not a root-relative path', () => {
    // Three real cases reach `LocaleLink`: the directions link to a map
    // provider, the facility page's `href="?"` filter reset, and a fragment.
    // Prefixing any of them sends the visitor somewhere else entirely, and
    // `/es/?` in particular is a working link to the wrong page.
    expect(localePath('es', 'https://maps.example.com/?q=1')).toBe('https://maps.example.com/?q=1')
    expect(localePath('es', '?')).toBe('?')
    expect(localePath('es', '#main')).toBe('#main')
  })
})

describe('hasSpanishTwin', () => {
  it('covers the translated surfaces', () => {
    expect(hasSpanishTwin('/')).toBe(true)
    expect(hasSpanishTwin('/faq')).toBe(true)
    expect(hasSpanishTwin('/storage/tx/austin')).toBe(true)
    expect(hasSpanishTwin('/portal/pay')).toBe(true)
    expect(hasSpanishTwin('/checkout')).toBe(true)
  })

  it('refuses the pages that stay English', () => {
    // D-122's legal carve-out, reaffirmed by the owner on 2026-09-05. A Spanish
    // URL for one of these would serve English prose from it, which is a second
    // indexable copy of the English page — the duplicate D-77's gate refuses.
    // `/messaging-policy` is here rather than translated because it is the URL
    // an A2P 10DLC review reads and the target of the portal's consent control,
    // and B-259 owns the consent-version half of that.
    expect(hasSpanishTwin('/terms')).toBe(false)
    expect(hasSpanishTwin('/privacy')).toBe(false)
    expect(hasSpanishTwin('/messaging-policy')).toBe(false)
  })

  it('refuses staff and unauthenticated routes', () => {
    expect(hasSpanishTwin('/admin')).toBe(false)
    expect(hasSpanishTwin('/admin/tenants')).toBe(false)
    expect(hasSpanishTwin('/login')).toBe(false)
    expect(hasSpanishTwin('/api/public/facilities')).toBe(false)
    expect(hasSpanishTwin('/pay/abc123')).toBe(false)
  })

  it('matches on a whole segment, not a prefix of one', () => {
    // `/aboutish` is not `/about`. Without the boundary test a new route whose
    // name merely starts with a translated one would inherit a Spanish URL that
    // renders English.
    expect(hasSpanishTwin('/aboutish')).toBe(false)
    expect(hasSpanishTwin('/contacts')).toBe(false)
  })

  it('accounts for every page the footer links', () => {
    // The footer is the one place all seven legal-ish pages are listed, so this
    // is what stops a page being added there and quietly getting no answer
    // either way.
    const translated = LEGAL_PAGES.filter((page) => hasSpanishTwin(page.href)).map((p) => p.href)
    expect(translated.sort()).toEqual(['/about', '/accessibility', '/contact', '/faq'])
  })
})

describe('isIndexableTwin', () => {
  it('excludes the pages a crawler is told not to index', () => {
    // The portal and checkout are translated but noindex. Advertising an
    // `hreflang` alternate for them asks a crawler to fetch something we have
    // already told it to throw away.
    expect(isIndexableTwin('/portal')).toBe(false)
    expect(isIndexableTwin('/portal/pay')).toBe(false)
    expect(isIndexableTwin('/checkout')).toBe(false)
    expect(isIndexableTwin('/faq')).toBe(true)
    expect(isIndexableTwin('/storage/tx/austin')).toBe(true)
  })
})

describe('localeAlternates', () => {
  it('declares a reciprocal set including a self-reference', () => {
    // Google drops an entire hreflang cluster when the URLs in it do not all
    // name each other, itself included. It is not an error anything reports —
    // the pages simply stop being treated as translations.
    for (const locale of LOCALES) {
      const alternates = localeAlternates(locale, '/faq')
      expect(alternates.languages).toEqual({
        en: '/faq',
        es: '/es/faq',
        'x-default': '/faq',
      })
    }
  })

  it('makes each language its OWN canonical', () => {
    // A Spanish page declaring the English URL canonical asks to be dropped
    // from the index — which reinstates D-122's behaviour while looking like it
    // was replaced.
    expect(localeAlternates('es', '/faq').canonical).toBe('/es/faq')
    expect(localeAlternates('en', '/faq').canonical).toBe('/faq')
  })

  it('names no alternates for a page with no indexable twin', () => {
    expect(localeAlternates('en', '/portal/pay').languages).toBeUndefined()
    expect(localeAlternates('en', '/terms')).toEqual({ canonical: '/terms' })
  })
})

describe('localeFromHeader', () => {
  it('falls back to English for anything unrecognised', () => {
    // The header is set by the proxy, but a hand-set one must not be able to
    // 500 a public page.
    expect(localeFromHeader('es')).toBe('es')
    expect(localeFromHeader('fr')).toBe('en')
    expect(localeFromHeader(null)).toBe('en')
    expect(localeFromHeader(undefined)).toBe('en')
  })
})

// The guard the rest of this file cannot provide. Everything above checks the
// vocabulary; this checks that the pages USE it.
//
// A raw `<Link href="/storage/search">` on a Spanish page navigates to the
// English search and says nothing about it. There is no type that catches it
// and no test of behaviour that would fail — the link works. So the rule is
// enforced on the source: inside the public tree, an internal destination goes
// through `LocaleLink`, and `next/link` is imported only where the target is
// deliberately outside the locale.
const PUBLIC_TREE = join(import.meta.dirname, '..', 'apps', 'web', 'app', '(public)')

/// Pages whose every internal link is deliberately unprefixed.
///
/// `/messaging-policy` is not translated, and the two links it carries go to
/// `/privacy` and `/terms`, which are not either. Prefixing any of the three
/// would produce a URL the proxy redirects straight back.
const ENGLISH_ONLY_PAGES = new Set(['messaging-policy', 'terms', 'privacy'])

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full))
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out
}

describe('public pages keep the visitor in their language', () => {
  it('routes every internal link through LocaleLink', () => {
    const offenders: string[] = []
    for (const file of tsxFiles(PUBLIC_TREE)) {
      const relative = file.slice(PUBLIC_TREE.length + 1)
      if ([...ENGLISH_ONLY_PAGES].some((page) => relative.startsWith(page))) continue
      if (readFileSync(file, 'utf8').includes("from 'next/link'")) {
        offenders.push(relative)
      }
    }
    expect(offenders).toEqual([])
  })
})
