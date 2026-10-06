// PRD 02 US-12 (B-438). A competitor price is only worth reading while it is
// recent, so a survey line older than this is flagged rather than hidden: an
// old number is still the last thing anybody knew.
export const SURVEY_STALE_DAYS = 30

/// Both arguments are business dates (UTC midnight, as `businessDateFor`
/// returns). Day 30 is still current; day 31 is stale.
export function isSurveyStale(observedOn: Date, today: Date): boolean {
  return Math.round((today.getTime() - observedOn.getTime()) / 86_400_000) > SURVEY_STALE_DAYS
}
