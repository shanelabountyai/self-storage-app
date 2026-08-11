// The `2026-08` URL segment both statement screens take.
//
// Its own module because it is parsed at a trust boundary — the value comes
// straight out of a URL — and because the portal and the admin must agree on
// what a valid period is. A month of 13 or a year of 0 would otherwise reach
// `monthBounds` and produce a silently wrong window rather than a 404.

export function parseStatementPeriod(segment: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(segment)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  // Bounded rather than merely positive: nothing in this system has a lease
  // before 2000, and a four-digit year is all the URL shape allows anyway.
  if (year < 2000 || year > 2200) return null

  return { year, month }
}

/// The inverse, so links are built in one place too.
export function statementPeriodSegment(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}
