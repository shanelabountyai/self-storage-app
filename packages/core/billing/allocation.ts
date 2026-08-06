// PRD 02 US-22 (B-048). Where a partial payment goes.
//
// "Allocation order is configurable per facility (default: taxes → fees →
// insurance → oldest rent first)." That default is not arbitrary and is worth
// keeping in view when someone proposes changing it: tax is money the operator
// is holding for the state rather than earning, so it comes off first; fees
// clear next because an unpaid fee is what ages into the next fee; and rent is
// last because rent is the thing the lien process is actually about, so it is
// the balance an operator wants visible longest.
//
// Pure. This decides where a real person's money went, and it has to be
// answerable to them line by line.

export const ALLOCATION_CATEGORIES = ['tax', 'fee', 'protection', 'rent'] as const
export type AllocationCategory = (typeof ALLOCATION_CATEGORIES)[number]

/// Texas practice, and the PRD's own default. "insurance" in US-22's wording is
/// the protection premium — the word the schema and the customer-facing copy
/// both avoid, deliberately (US-44).
export const DEFAULT_ALLOCATION_ORDER: readonly AllocationCategory[] = [
  'tax',
  'fee',
  'protection',
  'rent',
]

export function isAllocationCategory(value: string): value is AllocationCategory {
  return (ALLOCATION_CATEGORIES as readonly string[]).includes(value)
}

/// One claim on a payment: what is owed, on which invoice, in which category.
export type AllocationTarget = {
  invoiceId: string
  category: AllocationCategory
  outstandingCents: number
  /// The invoice's ORIGINAL due date. Within a category the oldest is paid
  /// first — "oldest rent first" in US-22's own words, and the same anchoring
  /// rule the rest of the billing engine uses (D-25).
  dueDate: Date
}

export type AllocationLine = {
  invoiceId: string
  category: AllocationCategory
  amountCents: number
}

export type AllocationResult = {
  lines: AllocationLine[]
  /// Money left after every claim is satisfied. Never negative.
  ///
  /// Non-zero means the payer handed over more than they owe. This function
  /// does NOT invent somewhere to put it — an over-payment is a decision
  /// (refuse it, hold it as a credit, refund it) and the caller makes it. A
  /// silent allocation to "the oldest thing" is how money ends up somewhere
  /// nobody can explain.
  unappliedCents: number
}

/// Splits a payment across what is owed, in the facility's configured order.
///
/// Within a category, oldest due date first, then by invoice id so the result
/// is stable for a given input — two invoices due the same day must not
/// allocate differently between two runs, or a receipt reprinted tomorrow
/// disagrees with the one the tenant was handed.
export function allocatePayment(
  amountCents: number,
  targets: readonly AllocationTarget[],
  order: readonly AllocationCategory[] = DEFAULT_ALLOCATION_ORDER,
): AllocationResult {
  if (amountCents <= 0) return { lines: [], unappliedCents: Math.max(0, amountCents) }

  const rank = new Map(order.map((category, index) => [category, index]))
  const claims = targets
    .filter((target) => target.outstandingCents > 0)
    // A category the facility left out of its order is paid LAST rather than
    // never: dropping it would quietly make that money uncollectable, and a
    // misconfigured order should degrade to a worse sequence, not a black hole.
    .sort((a, b) => {
      const byCategory =
        (rank.get(a.category) ?? order.length) - (rank.get(b.category) ?? order.length)
      if (byCategory !== 0) return byCategory
      const byDate = a.dueDate.getTime() - b.dueDate.getTime()
      return byDate !== 0 ? byDate : a.invoiceId.localeCompare(b.invoiceId)
    })

  const lines: AllocationLine[] = []
  let remaining = amountCents

  for (const claim of claims) {
    if (remaining <= 0) break
    const applied = Math.min(remaining, claim.outstandingCents)
    lines.push({ invoiceId: claim.invoiceId, category: claim.category, amountCents: applied })
    remaining -= applied
  }

  return { lines, unappliedCents: remaining }
}

/// The allocation summed per invoice, which is the shape `PaymentAllocation`
/// stores — one row per (payment, invoice), because that constraint is what
/// makes a redelivered webhook idempotent.
export function byInvoice(lines: readonly AllocationLine[]): { invoiceId: string; amountCents: number }[] {
  const totals = new Map<string, number>()
  for (const line of lines) {
    totals.set(line.invoiceId, (totals.get(line.invoiceId) ?? 0) + line.amountCents)
  }
  return [...totals.entries()].map(([invoiceId, amountCents]) => ({ invoiceId, amountCents }))
}

/// US-22: "allocation is displayed at payment time and on the receipt."
///
/// Grouped by category rather than listed per invoice, because that is the
/// question a tenant asks — "what did my $200 pay for" — and a list of six
/// invoice numbers answers a different one.
export function describeAllocation(lines: readonly AllocationLine[]): { label: string; amountCents: number }[] {
  const labels: Record<AllocationCategory, string> = {
    tax: 'Tax',
    fee: 'Fees',
    protection: 'Protection plan',
    rent: 'Rent',
  }
  const totals = new Map<AllocationCategory, number>()
  for (const line of lines) {
    totals.set(line.category, (totals.get(line.category) ?? 0) + line.amountCents)
  }
  return ALLOCATION_CATEGORIES.filter((category) => (totals.get(category) ?? 0) > 0).map(
    (category) => ({ label: labels[category], amountCents: totals.get(category)! }),
  )
}
