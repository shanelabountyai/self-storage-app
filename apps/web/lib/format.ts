const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/// Money is stored as integer cents everywhere (CLAUDE.md); this is the one
/// place it becomes a dollar string for display.
export function formatCents(cents: number): string {
  return currency.format(cents / 100)
}

/// The customer-facing form: whole dollars unless the rate genuinely has cents,
/// which street rates rarely do. "$129/mo" reads better than "$129.00/mo".
///
/// Separate from `formatCents` on purpose — an admin editing a rate needs to see
/// the cents, a renter comparing four facilities does not. It lives here rather
/// than in a page so that the search results and the facility page cannot drift
/// into showing the same unit at "$129" and "$129.00" one click apart.
export function formatRate(cents: number): string {
  // The sign goes outside the dollar mark. `$-64.50` is what you get from
  // formatting the signed number directly, and it reads as a typo on the one
  // kind of line where being unambiguous matters most — a discount, a credit or
  // a refund.
  const dollars = Math.abs(cents) / 100
  return `${cents < 0 ? '-' : ''}$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`
}

/// B-173. A `yyyy-mm-dd` calendar day written the way a person reads it.
///
/// UTC on purpose: these are `@db.Date` days, and `new Date('2026-09-05')`
/// rendered in a US timezone is Sep 4 — which, in a refusal whose whole job is
/// to name the date about to post, would name the wrong one.
export function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return iso
  return formatCalendarDate(date, { month: 'short', day: 'numeric', year: 'numeric' })
}

/// B-228. A date somebody typed into a `yyyy-mm-dd` field — a due date on an
/// agreement, a move-in day, a transfer day — is a CALENDAR DAY, not an
/// instant. `parseDate` stores it as UTC midnight, which is the same shape
/// `businessDateFor` produces for "the local day this happened on", so it has
/// to be read back in UTC: rendered through a US timezone it names the day
/// before, every time.
///
/// The portal dashboard did exactly that while the schedule one tap away did
/// not, so the same installment was due on 14 October and on 15 October at
/// once — and `graceEndsOn` derives from the same value, so a tenant who paid
/// on the day the schedule named could have their plan marked broken.
///
/// This is the one formatter every surface calls for such a date. Do NOT fix a
/// disagreement by handing one of them a timezone: the value has no time in it
/// to convert. `formatDay` above is the same rule for a `yyyy-mm-dd` string,
/// and delegates here.
export function formatCalendarDate(
  date: Date,
  options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' },
): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(date)
}
