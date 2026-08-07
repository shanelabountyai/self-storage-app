import { describe, expect, it } from 'vitest'
import {
  breadcrumbJsonLd,
  defaultFacilityFaqs,
  facilityDescription,
  facilityTitle,
  faqPageJsonLd,
  formatPhone,
  formatStreetAddress,
  itemListJsonLd,
  openingHours,
  renderJsonLd,
  selfStorageJsonLd,
  telHref,
  truncateAtWord,
} from '../packages/core/marketing'
import type { WeeklySchedule } from '../packages/core/facility-settings/weekly-schedule'

// B-066 / PRD 04 FR-SEO-3, FR-SEO-4, FR-SEO-7.

const HOURS: WeeklySchedule = {
  monday: { closed: false, open: '09:00', close: '18:00' },
  tuesday: { closed: false, open: '09:00', close: '18:00' },
  wednesday: { closed: false, open: '09:00', close: '18:00' },
  thursday: { closed: false, open: '09:00', close: '18:00' },
  friday: { closed: false, open: '09:00', close: '18:00' },
  saturday: { closed: false, open: '10:00', close: '16:00' },
  sunday: { closed: true },
}

const FACILITY = {
  slug: 'south-congress',
  name: 'Austin — South Congress',
  addressLine1: '2400 South Congress Ave',
  addressLine2: 'Suite 200',
  city: 'Austin',
  state: 'TX',
  postalCode: '78704',
  phone: '512-555-0100',
  latitude: 30.2464,
  longitude: -97.7513,
  amenities: ['Climate control', 'Drive-up access'],
  officeHours: HOURS,
  gateHours: { ...HOURS, sunday: { closed: false, open: '06:00', close: '22:00' } } as WeeklySchedule,
}

const UNIT_TYPES = [
  { name: '10x10', sqFt: 100, webRateCents: 12_900, availableCount: 3, description: null },
  { name: '5x5', sqFt: 25, webRateCents: 5_900, availableCount: 0, description: null },
]

describe('NAP formatting — FR-SEO-7', () => {
  it('writes one address, the same way, everywhere', () => {
    expect(formatStreetAddress(FACILITY)).toBe(
      '2400 South Congress Ave, Suite 200, Austin, TX 78704',
    )
  })

  it('omits an absent second line rather than leaving a gap', () => {
    expect(formatStreetAddress({ ...FACILITY, addressLine2: null })).toBe(
      '2400 South Congress Ave, Austin, TX 78704',
    )
  })

  it('formats and dials a US number', () => {
    expect(formatPhone('512-555-0100')).toBe('(512) 555-0100')
    expect(formatPhone('(512) 555-0100')).toBe('(512) 555-0100')
    expect(telHref('512-555-0100')).toBe('+15125550100')
  })

  it('leaves a shape it does not recognise alone rather than mangling it', () => {
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958')
  })

  it('returns null rather than a tel: link that dials nothing', () => {
    // A call button that does nothing is worse than no call button: the renter
    // believes they tried.
    expect(telHref(null)).toBeNull()
    expect(formatPhone(null)).toBeNull()
  })
})

describe('meta templates — FR-SEO-3', () => {
  it('follows the PRD’s title template character for character', () => {
    expect(facilityTitle(FACILITY)).toBe(
      'Austin — South Congress | Storage Units in Austin, TX',
    )
  })

  it('keeps the description inside what search engines render', () => {
    expect(facilityDescription(FACILITY).length).toBeLessThanOrEqual(155)
    expect(facilityDescription(FACILITY, { lowestRate: '$59' })).toContain('$59')
  })

  it('truncates at a word, not mid-word', () => {
    const source = 'the quick brown fox jumps over the lazy dog'
    const cut = truncateAtWord(source, 20)

    expect(cut.length).toBeLessThanOrEqual(20)
    expect(cut.endsWith('…')).toBe(true)
    // The kept text is a whole number of words from the front — "the quick
    // brown…", never "the quick brow…".
    const kept = cut.slice(0, -1)
    expect(source.startsWith(kept)).toBe(true)
    expect(source[kept.length]).toBe(' ')
  })

  it('leaves text that already fits completely alone', () => {
    expect(truncateAtWord('short enough', 40)).toBe('short enough')
  })
})

