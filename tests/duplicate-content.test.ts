import { describe, expect, it } from 'vitest'
import {
  DUPLICATE_THRESHOLD,
  duplicateReport,
  findDuplicatePairs,
  similarity,
  type ContentItem,
} from '../packages/core/marketing'

// PRD 04 §7 Phase 2 (B-082 part 6). The site-wide duplicate check.

function item(overrides: Partial<ContentItem> & { key: string; text: string }): ContentItem {
  return {
    url: `/${overrides.key}`,
    label: overrides.key,
    kind: 'Facility page long descriptions',
    origin: 'authored',
    ...overrides,
  }
}

const AUSTIN =
  'Climate-controlled and drive-up storage a mile from downtown Austin, with gate access seven days a week and month-to-month rentals.'
/// The same sentence with the city swapped, which is the copy-paste that
/// actually happens and the reason exact-match detection is not enough.
const DALLAS =
  'Climate-controlled and drive-up storage a mile from downtown Dallas, with gate access seven days a week and month-to-month rentals.'
const DIFFERENT =
  'A small family-run site off the highway. Twelve units, a gravel drive, and the owner answers the phone himself most days.'

describe('finding duplicate pairs', () => {
  it('catches the same text with the city swapped', () => {
    const pairs = findDuplicatePairs([
      item({ key: 'austin', text: AUSTIN }),
      item({ key: 'dallas', text: DALLAS }),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].similarity).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD)
  })

  it('leaves genuinely different copy alone', () => {
    expect(
      findDuplicatePairs([
        item({ key: 'austin', text: AUSTIN }),
        item({ key: 'other', text: DIFFERENT }),
      ]),
    ).toEqual([])
  })

  it('never compares across kinds', () => {
    // A 155-character meta description and a 600-word page description score
    // low against each other for reasons of length rather than content, and the
    // pairs that surfaced would be noise — which is how a report gets ignored.
    const pairs = findDuplicatePairs([
      item({ key: 'a', text: AUSTIN, kind: 'Search-result descriptions' }),
      item({ key: 'b', text: AUSTIN, kind: 'Facility page long descriptions' }),
    ])
    expect(pairs).toEqual([])
  })

  it('orders each pair the same way round every time', () => {
    // Otherwise the report reshuffles itself between loads for no reason.
    const forwards = findDuplicatePairs([
      item({ key: 'zebra', label: 'Zebra', text: AUSTIN }),
      item({ key: 'apple', label: 'Apple', text: DALLAS }),
    ])
    const backwards = findDuplicatePairs([
      item({ key: 'apple', label: 'Apple', text: DALLAS }),
      item({ key: 'zebra', label: 'Zebra', text: AUSTIN }),
    ])
    expect(forwards[0].left.label).toBe('Apple')
    expect(backwards[0].left.label).toBe('Apple')
  })

  it('puts authored collisions before generated ones, whatever the score', () => {
    // Somebody pasting is both more surprising and more likely to be a mistake
    // than two templated pages resembling each other.
    const pairs = findDuplicatePairs([
      item({ key: 'g1', label: 'City A', text: AUSTIN, kind: 'City page intros', origin: 'generated' }),
      item({ key: 'g2', label: 'City B', text: AUSTIN, kind: 'City page intros', origin: 'generated' }),
      item({ key: 'a1', label: 'Facility A', text: AUSTIN }),
      item({ key: 'a2', label: 'Facility B', text: DALLAS }),
    ])
    expect(pairs).toHaveLength(2)
    // The generated pair is a perfect 1.0 and still sorts second.
    expect(pairs[0].bothGenerated).toBe(false)
    expect(pairs[1].bothGenerated).toBe(true)
    expect(pairs[1].similarity).toBeGreaterThan(pairs[0].similarity)
  })

  it('marks a pair generated only when BOTH sides are', () => {
    const pairs = findDuplicatePairs([
      item({ key: 'g', label: 'Generated', text: AUSTIN, origin: 'generated' }),
      item({ key: 'a', label: 'Authored', text: AUSTIN, origin: 'authored' }),
    ])
    // A generated page colliding with one somebody wrote is not "alike by
    // construction" — one of the two can actually be fixed.
    expect(pairs[0].bothGenerated).toBe(false)
  })

  it('ignores empty and whitespace-only text', () => {
    // Two facilities that have written nothing are not duplicates of each
    // other, and reporting them as such would bury every real finding.
    expect(
      findDuplicatePairs([
        item({ key: 'a', text: '' }),
        item({ key: 'b', text: '   ' }),
        item({ key: 'c', text: '\n' }),
      ]),
    ).toEqual([])
  })
})

describe('the report', () => {
  it('says how much was compared, so an empty result is reassuring', () => {
    // "Nothing found" and "we checked 41 pieces of text and found nothing" are
    // different claims, and only the second one means anything.
    const report = duplicateReport([
      item({ key: 'a', text: AUSTIN }),
      item({ key: 'b', text: DIFFERENT }),
    ])
    expect(report.pairs).toEqual([])
    expect(report.compared).toBe(2)
  })

  it('does not count empty text as compared', () => {
    const report = duplicateReport([item({ key: 'a', text: AUSTIN }), item({ key: 'b', text: '' })])
    expect(report.compared).toBe(1)
  })

  it('names kinds with only one item as unchecked rather than clean', () => {
    // "No duplicates in guides" and "there is only one guide" are different
    // statements. Rendering the first when the second is true tells somebody
    // their site is fine when nothing was compared.
    const report = duplicateReport([
      item({ key: 'a', text: AUSTIN, kind: 'Guide descriptions' }),
      item({ key: 'b', text: AUSTIN, kind: 'City page intros' }),
      item({ key: 'c', text: DALLAS, kind: 'City page intros' }),
    ])
    expect(report.singletons).toEqual(['Guide descriptions'])
  })

  it('is empty and honest for an empty corpus', () => {
    expect(duplicateReport([])).toEqual({ pairs: [], compared: 0, singletons: [] })
  })

  it('respects a caller-supplied threshold, on both sides of the score', () => {
    // The default is B-067's 0.8, chosen to sit above ordinary shared storage
    // vocabulary and below a copy-paste. A caller can tighten it; nothing in
    // the product loosens it, because loosening hides authored collisions too.
    //
    // Calibrated against the pair's own measured score rather than a guessed
    // constant — the first version of this test asserted a made-up 0.1 and
    // failed, because two genuinely unrelated sentences share fewer trigrams
    // than intuition suggests.
    const pair = [item({ key: 'a', text: AUSTIN }), item({ key: 'b', text: DALLAS })]
    const score = similarity(AUSTIN, DALLAS)
    expect(findDuplicatePairs(pair, score - 0.01)).toHaveLength(1)
    expect(findDuplicatePairs(pair, score + 0.01)).toEqual([])
  })
})
