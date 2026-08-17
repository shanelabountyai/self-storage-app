import { describe, expect, it } from 'vitest'
import {
  cityAmenities,
  cityDescription,
  cityFromRateCents,
  cityIntro,
  cityLabel,
  cityTitle,
  type CityFacilitySummary,
} from '../apps/web/lib/marketing/city-copy'
import { DESCRIPTION_IDEAL_MAX, TITLE_HARD_MAX } from '../packages/core/marketing'

// PRD 04 §3.2 US-4 AC1 (B-082 part 2). The generated city copy.

function facility(overrides: Partial<CityFacilitySummary> = {}): CityFacilitySummary {
  return {
    name: 'South Congress Storage',
    amenities: ['Climate controlled', 'Gated access'],
    fromWebRateCents: 12_900,
    ...overrides,
  }
}

describe('city labels and titles', () => {
  it('upper-cases the state however the URL spelled it', () => {
    expect(cityLabel('Austin', 'tx')).toBe('Austin, TX')
    expect(cityTitle('Fort Worth', 'TX')).toBe('Storage Units in Fort Worth, TX')
  })

  it('stays inside the length a search result renders', () => {
    // Not a style preference: a title past the hard maximum is one the
    // marketing profile editor would refuse to save (`titleAdvice`), and the
    // generated floor must never be worse than what a person is allowed to type.
    const long = cityTitle('Rancho Santa Margarita', 'CA')
    expect(long.length).toBeLessThanOrEqual(TITLE_HARD_MAX)
  })
})

describe('the from-price for a city', () => {
  it('is the lowest rate across every facility in it', () => {
    const rate = cityFromRateCents([
      facility({ fromWebRateCents: 12_900 }),
      facility({ fromWebRateCents: 5_900 }),
      facility({ fromWebRateCents: 22_900 }),
    ])
    expect(rate).toBe(5_900)
  })

  it('is null when nothing in the city is rentable, never zero', () => {
    // "$0/mo" on a landing page is a lie with a price tag on it, and the whole
    // reason `fromWebRateCents` is nullable rather than defaulted.
    expect(cityFromRateCents([facility({ fromWebRateCents: null })])).toBeNull()
    expect(cityFromRateCents([facility({ fromWebRateCents: 0 })])).toBeNull()
    expect(cityFromRateCents([])).toBeNull()
  })
})

describe('the meta description', () => {
  it('fits what a result actually shows', () => {
    const description = cityDescription('Austin', 'TX', [facility(), facility()])
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_IDEAL_MAX)
    expect(description).toContain('Austin, TX')
    expect(description).toContain('$129')
  })

  it('drops the price claim entirely when there is no price to make', () => {
    const description = cityDescription('Austin', 'TX', [facility({ fromWebRateCents: null })])
    expect(description).not.toContain('$')
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_IDEAL_MAX)
  })

  it('counts one location in the singular', () => {
    expect(cityDescription('Austin', 'TX', [facility()])).toContain('1 location')
    expect(cityDescription('Austin', 'TX', [facility(), facility()])).toContain('2 locations')
  })
})

describe('the intro copy', () => {
  it('names every facility in the city', () => {
    const paragraphs = cityIntro('Austin', 'TX', [
      facility({ name: 'South Congress Storage' }),
      facility({ name: 'Riverside Self Storage' }),
      facility({ name: 'Airport Boulevard Storage' }),
    ])
    const text = paragraphs.join(' ')
    expect(text).toContain('3 storage facilities in Austin, TX')
    // `Intl.ListFormat` rather than a hand-rolled join, so the serial comma and
    // the two-item case are the platform's problem and not ours.
    expect(text).toContain(
      'South Congress Storage, Riverside Self Storage, and Airport Boulevard Storage',
    )
  })

  it('reads as a sentence when there is exactly one', () => {
    const text = cityIntro('Austin', 'TX', [facility()]).join(' ')
    expect(text).toContain('We have one storage facility in Austin, TX')
    expect(text).not.toContain('1 storage facilities')
  })

  it('differs between two cities with different facilities', () => {
    // AC1 asks for "unique intro copy per city". Generated is not the same as
    // identical — if these two ever matched, the page would be the templated
    // thin content the requirement exists to prevent.
    const austin = cityIntro('Austin', 'TX', [facility({ name: 'A', fromWebRateCents: 5_900 })])
    const dallas = cityIntro('Dallas', 'TX', [
      facility({ name: 'B', fromWebRateCents: 13_900 }),
      facility({ name: 'C', fromWebRateCents: 17_900 }),
    ])
    expect(austin.join(' ')).not.toBe(dallas.join(' '))
  })

  it('says the city is full rather than quoting a price it does not have', () => {
    const text = cityIntro('Austin', 'TX', [facility({ fromWebRateCents: null })]).join(' ')
    expect(text).toContain('rented right now')
    expect(text).not.toContain('$')
  })

  it('is empty for a city with no facilities', () => {
    // The page 404s in that case (AC1); copy for it would never render, and
    // generating any would be a page that says "we have 0 facilities".
    expect(cityIntro('Austin', 'TX', [])).toEqual([])
  })
})

// B-128 / D-62. The authored half.
describe('authored city intro copy', () => {
  it('replaces the generated copy entirely rather than being appended to it', () => {
    // Half-generated, half-written would put a templated sentence somebody did
    // not choose in the middle of a landing page they did — which is the
    // duplicate content the field exists to remove, still on the page.
    const paragraphs = cityIntro(
      'Austin',
      'TX',
      [facility()],
      'East Austin fills up first every August, which is when UT moves back in.',
    )
    expect(paragraphs).toEqual([
      'East Austin fills up first every August, which is when UT moves back in.',
    ])
    expect(paragraphs.join(' ')).not.toContain('We have one storage facility')
  })

  it('makes a blank line a paragraph, the way the textarea implies', () => {
    expect(
      cityIntro('Austin', 'TX', [facility()], 'First thing.\n\n  \n\nSecond thing.\n'),
    ).toEqual(['First thing.', 'Second thing.'])
  })

  it('falls back to the generated copy when the field is empty or whitespace', () => {
    // "Clear the box to go back" is a claim the editor makes to the operator,
    // so it is the behaviour worth pinning: a blank field must never publish a
    // city page with no words on it.
    for (const authored of [null, undefined, '', '   \n\n  ']) {
      const text = cityIntro('Austin', 'TX', [facility()], authored).join(' ')
      expect(text).toContain('We have one storage facility in Austin, TX')
    }
  })

  it('still renders nothing for a city with no facilities, however much was written', () => {
    // That city 404s. Prose about no locations is the thin content AC1's
    // indexability rule is there to keep out of the index.
    expect(cityIntro('Austin', 'TX', [], 'Anything at all.')).toEqual([])
  })
})

describe('the amenity list', () => {
  it('de-duplicates across facilities, case-insensitively, keeping first spelling', () => {
    const amenities = cityAmenities([
      facility({ amenities: ['Climate controlled', 'Gated access'] }),
      facility({ amenities: ['climate controlled', '  ', 'Drive-up units'] }),
    ])
    expect(amenities).toEqual(['Climate controlled', 'Gated access', 'Drive-up units'])
  })

  it('drops whitespace-only entries an operator typed', () => {
    expect(cityAmenities([facility({ amenities: ['', '   '] })])).toEqual([])
  })
})
