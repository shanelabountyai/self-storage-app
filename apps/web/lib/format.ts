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
  const dollars = cents / 100
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`
}