describe('selfStorageJsonLd — FR-SEO-4', () => {
  const node = selfStorageJsonLd({
    facility: FACILITY,
    url: 'https://example.com/storage/tx/austin/south-congress',
    images: [],
    unitTypes: UNIT_TYPES,
  }) as Record<string, never>

  it('is a SelfStorage node with the canonical URL', () => {
    expect(node['@type']).toBe('SelfStorage')
    expect(node.url).toBe('https://example.com/storage/tx/austin/south-congress')
  })

  it('carries a PostalAddress built from the same record as the page', () => {
    expect(node.address).toMatchObject({
      '@type': 'PostalAddress',
      streetAddress: '2400 South Congress Ave, Suite 200',
      addressLocality: 'Austin',
      addressRegion: 'TX',
      postalCode: '78704',
    })
  })

  it('keeps office and gate hours as separate specs', () => {
    const specs = node.openingHoursSpecification as { name: string }[]
    expect(specs.some((spec) => spec.name === 'Office hours')).toBe(true)
    expect(specs.some((spec) => spec.name === 'Gate access hours')).toBe(true)
  })

  it('offers only what a renter could actually take', () => {
    const offers = node.makesOffer as { name: string; price: string }[]
    expect(offers).toHaveLength(1)
    expect(offers[0].name).toContain('10x10')
    expect(offers[0].price).toBe('129.00')
  })

  it('marks the price as monthly', () => {
    const offers = node.makesOffer as { priceSpecification: { unitCode: string } }[]
    // Without this a crawler reads "$129" as a one-off purchase price — a
    // different and much better-sounding offer than the one being made.
    expect(offers[0].priceSpecification.unitCode).toBe('MON')
  })

  it('never invents a rating', () => {
    // US-6 AC3 gates ratings to real verified reviews. A fabricated one is the
    // fastest route to a manual action against the whole domain.
    expect(node.aggregateRating).toBeUndefined()
  })

  it('omits geo entirely when coordinates are unknown', () => {
    const noGeo = selfStorageJsonLd({
      facility: { ...FACILITY, latitude: null, longitude: null },
      url: 'https://example.com/x',
      images: [],
      unitTypes: UNIT_TYPES,
    }) as Record<string, never>
    // Absent and empty are different claims. `geo: null` asserts the business
    // has no location.
    expect('geo' in noGeo).toBe(false)
  })

  it('omits telephone rather than asserting there is none', () => {
    const noPhone = selfStorageJsonLd({
      facility: { ...FACILITY, phone: null },
      url: 'https://example.com/x',
      images: [],
      unitTypes: UNIT_TYPES,
    }) as Record<string, never>
    expect('telephone' in noPhone).toBe(false)
  })

  it('omits makesOffer when nothing is available', () => {
    const soldOut = selfStorageJsonLd({
      facility: FACILITY,
      url: 'https://example.com/x',
      images: [],
      unitTypes: [{ ...UNIT_TYPES[0], availableCount: 0 }],
    }) as Record<string, never>
    expect('makesOffer' in soldOut).toBe(false)
  })
})

describe('openingHours', () => {
  it('omits closed days rather than emitting a zero-length window', () => {
    // `Monday 00:00–00:00` is read by some consumers as open all day, which
    // sends somebody to a locked office.
    const specs = openingHours(HOURS, 'Office hours')
    expect(specs).toHaveLength(6)
    expect(specs.some((spec) => String(spec.dayOfWeek).endsWith('Sunday'))).toBe(false)
  })

  it('returns nothing when hours are unconfigured', () => {
    expect(openingHours(null, 'Office hours')).toEqual([])
  })
})

describe('faqPageJsonLd', () => {
  it('marks up a genuine FAQ block', () => {
    const node = faqPageJsonLd([
      { question: 'When can I get in?', answer: 'Gate hours are 6am to 10pm.' },
      { question: 'Is it month to month?', answer: 'Yes.' },
    ]) as Record<string, never>
    expect(node['@type']).toBe('FAQPage')
    expect((node.mainEntity as unknown[]).length).toBe(2)
  })

  it('refuses to mark up a single question as a page-level FAQ', () => {
    expect(faqPageJsonLd([{ question: 'One?', answer: 'Yes.' }])).toBeNull()
  })

  it('ignores blank entries', () => {
    expect(
      faqPageJsonLd([
        { question: 'Real?', answer: 'Yes.' },
        { question: '  ', answer: 'orphan' },
      ]),
    ).toBeNull()
  })
})

describe('defaultFacilityFaqs — US-1 AC2', () => {
  it('produces at least five true answers', () => {
    const faqs = defaultFacilityFaqs(FACILITY)
    expect(faqs.length).toBeGreaterThanOrEqual(5)
    for (const entry of faqs) {
      expect(entry.question.trim()).toBeTruthy()
      expect(entry.answer.trim()).toBeTruthy()
    }
  })

  it('still produces five for a facility with no hours or amenities', () => {
    const bare = defaultFacilityFaqs({
      ...FACILITY,
      officeHours: null,
      gateHours: null,
      amenities: [],
      phone: null,
    })
    expect(bare.length).toBeGreaterThanOrEqual(5)
  })

  it('names the facility, so the answers are facility-specific', () => {
    expect(defaultFacilityFaqs(FACILITY)[0].question).toContain('Austin — South Congress')
  })
})

describe('lists and breadcrumbs', () => {
  it('numbers an ItemList from one', () => {
    const node = itemListJsonLd(
      [
        { name: 'A', url: 'https://example.com/a' },
        { name: 'B', url: 'https://example.com/b' },
      ],
      'Storage in Austin',
    ) as Record<string, never>
    const items = node.itemListElement as { position: number }[]
    expect(items[0].position).toBe(1)
    expect(items[1].position).toBe(2)
  })

  it('returns nothing for an empty list', () => {
    expect(itemListJsonLd([], 'Empty')).toBeNull()
  })

  it('needs at least two crumbs to be a trail', () => {
    expect(breadcrumbJsonLd([{ name: 'Home', url: 'https://example.com/' }])).toBeNull()
  })
})

describe('renderJsonLd', () => {
  it('escapes a closing script tag', () => {
    // Operator-supplied copy reaches this. Without the escape, a description
    // containing `</script>` closes the tag early and drops whatever follows
    // into the document as markup — an XSS hole wearing a structured-data hat.
    const rendered = renderJsonLd({ description: 'oops </script><img onerror=alert(1)>' })
    expect(rendered).not.toContain('</script>')
    expect(rendered).toContain('\\u003c/script')
  })

  it('renders nothing for a null node', () => {
    expect(renderJsonLd(null)).toBe('')
  })

  it('round-trips through JSON.parse', () => {
    const node = selfStorageJsonLd({
      facility: FACILITY,
      url: 'https://example.com/x',
      images: [],
      unitTypes: UNIT_TYPES,
    })
    expect(() => JSON.parse(renderJsonLd(node).replace(/\\u003c/g, '<'))).not.toThrow()
  })
})
