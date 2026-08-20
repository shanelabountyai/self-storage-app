import { describe, expect, it } from 'vitest'
import {
  canonicalDimension,
  citySizeDescription,
  citySizeIntro,
  citySizeTitle,
  dimensionKey,
  dimensionSpoken,
  pageKind,
  parseDimension,
  sizeFacts,
  sizeFromRateCents,
  sizeIndexGate,
  UNIT_SIZES,
  UNIT_SIZE_ORDER,
  type SizeFacilitySummary,
} from '../packages/core/marketing'

// PRD 00 §6 Phase 3 (B-089), D-77. The per-city/size landing pages.
//
// The gate is the part worth testing hardest: it decides whether a generated
// page is offered to a search index, and both of its failure modes are silent.
// Too strict and pages built to rank are never indexed; too loose and the site
// publishes the thin content B-128 was created to fix, by the dozen.

function facility(overrides: Partial<SizeFacilitySummary> = {}): SizeFacilitySummary {
  return { name: 'Demo Austin South', webRateCents: 12900, availableCount: 6, ...overrides }
}

/// Intros for a city that has these sizes, all from the same facility set —
/// which is the realistic case and the hardest one for the gate, because every
/// page shares its second paragraph's shape.
function introsFor(dimensions: string[], facilities = [facility()]) {
  return new Map(
    dimensions.map((dimension) => {
      const { widthFt, lengthFt } = parseDimension(dimension)!
      return [dimension, citySizeIntro(widthFt, lengthFt, 'Austin', 'TX', facilities)]
    }),
  )
}

describe('the URL a size page lives at', () => {
  it('accepts only the canonical spelling as a page', () => {
    expect(parseDimension('10x10')).toEqual({ widthFt: 10, lengthFt: 10 })
    // Each of these would otherwise be a second URL for one page.
    expect(parseDimension('10X10')).toBeNull()
    expect(parseDimension('10 x 10')).toBeNull()
    expect(parseDimension('010x10')).toBeNull()
    expect(parseDimension('0x10')).toBeNull()
    expect(parseDimension('10x10x10')).toBeNull()
    expect(parseDimension('../../etc')).toBeNull()
  })

  it('salvages the recoverable spellings so they can be redirected', () => {
    for (const input of ['10X10', '10 x 10', '10×10', ' 10 X 10 ']) {
      expect(canonicalDimension(input)).toBe('10x10')
    }
    expect(canonicalDimension('not-a-size')).toBeNull()
  })

  it('sits behind a literal `size` segment, out of the facility slug namespace', () => {
    // The reason the segment exists: at four segments a dimension would share a
    // namespace with every facility slug an operator can type, and Next.js
    // would resolve the collision silently.
    expect(pageKind('/storage/tx/austin/size/10x10')).toBe('city_size')
    expect(pageKind('/storage/tx/austin/demo-austin-south')).toBe('facility')
    expect(pageKind('/storage/tx/austin')).toBe('city')
  })

  it('keys a size the same way everywhere', () => {
    expect(dimensionKey(10, 15)).toBe('10x15')
    expect(UNIT_SIZE_ORDER).toContain('10x15')
    // The catalogue's own square footage has to agree with the dimensions, or
    // the page prints one number and the guide another.
    for (const [key, facts] of Object.entries(UNIT_SIZES)) {
      const parsed = parseDimension(key)!
      expect(facts.sqFt).toBe(parsed.widthFt * parsed.lengthFt)
    }
  })
})

describe('what the page says', () => {
  it('gives a screen reader a size rather than a multiplication', () => {
    // `×` is announced as "times" with the unit dropped, so "10 × 20" becomes
    // "10 times 20" — not a size. The size guide already rendered the compact
    // form `aria-hidden` beside this sentence; B-089's pages use the same
    // function rather than a third treatment of the same problem.
    expect(dimensionSpoken(10, 20)).toBe('10 foot by 20 foot')
  })

  it('leads with the size, because that is what the query carries', () => {
    expect(citySizeTitle(10, 10, 'Austin', 'tx')).toBe('10 × 10 Storage Units in Austin, TX')
  })

  it('never prints a price when nothing of that size is rentable', () => {
    const full = [facility({ webRateCents: null, availableCount: 0 })]
    expect(sizeFromRateCents(full)).toBeNull()
    const intro = citySizeIntro(10, 10, 'Austin', 'TX', full).join(' ')
    expect(intro).toContain('every one of them is rented today')
    expect(intro).not.toContain('$')
    expect(citySizeDescription(10, 10, 'Austin', 'TX', full)).not.toContain('$')
  })

  it('takes the cheapest rentable rate, never a zero', () => {
    expect(
      sizeFromRateCents([
        facility({ webRateCents: 0 }),
        facility({ webRateCents: 15900 }),
        facility({ webRateCents: 12900 }),
      ]),
    ).toBe(12900)
  })

  it('shows scarcity only when it is real and low', () => {
    // US-201's rule. A comfortable number is not printed at all — "14
    // available" invites waiting.
    expect(citySizeIntro(10, 10, 'Austin', 'TX', [facility({ availableCount: 2 })]).join(' ')).toContain(
      'There are 2 10 × 10 units left',
    )
    expect(citySizeIntro(10, 10, 'Austin', 'TX', [facility({ availableCount: 1 })]).join(' ')).toContain(
      'There is one 10 × 10 left',
    )
    expect(
      citySizeIntro(10, 10, 'Austin', 'TX', [facility({ availableCount: 14 })]).join(' '),
    ).not.toContain('left in')
  })

  it('carries the size-specific facts that make it worth publishing', () => {
    const intro = citySizeIntro(10, 10, 'Austin', 'TX', [facility()]).join(' ')
    expect(intro).toContain('100 square feet')
    expect(intro).toContain(sizeFacts(10, 10)!.comparison)
  })

  it('says only the measurement for a size the guide does not cover', () => {
    // Deliberately not padded with a generic sentence: filler repeated across
    // every unlisted size pushes those pages TOWARDS each other, which is the
    // opposite of what that paragraph is for.
    expect(sizeFacts(8, 12)).toBeNull()
    const intro = citySizeIntro(8, 12, 'Austin', 'TX', [facility()])
    expect(intro[0]).toBe('A 8 × 12 unit is 96 square feet.')
  })
})

