import { prisma } from '@storage/db'
import { aggregateRating, qualifiesForSchemaMarkup, type AggregateRating } from '@storage/core/reviews'

// PRD 04 US-6 (B-071). What the facility page reads.

export type PublicReview = {
  id: string
  rating: number
  text: string
  reviewerDisplayName: string
  reviewDate: Date
  sourceLabel: string
}

export type FacilityReviews = {
  average: AggregateRating | null
  reviews: PublicReview[]
  /// US-6 AC3's gate — see packages/core/reviews/aggregate.ts and D-33. Almost
  /// always `null` today: manually transcribed reviews never qualify, whatever
  /// the average says.
  schemaAggregateRating: AggregateRating | null
}

const SOURCE_LABELS: Record<string, string> = {
  manual_google: 'via Google',
  manual_other: 'via review',
  google_api: 'via Google',
}

/// PRD 04 US-4 AC1 (B-082 part 2): the city page shows a rating per facility.
///
/// One query for the whole list rather than `visibleReviewsForFacility` per row
/// — the same fan-out `lowestAvailableWebRateByFacility` exists to avoid. It
/// returns the average only: a city page shows the score, not the review text,
/// so reading every review's body to render one number would be waste.
///
/// A facility with no visible reviews is ABSENT from the map rather than
/// present with a zero. Nothing here is `schemaAggregateRating` — D-33's gate is
/// unchanged and a city page marks up no ratings at all.
export async function visibleRatingsByFacility(
  facilityIds: string[],
): Promise<Map<string, AggregateRating>> {
  if (facilityIds.length === 0) return new Map()

  const rows = await prisma.review.findMany({
    where: { facilityId: { in: facilityIds }, visible: true },
    select: { facilityId: true, rating: true },
  })

  const byFacility = new Map<string, { rating: number }[]>()
  for (const row of rows) {
    const bucket = byFacility.get(row.facilityId)
    if (bucket) bucket.push(row)
    else byFacility.set(row.facilityId, [row])
  }

  const ratings = new Map<string, AggregateRating>()
  for (const [facilityId, reviews] of byFacility) {
    // The same rounding the facility page uses, from the same function — two
    // pages one click apart showing 4.8 and 4.75 for one facility is the exact
    // drift this reuse prevents.
    const average = aggregateRating(reviews)
    if (average) ratings.set(facilityId, average)
  }
  return ratings
}

/// US-6 AC1: "average rating, review count, and the N most recent reviews."
/// Visible reviews only — a hidden one is exactly as absent from the average
/// as it is from the list, by the same flag.
export async function visibleReviewsForFacility(facilityId: string, limit = 5): Promise<FacilityReviews> {
  const rows = await prisma.review.findMany({
    where: { facilityId, visible: true },
    orderBy: [{ reviewDate: 'desc' }, { createdAt: 'desc' }],
  })

  return {
    average: aggregateRating(rows),
    schemaAggregateRating: qualifiesForSchemaMarkup(rows) ? aggregateRating(rows) : null,
    reviews: rows.slice(0, limit).map((row) => ({
      id: row.id,
      rating: row.rating,
      text: row.text,
      reviewerDisplayName: row.reviewerDisplayName,
      reviewDate: row.reviewDate,
      sourceLabel: SOURCE_LABELS[row.source] ?? '',
    })),
  }
}
