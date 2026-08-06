// PRD 02 US-24 (B-049). The tenant ledger, and the reconciliation it has to
// satisfy.
//
// "A single chronological ledger per lease showing every charge, tax, payment,
// credit, refund, and write-off with running balance. AC: ledger totals always
// reconcile to invoice totals and reported AR."
//
// That AC is the whole item. A ledger a tenant can read and an AR figure a
// manager reports must be the same number arrived at two ways, and the moment
// they drift the operator stops trusting both — the same failure D-25 recorded
// for the metrics module. So the reconciliation is a function here, with a
// test, rather than a claim in a document.

export type LedgerEntryKind = 'charge' | 'payment' | 'credit' | 'refund' | 'adjustment' | 'write_off'

export type LedgerRow = {
  id: string
  kind: LedgerEntryKind
  description: string
  occurredAt: Date
  /// Signed cents, as stored: charges and refunds increase the balance;
  /// payments, credits and write-offs decrease it.
  amountCents: number
  invoiceNumber: string | null
}

export type LedgerLine = LedgerRow & {
  /// The balance after this entry. What the tenant reads down the right-hand
  /// side, and the reason the order below is not negotiable.
  balanceCents: number
}

/// Orders the ledger and computes the running balance.
///
/// Sorted by `occurredAt`, then by id. The tiebreak matters more than it looks:
/// a charge and the payment settling it are routinely written in the same
/// transaction with identical timestamps, and without a stable second key the
/// running balance would render in one order today and the other tomorrow —
/// producing a statement the tenant can hold up next to an older one and show
/// that they disagree.
///
/// Entries are never re-signed here. A `charge` of +1290 stays +1290: the
/// ledger is append-only (FR-8) and a screen that flipped signs to make a
/// column look tidy would be presenting something other than the record.
export function runningBalance(rows: readonly LedgerRow[]): LedgerLine[] {
  const ordered = [...rows].sort((a, b) => {
    const byTime = a.occurredAt.getTime() - b.occurredAt.getTime()
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
  })

  let balance = 0
  return ordered.map((row) => {
    balance += row.amountCents
    return { ...row, balanceCents: balance }
  })
}

export type LedgerTotals = {
  chargedCents: number
  paidCents: number
  creditedCents: number
  refundedCents: number
  writtenOffCents: number
  /// The closing balance — what the tenant owes. Equals the sum of every
  /// signed entry, which is also the last line's running balance.
  balanceCents: number
}

/// Totals by kind, plus the closing balance.
///
/// Payments, credits and write-offs are reported as POSITIVE magnitudes — a
/// statement saying "Payments: -$129.00" reads as a payment that went the wrong
/// way. The signed values stay in the rows; only the summary is turned round,
/// and the balance is still computed from the signs so the two cannot disagree.
export function ledgerTotals(rows: readonly LedgerRow[]): LedgerTotals {
  const totals: LedgerTotals = {
    chargedCents: 0,
    paidCents: 0,
    creditedCents: 0,
    refundedCents: 0,
    writtenOffCents: 0,
    balanceCents: 0,
  }

  for (const row of rows) {
    totals.balanceCents += row.amountCents
    switch (row.kind) {
      case 'charge':
        totals.chargedCents += row.amountCents
        break
      case 'payment':
        totals.paidCents += -row.amountCents
        break
      case 'credit':
        totals.creditedCents += -row.amountCents
        break
      case 'refund':
        // A refund increases the balance — the money went back. Reported as a
        // positive magnitude like the others, but it is not a reduction.
        totals.refundedCents += row.amountCents
        break
      case 'write_off':
        totals.writtenOffCents += -row.amountCents
        break
      case 'adjustment':
        // Deliberately in neither column: an adjustment can go either way and
        // bucketing it as a charge or a credit would be a guess. It is still in
        // the balance, which is what has to reconcile.
        break
    }
  }

  return totals
}

export type ReconciliationInput = {
  ledgerBalanceCents: number
  /// Sum of (total − paid) across the lease's open invoices — what the AR
  /// report and the ageing buckets are built on.
  invoiceOutstandingCents: number
  /// Charges posted to the ledger that no invoice accounts for. The move-in
  /// charge is the real example: B-026 posts it before invoicing exists.
  uninvoicedChargeCents: number
}

export type Reconciliation = {
  reconciles: boolean
  differenceCents: number
  /// Plain English for the screen, because a manager who sees a discrepancy
  /// needs to know whether it is expected before they ring anyone.
  explanation: string
}

/// US-24's acceptance criterion, as a function.
///
/// The ledger balance should equal what the invoices say is outstanding, PLUS
/// any charge posted straight to the ledger that never became an invoice. That
/// second term is not a fudge: a move-in charge (B-026) predates the billing
/// engine by design, and a system that called that a discrepancy would cry wolf
/// on every tenant who ever moved in.
///
/// Anything left after that is a real discrepancy and says so.
export function reconcile(input: ReconciliationInput): Reconciliation {
  const expected = input.invoiceOutstandingCents + input.uninvoicedChargeCents
  const difference = input.ledgerBalanceCents - expected

  if (difference === 0) {
    return {
      reconciles: true,
      differenceCents: 0,
      explanation: 'The ledger balance matches the invoices outstanding.',
    }
  }

  return {
    reconciles: false,
    differenceCents: difference,
    explanation:
      difference > 0
        ? 'The ledger shows more owed than the invoices account for. Something was charged to the ledger without an invoice behind it.'
        : 'The invoices show more owed than the ledger does. A payment may be posted against the wrong lease, or an invoice raised without its ledger charge.',
  }
}
