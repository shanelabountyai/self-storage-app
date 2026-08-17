import type { FaqEntry } from '@storage/core/marketing'
import {
  FEATURE_FILTERS,
  SIZE_BANDS,
  type FeatureKey,
  type SizeBand,
} from '@/lib/inventory/unit-filters'

// PRD 04 §3.2 US-4 AC2/AC3 (B-082 part 3). The content hub's index of guides.
//
// The split this file exists to make: a guide's PROSE lives in
// `content/guides/{slug}.mdx`, and everything a machine reads about it lives
// here, typed. `Article` JSON-LD needs a headline, a description and two dates;
// frontmatter would let a guide ship without them and fail silently as absent
// markup, whereas a missing field here is a build error.
//
// It also means the CTA a guide carries (AC3) is checked. `size` and `feature`
// are the real filter vocabularies from `unit-filters`, so a guide cannot point
// a reader at `?size=extra-large` — a URL that renders a page with the filter
// quietly ignored, which is indistinguishable from a working link until
// somebody counts conversions.

/// AC3's "contextual CTA": the filter this guide's advice lands on.
///
/// Both optional and both typed. A guide about packing has no filter to offer
/// and says so by carrying neither, rather than by pointing at a default.
export type GuideFilter = { size?: SizeBand; feature?: FeatureKey }

export type Guide = {
  slug: string
  title: string
  /// One string for the meta description, the hub card and the `Article`
  /// description. Two would drift, and the card is what a reader judges the
  /// guide by before a search snippet ever renders.
  description: string
  /// ISO dates. `updated` is what `Article.dateModified` reports, so it is
  /// changed by hand when the words change — a build timestamp would tell a
  /// crawler every guide changed on every deploy.
  published: string
  updated: string
  filter: GuideFilter
  /// The sentence above the CTA button. Written per guide because "Find
  /// storage near you" under every one of them is the CTA a reader stops
  /// seeing.
  ctaLabel: string
  /// US-4 AC3's `FAQPage` "where appropriate" — present only where the guide
  /// genuinely answers repeated questions. `faqPageJsonLd` refuses fewer than
  /// two, so a guide with one question emits no markup rather than a
  /// single-question FAQPage, which is the shape Google ignores.
  faqs: FaqEntry[]
}

export const GUIDES: Guide[] = [
  {
    slug: 'what-fits-in-a-10x10',
    title: 'What fits in a 10x10 storage unit?',
    description:
      'A 10x10 holds about a one-bedroom apartment — sofa, mattress set, appliances and boxes, with room to walk in. Here is what that means in practice.',
    published: '2026-08-17',
    updated: '2026-08-17',
    filter: { size: 'medium' },
    ctaLabel: 'See medium units near you',
    faqs: [
      {
        question: 'Is a 10x10 big enough for a two-bedroom home?',
        answer:
          'Usually not, if you mean everything in it. A 10x10 takes a one-bedroom comfortably and a small two-bedroom if you are willing to stack and leave the larger furniture behind. For a full two-bedroom, a 10x15 is the size that stops being a puzzle.',
      },
      {
        question: 'Can I get a car into a 10x10?',
        answer:
          'No. A 10x10 is ten feet deep and almost every car is longer than that. A 10x20 is the smallest size that takes a car, and it leaves room to walk around it.',
      },
      {
        question: 'How tall is a 10x10 unit?',
        answer:
          'Usually eight feet, which is why the floor area understates what a unit holds — stacking to shoulder height roughly doubles what you fit. The ceiling height for each size is listed on the facility page where it differs.',
      },
    ],
  },
  {
    slug: 'moving-checklist',
    title: 'A moving checklist that starts four weeks out',
    description:
      'What to do four weeks, one week and one day before a move, in the order that stops you paying for a second van. Written for a move that involves storage.',
    published: '2026-08-17',
    updated: '2026-08-17',
    filter: { size: 'large' },
    ctaLabel: 'Find a unit for moving day',
    faqs: [],
  },
  {
    slug: 'packing-tips',
    title: 'How to pack a storage unit so you can get to things',
    description:
      'Heavy low, light high, a walkway down the middle, and labels facing out. The handful of decisions that separate a unit you can use from a wall of boxes.',
    published: '2026-08-17',
    updated: '2026-08-17',
    filter: {},
    ctaLabel: 'Find storage near you',
    faqs: [],
  },
  {
    slug: 'climate-control',
    title: 'Do you need a climate-controlled unit?',
    description:
      'Climate control costs more every month. What it actually protects, what it does not, and how to tell which of your things care.',
    published: '2026-08-17',
    updated: '2026-08-17',
    filter: { feature: 'climate' },
    ctaLabel: 'See climate-controlled units near you',
    faqs: [
      {
        question: 'Is climate control the same as air conditioning?',
        answer:
          'Not quite. A climate-controlled unit is held inside a temperature range and, at most facilities, a humidity range — it is not cooled to a comfortable working temperature. It will be warmer than your house in August and colder in January, just never at the extremes that damage things.',
      },
      {
        question: 'Does climate control stop mould?',
        answer:
          'It removes the main cause, which is humidity swinging up and condensing on cold surfaces. It cannot help anything that goes in damp. Anything stored wet — a mattress, a rug, a coat — will grow mould in any unit, and the fix is drying it before it goes in, not paying more for the space.',
      },
      {
        question: 'What actually needs climate control?',
        answer:
          'Wood furniture, anything upholstered, electronics, photographs, documents, vinyl records, musical instruments, and anything with glue in it. Garden tools, car parts, plastic bins of clothing and most household clutter do not.',
      },
    ],
  },
]

