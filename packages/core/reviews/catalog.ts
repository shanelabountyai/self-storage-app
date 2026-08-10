// PRD 04 §3.4 FR-REV-1 (B-071). The review entity's own rules.

export const REVIEW_SOURCES = ['manual_google', 'manual_other', 'google_api'] as const
export type ReviewSource = (typeof REVIEW_SOURCES)[number]

export const REVIEW_SOURCE_LABELS: Readonly<Record<ReviewSource, string>> = {
  manual_google: 'Transcribed from Google',
  manual_other: 'Transcribed from elsewhere',
  google_api: 'Google (verified)',
}

export type ReviewInput = {
  rating: number
  text: string
  reviewerDisplayName: string
  /// The date the review was actually posted (on Google, or wherever it came
  /// from) — not the date a staffer typed it in. Used for "recent reviews" and
  /// on-page dating.
  reviewDate: Date
}

export type ReviewProblem = { field: string; message: string }

/// FR-REV-2: "admin can hide (not edit) any review's display — text is never
/// altered." This is the only validation a review ever gets: once saved, the
/// content is immutable, so it has to be right going in.
export function validateReview(input: ReviewInput, now: Date = new Date()): ReviewProblem[] {
  const problems: ReviewProblem[] = []

  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    problems.push({ field: 'rating', message: 'Rating must be a whole number from 1 to 5.' })
  }
  if (!input.text.trim()) {
    problems.push({ field: 'text', message: 'The review needs its text.' })
  }
  if (!input.reviewerDisplayName.trim()) {
    problems.push({ field: 'reviewerDisplayName', message: 'Name the reviewer, as Google displayed it.' })
  }
  if (input.reviewDate.getTime() > now.getTime()) {
    problems.push({ field: 'reviewDate', message: 'A review cannot be dated in the future.' })
  }

  return problems
}
