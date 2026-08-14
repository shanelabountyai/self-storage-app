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
