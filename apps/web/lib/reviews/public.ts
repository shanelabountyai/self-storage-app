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
