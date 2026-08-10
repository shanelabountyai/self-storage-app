import { describe, expect, it } from 'vitest'
import { validateReview } from '../packages/core/reviews/catalog'
import { aggregateRating, qualifiesForSchemaMarkup } from '../packages/core/reviews/aggregate'
import { reviewRequestDue } from '../packages/core/reviews/request'

// B-071 / PRD 04 §3.4, US-6, US-7.

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

function review(overrides: Partial<{ rating: number; text: string; reviewerDisplayName: string; reviewDate: Date }> = {}) {
  return {
    rating: 5,
    text: 'Great place, clean and easy.',
    reviewerDisplayName: 'John D.',
    reviewDate: d('2026-06-01'),
    ...overrides,
  }
}

describe('validateReview — FR-REV-2’s "text is never altered"', () => {
  it('accepts a complete review', () => {
    expect(validateReview(review(), d('2026-07-01'))).toEqual([])
  })

  it.each([0, 6, 3.5, -1])('refuses a rating of %s', (rating) => {
    expect(validateReview(review({ rating }), d('2026-07-01'))).not.toEqual([])
  })

  it('refuses blank text', () => {
    expect(validateReview(review({ text: '  ' }), d('2026-07-01'))).not.toEqual([])
  })

  it('refuses a blank reviewer name', () => {
    expect(validateReview(review({ reviewerDisplayName: '' }), d('2026-07-01'))).not.toEqual([])
  })

  it('refuses a review dated in the future', () => {
    expect(validateReview(review({ reviewDate: d('2026-08-01') }), d('2026-07-01'))).not.toEqual([])
  })

  it('reports every problem at once', () => {
    const problems = validateReview({ rating: 9, text: '', reviewerDisplayName: '', reviewDate: d('2026-06-01') }, d('2026-07-01'))
    expect(problems.length).toBeGreaterThanOrEqual(3)
  })
})

describe('aggregateRating — what the page shows', () => {
  it('averages to one decimal place', () => {
    expect(aggregateRating([{ rating: 5 }, { rating: 4 }, { rating: 4 }])).toEqual({
      ratingValue: 4.3,
      reviewCount: 3,
    })
  })

  it('is null with nothing to average', () => {
    expect(aggregateRating([])).toBeNull()
  })

  it('handles a single review', () => {
    expect(aggregateRating([{ rating: 3 }])).toEqual({ ratingValue: 3, reviewCount: 1 })
  })
})

describe('qualifiesForSchemaMarkup — US-6 AC3’s decision gate (D-33)', () => {
  it('NEVER qualifies a manually transcribed source', () => {
    expect(qualifiesForSchemaMarkup([{ source: 'manual_google' }])).toBe(false)
    expect(qualifiesForSchemaMarkup([{ source: 'manual_other' }])).toBe(false)
  })

  it('does not qualify a mix, even with real API reviews among them', () => {
    // "Sourced consistently" — one transcribed review in the mix means the
    // whole average is not independently verifiable.
    expect(qualifiesForSchemaMarkup([{ source: 'google_api' }, { source: 'manual_google' }])).toBe(false)
  })

  it('qualifies once every review is the verified API source', () => {
    // Unreachable in this codebase until FR-REV-4 (Phase 3) ships, and that is
    // the point — the gate does not need to be remembered to flip on later.
    expect(qualifiesForSchemaMarkup([{ source: 'google_api' }, { source: 'google_api' }])).toBe(true)
  })

  it('does not qualify an empty list', () => {
    expect(qualifiesForSchemaMarkup([])).toBe(false)
  })
})

describe('reviewRequestDue — US-7 AC1', () => {
  it('is not due before the delay has elapsed', () => {
    expect(reviewRequestDue(d('2026-07-01'), 7, d('2026-07-05'))).toBe(false)
  })

  it('is due exactly on the delay day', () => {
    expect(reviewRequestDue(d('2026-07-01'), 7, d('2026-07-08'))).toBe(true)
  })

  it('stays due after the delay day — a catch-up run still fires it', () => {
    expect(reviewRequestDue(d('2026-07-01'), 7, d('2026-07-20'))).toBe(true)
  })

  it('respects a facility’s own configured delay', () => {
    expect(reviewRequestDue(d('2026-07-01'), 14, d('2026-07-08'))).toBe(false)
    expect(reviewRequestDue(d('2026-07-01'), 14, d('2026-07-15'))).toBe(true)
  })
})