describe('the index gate (D-77)', () => {
  it('passes the standard sizes against each other in one city', () => {
    // The case the whole item rests on. Every one of these pages describes the
    // same facility at the same price and differs only in size — if the gate
    // fails here, the generated copy is not doing its job and the pages should
    // not be published.
    const intros = introsFor(['5x10', '10x10', '10x15', '10x20'])
    for (const dimension of intros.keys()) {
      const gate = sizeIndexGate(dimension, intros)
      expect(gate.indexable, `${dimension} was gated`).toBe(true)
    }
  })

  it('refuses a page whose intro is a near-copy of a sibling', () => {
    const intros = new Map([
      ['10x10', ['We have 10 × 10 units at one location in Austin, TX, from $129 a month.']],
      ['10x15', ['We have 10 × 15 units at one location in Austin, TX, from $129 a month.']],
    ])
    const gate = sizeIndexGate('10x10', intros)
    expect(gate.indexable).toBe(false)
    // Names the sibling, so the report can say which page to fix rather than
    // "this one is a duplicate of something".
    expect(gate.indexable === false && gate.against).toBe('10x15')
  })

  it('gates two sizes the guide catalogue does not cover, and that is correct', () => {
    // **Measured, not assumed: 0.94 against each other.** An unlisted size gets
    // the measurement sentence and nothing else, so two of them differ only in
    // three numbers and score far over the threshold — while the seven standard
    // sizes clear it at 0.74 because each carries its own comparison and
    // "typical" sentence.
    //
    // This is the gate doing its job, and it is also the trigger written into
    // B-134: a portfolio with non-standard unit types gets pages that exist,
    // serve visitors and are never indexed until somebody can write copy for
    // them. Pinned here so that a later change to the copy generator which
    // accidentally lets these through fails loudly rather than quietly
    // publishing them.
    const intros = introsFor(['8x12', '8x16'])
    expect(sizeIndexGate('8x12', intros).indexable).toBe(false)
    expect(sizeIndexGate('8x16', intros).indexable).toBe(false)
  })

  it('keeps the standard sizes clear of the threshold with real margin', () => {
    // 0.738 at the worst pair (10×15 vs 10×30) against a 0.8 threshold. Pinned
    // as a ceiling rather than an exact value: copy edits are expected, a copy
    // edit that pushes these to the line is not.
    const intros = introsFor(['5x5', '5x10', '5x15', '10x10', '10x15', '10x20', '10x30'])
    for (const dimension of intros.keys()) {
      const gate = sizeIndexGate(dimension, intros)
      expect(gate.indexable && gate.closest, `${dimension}`).toBeLessThan(0.78)
    }
  })

  it('refuses a page with no intro at all', () => {
    // The purest thin content there is, and it must not pass for the accidental
    // reason that it resembles nothing.
    expect(sizeIndexGate('10x10', new Map([['10x10', []]])).indexable).toBe(false)
  })

  it('passes the only size in a city', () => {
    const gate = sizeIndexGate('10x10', introsFor(['10x10']))
    expect(gate).toEqual({ indexable: true, closest: 0 })
  })

  it('compares against siblings only, never against a differently-shaped page', () => {
    // `findDuplicatePairs`' own rule — pairwise within a kind. A gate that
    // scored a two-paragraph size intro against a city intro would pass for
    // reasons of length rather than content.
    const intros = introsFor(['10x10', '10x20'])
    const gate = sizeIndexGate('10x10', intros)
    expect(gate.indexable).toBe(true)
    expect(gate.indexable === true && gate.closest).toBeLessThan(0.8)
  })
})
