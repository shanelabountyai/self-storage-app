import { zonedMidnight } from '../jobs/schedule.ts'

// PRD 01 US-705 / FR-6.1, FR-6.3 (B-102). The monthly statement.
//
// "Download signed lease PDF; list of all payments with downloadable PDF
// receipts; monthly statements" — and P5's persona note says why: the
// small-business tenant "needs receipts/statements for bookkeeping".
//
// A statement is not a report. It is an assertion about money that somebody
// will hand to an accountant, so the only property that really matters is that
// it RECONCILES: opening balance + everything in the period = closing balance,
// exactly, with no rounding and nothing omitted. Everything below exists to
// make that provable without a database.
//
// Deliberately NOT stored. A statement is derived from `LedgerEntry`, which is
// append-only, so the same month recomputes to the same figures forever —
// storing a copy would create a second source of truth that could disagree with
// the ledger, and the ledger is the one the business runs on. (An issued
// statement that later changes because somebody reversed an entry is a real
// scenario; the reversal appears in the period it was made, which is what an
// accountant expects, rather than silently rewriting a month already sent.)

export type StatementLine = {
  /// Signed cents, the same convention `LedgerEntry.amountCents` uses: charges
  /// and refunds increase what is owed, payments and credits decrease it.
  amountCents: number
  type: 'charge' | 'payment' | 'credit' | 'refund' | 'adjustment' | 'write_off'
  description: string
  occurredAt: Date
}

export type StatementPeriod = {
  /// Inclusive. Facility-local midnight, expressed as a UTC instant.
  start: Date
  /// EXCLUSIVE, like every other period boundary in this codebase.
  end: Date
}

export type Statement = {
  period: StatementPeriod
  openingBalanceCents: number
  closingBalanceCents: number
  lines: StatementLine[]
  /// The sums an accountant reads first. Unsigned, because "you were charged
  /// $129 and paid $129" is what a person expects to see, not "+12900, -12900".
  totals: {
    chargedCents: number
    paidCents: number
    creditedCents: number
    refundedCents: number
    writtenOffCents: number
    adjustedCents: number
  }
}

/// Builds one period's statement from the entries that fall in it.
///
/// `openingBalanceCents` is the sum of every entry BEFORE the period — the
/// caller computes it with one aggregate rather than passing the whole history,
/// which is the only reason this stays fast on a lease with six years of rows.
///
/// The closing balance is computed by ADDING the period's movement to the
/// opening balance, never by summing the ledger up to the period end
/// independently. Two sums that should agree are two things that can disagree,
/// and the one thing a statement may never do is fail to add up.
export function buildStatement(input: {
  period: StatementPeriod
  openingBalanceCents: number
  lines: StatementLine[]
}): Statement {
  const lines = [...input.lines].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  )

  const movement = lines.reduce((sum, line) => sum + line.amountCents, 0)

  const totals = {
    chargedCents: sumOf(lines, 'charge'),
    // Payments, credits and write-offs are stored negative; reported positive,
    // because "paid $129" is the sentence a person is looking for.
    paidCents: -sumOf(lines, 'payment'),
    creditedCents: -sumOf(lines, 'credit'),
    refundedCents: sumOf(lines, 'refund'),
    writtenOffCents: -sumOf(lines, 'write_off'),
    adjustedCents: sumOf(lines, 'adjustment'),
  }

  return {
    period: input.period,
    openingBalanceCents: input.openingBalanceCents,
    closingBalanceCents: input.openingBalanceCents + movement,
    lines,
    totals,
  }
}

function sumOf(lines: readonly StatementLine[], type: StatementLine['type']): number {
  return lines.filter((line) => line.type === type).reduce((sum, line) => sum + line.amountCents, 0)
}

/// The check the statement must satisfy, as a function rather than a comment.
///
/// Exported and used by the renderer, not only by tests: a statement that does
/// not reconcile must fail loudly rather than be shown to a tenant. The
/// alternative — rendering it anyway — puts a document in front of somebody's
/// accountant that is wrong in a way nobody noticed.
export function reconciles(statement: Statement): boolean {
  const movement = statement.lines.reduce((sum, line) => sum + line.amountCents, 0)
  return statement.openingBalanceCents + movement === statement.closingBalanceCents
}

/// Calendar months a lease has statements for, newest first.
///
/// From the month the lease started to the month it ended (or this month for a
/// live lease). Months with no activity are INCLUDED: "nothing happened in
/// March" is a statement an accountant may still need, and a gap in a numbered
/// list of months reads as a missing document rather than a quiet month.
export function statementMonths(input: {
  startDate: Date
  endDate: Date | null
  now: Date
}): { year: number; month: number }[] {
  const last = input.endDate ?? input.now
  const months: { year: number; month: number }[] = []

  let year = input.startDate.getUTCFullYear()
  let month = input.startDate.getUTCMonth()
  const lastYear = last.getUTCFullYear()
  const lastMonth = last.getUTCMonth()

  // A lease that ends before it starts produces no months rather than looping
  // forever — defensive, but this walks a calendar under a `while`.
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push({ year, month: month + 1 })
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }

  return months.reverse()
}

/// The UTC instants bounding a facility-local calendar month.
///
/// Local midnight at both ends, via `zonedMidnight` — a payment taken at 8pm on
/// the 31st belongs to that month, and a UTC boundary would push it into the
/// next one at every US facility.
export function monthBounds(year: number, month: number, timezone: string): StatementPeriod {
  return {
    start: zonedMidnight(year, month, 1, timezone),
    // Exclusive, and the first of the following month rather than "the last day
    // plus 24 hours" — which is wrong by an hour on the two DST weekends a year.
    end:
      month === 12
        ? zonedMidnight(year + 1, 1, 1, timezone)
        : zonedMidnight(year, month + 1, 1, timezone),
  }
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export function statementLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}
