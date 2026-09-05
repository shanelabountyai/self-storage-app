import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GUIDES,
  guideBySlug,
  guideCopy,
  guideCtaHref,
  guideFilterLabel,
  guidePath,
  hubEntries,
  sizeGuideEntry,
} from '../apps/web/lib/guides/catalog'
import { FEATURE_FILTERS, SIZE_BANDS } from '../apps/web/lib/inventory/unit-filters'
import { LOCALES } from '../apps/web/lib/i18n'
import { en } from '../apps/web/lib/i18n/en'
import { es } from '../apps/web/lib/i18n/es'
import {
  articleJsonLd,
  DESCRIPTION_HARD_MAX,
  faqPageJsonLd,
  isCanonicalSlug,
} from '../packages/core/marketing'

// PRD 04 §3.2 US-4 AC2/AC3 (B-082 part 3). The guides catalog and the Article
// markup built from it.

// B-262. One prose directory per language. `en` is the flat directory the
// guides have always lived in; `es` is a subdirectory of it, which is why the
// English listing below has to exclude directories rather than assume every
// entry is a file.
const CONTENT_DIRS = {
  en: join(import.meta.dirname, '../apps/web/content/guides'),
  es: join(import.meta.dirname, '../apps/web/content/guides/es'),
}

describe('the guides catalog', () => {
  it('ships AC2 launch set of five, counting the size guide that already existed', () => {
    // Four MDX guides plus `/storage/size-guide`, which is linked rather than
    // re-published (D-60). If somebody ever copies its text under /guides, this
    // count still passes — the assertion below about its href is the one that
    // would catch it.
    for (const locale of LOCALES) {
      expect(hubEntries(locale)).toHaveLength(5)
      expect(sizeGuideEntry(locale).href).toBe('/storage/size-guide')
      expect(hubEntries(locale).filter((entry) => entry.external)).toHaveLength(1)
    }
  })

  it('has a prose file for every guide in every language, and no orphan prose', () => {
    // The route maps slugs to `import()` calls by hand, because a bundler needs
    // the specifiers written out. This is what catches a guide added to the
    // catalog with no words, or words with no catalog entry.
    //
    // B-262 made it per language, and the Spanish half is the one that needs
    // it: an English guide with no Spanish file is a `/es/guides/...` URL that
    // 404s, and nothing else in the suite visits those URLs.
    for (const locale of LOCALES) {
      const files = readdirSync(CONTENT_DIRS[locale], { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
        .map((entry) => entry.name.replace(/\.mdx$/, ''))
        .sort()
      expect(files, `${locale} prose files`).toEqual(GUIDES.map((guide) => guide.slug).sort())
    }
  })

  it('translates every guide completely rather than in part', () => {
    // The failure this exists for is a guide with a Spanish title and an
    // English CTA — a page that switches language halfway down. The type makes
    // the FIELDS mandatory; nothing but this checks that the Spanish is
    // actually different text rather than the English pasted across to satisfy
    // the compiler.
    for (const guide of GUIDES) {
      const english = guideCopy(guide, 'en')
      const spanish = guideCopy(guide, 'es')
      expect(spanish.title, `${guide.slug} title`).not.toBe(english.title)
      expect(spanish.description, `${guide.slug} description`).not.toBe(english.description)
      expect(spanish.ctaLabel, `${guide.slug} CTA`).not.toBe(english.ctaLabel)
      // The FAQ set has to be the same SHAPE in both — a Spanish page emitting
      // a different number of questions describes a page that does not exist,
      // and `faqPageJsonLd` refuses fewer than two, so a dropped question can
      // silently remove the rich result from one language only.
      expect(spanish.faqs.length, `${guide.slug} FAQ count`).toBe(english.faqs.length)
      for (const [index, faq] of spanish.faqs.entries()) {
        expect(faq.question).not.toBe(english.faqs[index].question)
        expect(faq.answer).not.toBe(english.faqs[index].answer)
      }
    }
  })

  it('links out of its prose with unprefixed paths in both languages', () => {
    // The Spanish MDX must NOT hard-code `/es/...`: the page overrides the
    // anchor and prefixes it, so a link written `/es/guides/climate-control`
    // would become `/es/es/guides/climate-control`. Keeping both languages'
    // prose on the same hrefs is what makes the override the only rule.
    for (const locale of LOCALES) {
      for (const guide of GUIDES) {
        const prose = readFileSync(join(CONTENT_DIRS[locale], `${guide.slug}.mdx`), 'utf8')
        const prefixed = [...prose.matchAll(/\]\((\/es\/[^)]*)\)/g)].map((m) => m[1])
        expect(prefixed, `${locale}/${guide.slug} hard-codes a locale prefix`).toEqual([])
      }
    }
  })

  it('gives every guide a canonical slug and a unique one', () => {
    for (const guide of GUIDES) {
      expect(isCanonicalSlug(guide.slug), `${guide.slug} is not a canonical slug`).toBe(true)
      expect(guidePath(guide)).toBe(`/guides/${guide.slug}`)
    }
    expect(new Set(GUIDES.map((guide) => guide.slug)).size).toBe(GUIDES.length)
  })

  it('resolves a known slug and refuses an unknown one', () => {
    const found = guideBySlug('climate-control')
    expect(found && guideCopy(found, 'en').title).toContain('climate-controlled')
    expect(guideBySlug('no-such-guide')).toBeNull()
    // A path traversal in a URL segment must not resolve to anything.
    expect(guideBySlug('../../etc/passwd')).toBeNull()
  })

  it('keeps every description inside what a search result will render', () => {
    // B-262: in BOTH languages. Spanish runs roughly 20% longer than English
    // for the same sentence, so a description that clears the cap in English is
    // exactly the one that will not in Spanish — and the failure is a truncated
    // search result, which nothing else here would show.
    for (const locale of LOCALES) {
      for (const guide of GUIDES) {
        const { description } = guideCopy(guide, locale)
        expect(
          description.length,
          `${locale}/${guide.slug} description is ${description.length} chars`,
        ).toBeLessThanOrEqual(DESCRIPTION_HARD_MAX)
        expect(description.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('dates every guide, with `updated` never before `published`', () => {
    // `Article.dateModified` earlier than `datePublished` is invalid markup,
    // and the pair is typed by hand — which is exactly why it is checked.
    for (const guide of GUIDES) {
      expect(guide.published, `${guide.slug}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(guide.updated, `${guide.slug}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(guide.updated >= guide.published, `${guide.slug} was updated before it existed`).toBe(
        true,
      )
    }
  })
})

describe('AC3 contextual CTAs', () => {
  it('points every CTA at a filter value the facility page actually knows', () => {
    // The whole reason `GuideFilter` is typed against the real vocabularies: a
    // CTA carrying `?size=extra-large` renders a facility page with the filter
    // silently ignored, which looks exactly like a working link.
    for (const guide of GUIDES) {
      if (guide.filter.size) expect(Object.keys(SIZE_BANDS)).toContain(guide.filter.size)
      if (guide.filter.feature) expect(Object.keys(FEATURE_FILTERS)).toContain(guide.filter.feature)
    }
  })

  it('builds the CTA link from the filter', () => {
    expect(guideCtaHref({ size: 'medium' })).toBe('/storage/search?size=medium')
    expect(guideCtaHref({ feature: 'climate' })).toBe('/storage/search?features=climate')
    // `features`, plural, because that is the parameter name `parseFilters`
    // reads and it accepts repeats. A CTA writing `feature=` would be ignored.
    expect(guideCtaHref({ feature: 'climate' })).toContain('features=')
  })

  it('falls back to the bare search when a guide recommends no filter', () => {
    // Packing advice is not about a size, and inventing one would send a reader
    // to a filtered list for a reason the guide never gave.
    expect(guideCtaHref({})).toBe('/storage/search')
    for (const locale of LOCALES) expect(guideFilterLabel({}, locale)).toBeNull()
  })

  it('labels the filter with the same words the facility page control uses', () => {
    // A reader who follows the CTA should recognise where they landed.
    //
    // B-090 part 6 moved the words into the dictionaries and left the KEY on
    // the band, so the assertion resolves the key the same way the control
    // does. It resolved against `en` unconditionally then, because the guides
    // were English prose; B-262 translated them, so it follows the locale —
    // a Spanish filter name in a Spanish sentence, which is what that note
    // said would happen.
    expect(guideFilterLabel({ size: 'medium' }, 'en')).toBe(en[SIZE_BANDS.medium.labelKey])
    expect(guideFilterLabel({ feature: 'climate' }, 'en')).toBe(
      en[FEATURE_FILTERS.climate.labelKey],
    )
    expect(guideFilterLabel({ size: 'medium' }, 'es')).toBe(es[SIZE_BANDS.medium.labelKey])
    expect(guideFilterLabel({ feature: 'climate' }, 'es')).toBe(
      es[FEATURE_FILTERS.climate.labelKey],
    )
  })
})

describe('guide structured data', () => {
  it('marks the page up as the article rather than as mentioning it', () => {
    const node = articleJsonLd({
      headline: 'What fits in a 10x10 storage unit?',
      description: 'A one-bedroom apartment, with room to walk in.',
      url: 'https://example.com/guides/what-fits-in-a-10x10',
      datePublished: '2026-08-17',
      publisher: 'Lab Intelligence LLC',
    })

    expect(node['@type']).toBe('Article')
    expect(node.mainEntityOfPage).toEqual({
      '@type': 'WebPage',
      '@id': 'https://example.com/guides/what-fits-in-a-10x10',
    })
    // Absent `dateModified` means "never revised", not "unknown" — it mirrors
    // `datePublished` rather than being omitted, because omitting it lets a
    // consumer decide for itself and they do not agree.
    expect(node.dateModified).toBe('2026-08-17')
    expect(node.publisher).toEqual({ '@type': 'Organization', name: 'Lab Intelligence LLC' })
  })

  it('never claims an author or an image it does not have', () => {
    const node = articleJsonLd({
      headline: 'x',
      description: 'y',
      url: 'https://example.com/guides/x',
      datePublished: '2026-08-17',
      publisher: 'Lab Intelligence LLC',
    })
    // Both would be fabricated: nobody is bylined and there is no guide art.
    expect(node).not.toHaveProperty('author')
    expect(node).not.toHaveProperty('image')
  })

  it('emits FAQ markup only for the guides that have a real FAQ, in both languages', () => {
    for (const locale of LOCALES) {
      for (const guide of GUIDES) {
        const { faqs } = guideCopy(guide, locale)
        const node = faqPageJsonLd(faqs)
        if (faqs.length >= 2) {
          expect(node, `${locale}/${guide.slug} should carry FAQPage markup`).not.toBeNull()
        } else {
          // A one-question FAQPage is the shape Google ignores, and zero
          // questions marked up as an FAQ is a claim about a section that is
          // not on the page.
          expect(node, `${locale}/${guide.slug} should carry no FAQPage markup`).toBeNull()
        }
      }
    }
  })

  it('answers every question it asks, in both languages', () => {
    for (const locale of LOCALES) {
      for (const guide of GUIDES) {
        for (const faq of guideCopy(guide, locale).faqs) {
          // Spanish opens a question with `¿` and closes it with `?`. Testing
          // only the closing mark is what both languages share; demanding the
          // opening one as well would be a Spanish-orthography assertion in a
          // test about structured data.
          expect(
            faq.question.trim().endsWith('?'),
            `${locale}/${guide.slug}: "${faq.question}"`,
          ).toBe(true)
          expect(faq.answer.trim().length).toBeGreaterThan(40)
        }
      }
    }
  })
})

describe('guide prose', () => {
  // B-262: every prose file in every language. The heading and link rules are
  // properties of the RENDERED page, and there are two of those per guide now.
  const files = LOCALES.flatMap((locale) =>
    readdirSync(CONTENT_DIRS[locale], { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.mdx'))
      .map((entry) => join(CONTENT_DIRS[locale], entry.name)),
  )

  it.each(files)('%s starts its headings at level two', (name) => {
    // The page frame renders the guide title as the only `h1`. A `#` in the
    // markdown would produce a second one, which is a 1.3.1 failure that axe
    // does not always report, and it would break the document outline of every
    // guide at once because they share one component mapping.
    const source = readFileSync(name, 'utf8')
    expect(source).not.toMatch(/^# /m)
    // And there has to BE a heading — a guide that is one long block of prose
    // is one nobody can skim or navigate by rotor.
    expect(source).toMatch(/^## /m)
  })

  it.each(files)('%s uses only relative links to this site', (name) => {
    // An absolute link to our own domain hard-codes the origin, which
    // `siteOrigin()` exists to own; a `http://` link anywhere is a mixed-content
    // warning waiting for the first time somebody writes one.
    const source = readFileSync(name, 'utf8')
    for (const [, href] of source.matchAll(/\]\(([^)]+)\)/g)) {
      expect(href.startsWith('http://'), `${name} links to ${href} over http`).toBe(false)
      expect(
        href.includes('localhost'),
        `${name} links to ${href}, which only resolves on a laptop`,
      ).toBe(false)
    }
  })
})
