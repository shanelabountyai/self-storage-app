import { ledgerTotals, reconcile, type LedgerRow, type Reconciliation } from '../billing/ledger.ts'

// PRD 02 §4.6 US-27 (B-061). The itemized claim that goes on a lien notice.
//
// "The itemized claim on the notice reconciles to the ledger at generation
// time" is the acceptance criterion, and it is the whole reason this file is
// pure: the number a tenant is told they owe, on a document that precedes a
// sale of their belongings, has to be derivable from the record and provably
// equal to it. A claim assembled by a screen — summing whatever rows it
// happened to fetch — is one that can be wrong in a way nobody notices until
// it is read back in a deposition.
//
// Two separate checks, and they are not the same question:
//
//   1. Does the claim add up to the ledger balance? (`buildClaim`, below.)
//      An arithmetic identity over the rows we itemized.
//   2. Does the ledger balance agree with the invoices? (`reconcile`, from
//      billing/ledger.) The existing US-24 reconciliation.
//
// A notice may only be generated when both hold. Failing either is a refusal,
// never a warning — see `claimForNotice`.

export type ClaimLine = {
  /// The ledger entry this came from, so every figure on the notice traces to
  /// a row rather than to a calculation nobody kept.
  ledgerEntryId: string
  /// US-27's "accrual dates": when the charge was incurred, not when the
  /// notice was written.
  accruedAt: Date
  description: string
  invoiceNumber: string | null
  /// Signed cents, exactly as the ledger stores it. Charges positive, payments
  /// and credits negative. Deliberately NOT re-signed for presentation: the
  /// claim has to sum to the balance, and a file that flipped signs to make a
  /// column read nicely is one whose total can no longer be checked by adding
  /// it up.
  amountCents: number
}

export type LienClaim = {
  lines: ClaimLine[]
  /// The sum of every line. Equal to the ledger balance by construction —
  /// `buildClaim` refuses to return otherwise.
  totalCents: number
  /// The oldest unpaid charge's accrual date. What a notice means by "you have
  /// owed us since".
  oldestAccrualAt: Date | null
}

export type ClaimProblem =
  | { kind: 'nothing_owed'; message: string }
  | { kind: 'claim_does_not_sum'; message: string; expectedCents: number; actualCents: number }
  | { kind: 'ledger_does_not_reconcile'; message: string; reconciliation: Reconciliation }

export type ClaimResult = { ok: true; claim: LienClaim } | { ok: false; problem: ClaimProblem }

/// Itemizes every ledger row into a claim, and proves it sums to the balance.
///
/// Every row is itemized, not just the charges. A notice that listed only what
/// was charged and quoted a net total would be arithmetic a tenant cannot
/// follow and an attorney can attack — the payments they DID make have to
/// appear, or the claim looks inflated by exactly the amount they paid.
export function buildClaim(rows: readonly LedgerRow[]): ClaimResult {
  const totals = ledgerTotals(rows)

  if (totals.balanceCents <= 0) {
    return {
      ok: false,
      problem: {
        kind: 'nothing_owed',
        message:
          totals.balanceCents === 0
            ? 'This lease has a zero balance. There is nothing to claim.'
            : 'This lease is in credit. There is nothing to claim.',
      },
    }
  }

  const lines: ClaimLine[] = [...rows]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id))
    .map((row) => ({
      ledgerEntryId: row.id,
      accruedAt: row.occurredAt,
      description: row.description,
      invoiceNumber: row.invoiceNumber,
      amountCents: row.amountCents,
    }))

  const summed = lines.reduce((sum, line) => sum + line.amountCents, 0)
  if (summed !== totals.balanceCents) {
    // Unreachable while both are derived from the same rows — asserted anyway,
    // because "the total on the notice was not the sum of the lines on the
    // notice" is the single worst way for this to fail and the cheapest thing
    // in the file to check.
    return {
      ok: false,
      problem: {
        kind: 'claim_does_not_sum',
        message: 'The itemized lines do not sum to the balance. The notice was not generated.',
        expectedCents: totals.balanceCents,
        actualCents: summed,
      },
    }
  }

  const oldestUnpaidCharge = lines.find((line) => line.amountCents > 0)

  return {
    ok: true,
    claim: { lines, totalCents: totals.balanceCents, oldestAccrualAt: oldestUnpaidCharge?.accruedAt ?? null },
  }
}

export type ClaimForNoticeInput = {
  rows: readonly LedgerRow[]
  /// Sum of (total − paid) across the lease's open invoices, as
  /// `reconcile` defines it.
  invoiceOutstandingCents: number
  uninvoicedChargeCents: number
}

/// The gate a notice must pass. Both checks, in the order that gives the most
/// useful refusal.
///
/// The reconciliation failure is deliberately fatal rather than advisory. US-24
/// already surfaces a discrepancy on the ledger screen for a human to look at;
/// what must not happen is that the same discrepancy is quietly baked into a
/// legal document and mailed. If the two sources of truth disagree, nobody
/// knows what this tenant owes — which is precisely the moment to stop.
export function claimForNotice(input: ClaimForNoticeInput): ClaimResult {
  const built = buildClaim(input.rows)
  if (!built.ok) return built

  const reconciliation = reconcile({
    ledgerBalanceCents: built.claim.totalCents,
    invoiceOutstandingCents: input.invoiceOutstandingCents,
    uninvoicedChargeCents: input.uninvoicedChargeCents,
  })
  if (!reconciliation.reconciles) {
    return {
      ok: false,
      problem: {
        kind: 'ledger_does_not_reconcile',
        message:
          'The ledger and the invoices disagree about what this lease owes, so no notice can state a claim. ' +
          reconciliation.explanation,
        reconciliation,
      },
    }
  }

  return built
}
