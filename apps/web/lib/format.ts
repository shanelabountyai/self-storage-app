const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/// Money is stored as integer cents everywhere (CLAUDE.md); this is the one
/// place it becomes a dollar string for display.
export function formatCents(cents: number): string {
  return currency.format(cents / 100)
}
