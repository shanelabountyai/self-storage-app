import type { ReviewSource } from './catalog.ts'

// PRD 04 US-6 AC1/AC3 (B-071). The average shown on the page, and the gate on
// whether that average may ALSO be marked up as `aggregateRating` in the
// SelfStorage JSON-LD.
//
// These are two different questions with two different stakes. Showing "4.8
// (12 reviews)" on the page is ordinary content — wrong, it is a bad look.
// Emitting the same number as structured data invites Google to show it as a
// rich result in search, which is a claim to Google that the rating is
// genuine and independently sourced. Getting THAT wrong risks a manual action
// against the rich-result eligibility of the whole domain, not just this page.

export type AggregateRating = { ratingValue: number; reviewCount: number }

/// The page's own average, from whatever is visible. One decimal place — a
/// second decimal reads as more precision than five stars can carry.
export function aggregateRating(reviews: readonly { rating: number }[]): AggregateRating | null {
  if (reviews.length === 0) return null
  const sum = reviews.reduce((total, review) => total + review.rating, 0)
  return {
    ratingValue: Math.round((sum / reviews.length) * 10) / 10,
    reviewCount: reviews.length,
  }
}

/// PRD 04 US-6 AC3 / Open Question Q3, decided (see 07-decisions.md): "include
/// only when review sourcing meets Google's self-serving review policies."
///
/// A rating built from `manual_google`/`manual_other` reviews — staff
/// transcriptions of what Google (or somewhere else) already says — does not
/// qualify. Those reviews were authored on and verified by a DIFFERENT
/// platform; re-publishing them here and marking THIS page's copy up as an
/// `AggregateRating` is republishing third-party rating data as if this site
/// had independently collected it, which is exactly what Google's
/// structured-data policies for review snippets prohibit. It is also the
/// fastest way to a sitewide manual action, which is a cost no single
/// facility page is worth risking.
///
/// True only when EVERY review behind the average is `google_api` — collected
/// by this system directly from Google, per FR-REV-4 (Phase 3). Nothing
/// produces that source yet, so this function returns `false` today by
/// construction, not by a flag someone could flip early.
export function qualifiesForSchemaMarkup(reviews: readonly { source: ReviewSource }[]): boolean {
  return reviews.length > 0 && reviews.every((review) => review.source === 'google_api')
}