const BY_SLUG = new Map(GUIDES.map((guide) => [guide.slug, guide]))

export function guideBySlug(slug: string): Guide | null {
  return BY_SLUG.get(slug) ?? null
}

export function guidePath(guide: { slug: string }): string {
  return `/guides/${guide.slug}`
}

/// AC3: the CTA link, built from the typed filter.
///
/// It points at the SEARCH, not at a facility, because "nearest facility"
/// requires a location nobody has given us on a guide page — the same reason
/// the city page prints no distance (D-59). The search carries the filter
/// through to whichever facility the reader picks, so the facility page opens
/// already filtered to the size or feature the guide recommended.
export function guideCtaHref(filter: GuideFilter): string {
  const params = new URLSearchParams()
  if (filter.size) params.set('size', filter.size)
  if (filter.feature) params.set('features', filter.feature)
  const query = params.toString()
  return query ? `/storage/search?${query}` : '/storage/search'
}

/// What the CTA is promising, in words, for the sentence beside the button.
///
/// Read from the same catalogues the filters themselves use, so the guide says
/// "Medium (5×10 to 10×10)" exactly as the facility page's filter control does
/// — a reader who follows this link should recognise where they landed.
export function guideFilterLabel(filter: GuideFilter): string | null {
  if (filter.size) return SIZE_BANDS[filter.size].label
  if (filter.feature) return FEATURE_FILTERS[filter.feature].label
  return null
}

export type HubEntry = {
  title: string
  description: string
  href: string
  /// True for the size guide, which is not an MDX guide and does not live
  /// under /guides — see the note in the hub page.
  external: boolean
}

/// PRD 04 US-4 AC2's launch set: five guides.
///
/// The size guide is the fifth and it is NOT re-published here. It has lived at
/// `/storage/size-guide` since B-016, is in the sitemap, and is linked from the
/// facility page, the search page and every city page. Copying its text under
/// `/guides/` to make the set look uniform would manufacture exactly the
/// duplicate content this row's part 6 exists to warn about — so the hub links
/// to where it already is. See D-60.
export const SIZE_GUIDE_ENTRY: HubEntry = {
  title: 'What size storage unit do I need?',
  description:
    'Every size we rent, with a real-world comparison for each — from a large closet to a two-car garage.',
  href: '/storage/size-guide',
  external: true,
}

export function hubEntries(): HubEntry[] {
  return [
    SIZE_GUIDE_ENTRY,
    ...GUIDES.map((guide) => ({
      title: guide.title,
      description: guide.description,
      href: guidePath(guide),
      external: false,
    })),
  ]
}
