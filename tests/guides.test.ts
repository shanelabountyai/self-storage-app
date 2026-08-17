import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GUIDES,
  guideBySlug,
  guideCtaHref,
  guideFilterLabel,
  guidePath,
  hubEntries,
  SIZE_GUIDE_ENTRY,
} from '../apps/web/lib/guides/catalog'
import { FEATURE_FILTERS, SIZE_BANDS } from '../apps/web/lib/inventory/unit-filters'
import {
  articleJsonLd,
  DESCRIPTION_HARD_MAX,
  faqPageJsonLd,
  isCanonicalSlug,
} from '../packages/core/marketing'

// PRD 04 §3.2 US-4 AC2/AC3 (B-082 part 3). The guides catalog and the Article
// markup built from it.

const CONTENT_DIR = join(import.meta.dirname, '../apps/web/content/guides')

describe('the guides catalog', () => {
  it('ships AC2 launch set of five, counting the size guide that already existed', () => {
    // Four MDX guides plus `/storage/size-guide`, which is linked rather than
    // re-published (D-60). If somebody ever copies its text under /guides, this
    // count still passes — the assertion below about its href is the one that
    // would catch it.
    expect(hubEntries()).toHaveLength(5)
    expect(SIZE_GUIDE_ENTRY.href).toBe('/storage/size-guide')
    expect(hubEntries().filter((entry) => entry.external)).toHaveLength(1)
  })

  it('has a prose file for every guide, and no orphan prose', () => {
    // The route maps slugs to `import()` calls by hand, because a bundler needs
    // the specifiers written out. This is what catches a guide added to the
    // catalog with no words, or words with no catalog entry.
    const files = readdirSync(CONTENT_DIR)
      .filter((name) => name.endsWith('.mdx'))
      .map((name) => name.replace(/\.mdx$/, ''))
      .sort()
    expect(files).toEqual(GUIDES.map((guide) => guide.slug).sort())
  })

  it('gives every guide a canonical slug and a unique one', () => {
    for (const guide of GUIDES) {
      expect(isCanonicalSlug(guide.slug), `${guide.slug} is not a canonical slug`).toBe(true)
      expect(guidePath(guide)).toBe(`/guides/${guide.slug}`)
    }
    expect(new Set(GUIDES.map((guide) => guide.slug)).size).toBe(GUIDES.length)
  })

  it('resolves a known slug and refuses an unknown one', () => {
    expect(guideBySlug('climate-control')?.title).toContain('climate-controlled')
    expect(guideBySlug('no-such-guide')).toBeNull()
    // A path traversal in a URL segment must not resolve to anything.
    expect(guideBySlug('../../etc/passwd')).toBeNull()
  })

  it('keeps every description inside what a search result will render', () => {
    for (const guide of GUIDES) {
      expect(
        guide.description.length,
        `${guide.slug} description is ${guide.description.length} chars`,
      ).toBeLessThanOrEqual(DESCRIPTION_HARD_MAX)
      expect(guide.description.trim().length).toBeGreaterThan(0)
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
    expect(guideFilterLabel({})).toBeNull()
  })

  it('labels the filter with the same words the facility page control uses', () => {
    // A reader who follows the CTA should recognise where they landed.
    expect(guideFilterLabel({ size: 'medium' })).toBe(SIZE_BANDS.medium.label)
    expect(guideFilterLabel({ feature: 'climate' })).toBe(FEATURE_FILTERS.climate.label)
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

  it('emits FAQ markup only for the guides that have a real FAQ', () => {
    for (const guide of GUIDES) {
      const node = faqPageJsonLd(guide.faqs)
      if (guide.faqs.length >= 2) {
        expect(node, `${guide.slug} should carry FAQPage markup`).not.toBeNull()
      } else {
        // A one-question FAQPage is the shape Google ignores, and zero
        // questions marked up as an FAQ is a claim about a section that is not
        // on the page.
        expect(node, `${guide.slug} should carry no FAQPage markup`).toBeNull()
      }
    }
  })

  it('answers every question it asks', () => {
    for (const guide of GUIDES) {
      for (const faq of guide.faqs) {
        expect(faq.question.trim().endsWith('?'), `${guide.slug}: "${faq.question}"`).toBe(true)
        expect(faq.answer.trim().length).toBeGreaterThan(40)
      }
    }
  })
})

describe('guide prose', () => {
  const files = readdirSync(CONTENT_DIR).filter((name) => name.endsWith('.mdx'))

  it.each(files)('%s starts its headings at level two', (name) => {
    // The page frame renders the guide title as the only `h1`. A `#` in the
    // markdown would produce a second one, which is a 1.3.1 failure that axe
    // does not always report, and it would break the document outline of every
    // guide at once because they share one component mapping.
    const source = readFileSync(join(CONTENT_DIR, name), 'utf8')
    expect(source).not.toMatch(/^# /m)
    // And there has to BE a heading — a guide that is one long block of prose
    // is one nobody can skim or navigate by rotor.
    expect(source).toMatch(/^## /m)
  })

  it.each(files)('%s uses only relative links to this site', (name) => {
    // An absolute link to our own domain hard-codes the origin, which
    // `siteOrigin()` exists to own; a `http://` link anywhere is a mixed-content
    // warning waiting for the first time somebody writes one.
    const source = readFileSync(join(CONTENT_DIR, name), 'utf8')
    for (const [, href] of source.matchAll(/\]\(([^)]+)\)/g)) {
      expect(href.startsWith('http://'), `${name} links to ${href} over http`).toBe(false)
      expect(
        href.includes('localhost'),
        `${name} links to ${href}, which only resolves on a laptop`,
      ).toBe(false)
    }
  })
})
