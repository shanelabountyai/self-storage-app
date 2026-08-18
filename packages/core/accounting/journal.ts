import { CLOSE_SNAPSHOT_VERSION, type PeriodSnapshot } from './close.ts'

// PRD 02 §4 (out-of-scope note), US-40 (B-084 part 2). The general-journal
// entry for one closed month.
//
// **This produces rows that land in somebody's real general ledger.** §2 of PRD
// 02 is explicit that we are not the accounting system of record — we hand over
// a journal and QuickBooks keeps the books. That makes exactly one property
// non-negotiable: **the entry balances.** A journal whose debits and credits
// disagree is rejected by the import at best and silently corrupts a trial
// balance at worst, and neither failure points back here. `buildJournal`
// therefore asserts its own balance before returning, the same way B-062's
// proceeds waterfall asserts it accounted for every cent.
//
// Cut from the FROZEN snapshot, never from live data. That is the whole reason
// part 1 shipped first: an export re-derived at click time disagrees with the
// one taken yesterday, and an accountant who has already posted the first one
// has no way to tell which is right.

/// The accounts a journal posts to. Names, not numbers — QuickBooks Online's
/// journal import matches on account NAME, and an operator who has renumbered
/// their chart still recognises "Rental Income".
export type ChartOfAccounts = {
  accountsReceivable: string
  rentalIncome: string
  feeIncome: string
  protectionIncome: string
  salesTaxPayable: string
  discountsGiven: string
  referralRewards: string
  undepositedFunds: string
  customerDeposits: string
  badDebtExpense: string
}

export const CHART_OF_ACCOUNTS_FIELDS: readonly {
  key: keyof ChartOfAccounts
  label: string
  hint: string
}[] = [
  {
    key: 'accountsReceivable',
    label: 'Accounts Receivable',
    hint: 'Debited when rent is billed, credited when it is paid or written off.',
  },
  { key: 'rentalIncome', label: 'Rental income', hint: 'Rent billed, gross of discounts.' },
  { key: 'feeIncome', label: 'Fee income', hint: 'Admin, late, lien and other fees billed.' },
  {
    key: 'protectionIncome',
    label: 'Protection plan income',
    hint: 'Protection premiums billed. Not insurance — see US-44.',
  },
  {
    key: 'salesTaxPayable',
    label: 'Sales tax payable',
    hint: 'A liability, not income: this is money held for the state.',
  },
  {
    key: 'discountsGiven',
    label: 'Discounts given',
    hint: 'Contra-revenue, so it is DEBITED. Promotional discounts only — referral rewards go to their own account below.',
  },
  {
    key: 'referralRewards',
    label: 'Referral rewards',
    hint: 'Split out from discounts on purpose: a referral reward is acquisition cost, a promotion is a price decision, and merged they answer neither question.',
  },
  {
    key: 'undepositedFunds',
    label: 'Undeposited funds',
    hint: 'Where money received lands before it is reconciled against a bank deposit.',
  },
  {
    key: 'customerDeposits',
    label: 'Customer deposits',
    hint: 'A liability: money taken that is not yet against any invoice.',
  },
  {
    key: 'badDebtExpense',
    label: 'Bad debt expense',
    hint: 'Balances a written-off receivable.',
  },
]

/// A conventional chart, used when an operator has not set their own.
///
/// These are QuickBooks' own default names wherever one exists, so the common
/// case is an import that matches on the first try. It is a starting point and
/// not a claim about anybody's books — which is why the settings form exists in
/// the same item as the column, per this repo's own rule.
export const DEFAULT_CHART_OF_ACCOUNTS: ChartOfAccounts = {
  accountsReceivable: 'Accounts Receivable',
  rentalIncome: 'Rental Income',
  feeIncome: 'Fee Income',
  protectionIncome: 'Tenant Protection Income',
  salesTaxPayable: 'Sales Tax Payable',
  discountsGiven: 'Discounts Given',
  referralRewards: 'Referral Rewards',
  undepositedFunds: 'Undeposited Funds',
  customerDeposits: 'Customer Deposits',
  badDebtExpense: 'Bad Debt Expense',
}

/// Fills in any account an operator has left blank, so a partly-configured
/// chart still exports rather than producing a journal line with no account.
export function chartOrDefault(stored: unknown): ChartOfAccounts {
  const chart = { ...DEFAULT_CHART_OF_ACCOUNTS }
  if (stored && typeof stored === 'object') {
    for (const field of CHART_OF_ACCOUNTS_FIELDS) {
      const value = (stored as Record<string, unknown>)[field.key]
      if (typeof value === 'string' && value.trim()) chart[field.key] = value.trim()
    }
  }
  return chart
}

export type JournalLine = {
  account: string
  /// Exactly one of these is non-zero. Cents.
  debitCents: number
  creditCents: number
  description: string
}

export type Journal = {
  /// yyyy-mm-dd, the last day of the period in facility-local terms — the date
  /// an accountant expects a month-end entry to carry.
  date: string
  reference: string
  lines: JournalLine[]
  totalDebitCents: number
  totalCreditCents: number
}

/// One line, on whichever side the amount actually belongs.
///
/// A negative debit is not a thing a journal may contain — QuickBooks rejects
/// it — so a negative amount flips to the other side rather than being written
/// as a minus. This is not defensive tidying: discounts can in principle exceed
/// the gross billed for a month (a credit-heavy month with little new billing),
/// which makes the receivable movement genuinely negative.
function line(
  account: string,
  amountCents: number,
  side: 'debit' | 'credit',
  description: string,
): JournalLine | null {
  if (amountCents === 0) return null
  const debit = side === 'debit' ? amountCents > 0 : amountCents < 0
  const magnitude = Math.abs(amountCents)
  return {
    account,
    debitCents: debit ? magnitude : 0,
    creditCents: debit ? 0 : magnitude,
    description,
  }
}

export class UnbalancedJournalError extends Error {
  readonly debitCents: number
  readonly creditCents: number

  constructor(debitCents: number, creditCents: number) {
    super(
      `Journal does not balance: ${debitCents} in debits against ${creditCents} in credits. ` +
        'This is a defect in the export, not in the data — nothing should be posted from it.',
    )
    this.name = 'UnbalancedJournalError'
    this.debitCents = debitCents
    this.creditCents = creditCents
  }
}

export type JournalResult =
  | { ok: true; journal: Journal }
  | { ok: false; reason: string }

/// The month-end entry for one facility.
///
/// Three sub-entries, each of which balances on its own so a reader can check
/// them by eye:
///
///   **Billing (accrual).** Debit the receivable with what was actually added
///   to it — gross billed less the money taken off — and debit the two
///   contra-revenue accounts with the amounts taken off; credit each income
///   category with its gross. Discounts and referral rewards are DEBITS because
///   they reduce revenue, and they are separate accounts because one is a price
///   decision and the other is acquisition cost.
///
///   **Cash receipts.** Debit undeposited funds with everything received;
///   credit the receivable with the part that settled an invoice, and customer
///   deposits with the part that did not.
///
///   **Write-offs.** Debit bad debt, credit the receivable.
///
/// **Refunds are deliberately absent.** `refundsCents` is informational: a
/// refund unwinds the original payment's allocation rows, so `collectedCents`
/// is already net of it. Adding a refund entry here would take the money out
/// twice, and it would do so in a way that balances — which is the kind of
/// error a trial balance cannot catch.
export function buildJournal(
  snapshot: PeriodSnapshot,
  chart: ChartOfAccounts,
  period: { year: number; month: number; reference: string },
): JournalResult {
  if (snapshot.version < CLOSE_SNAPSHOT_VERSION) {
    return {
      ok: false,
      reason:
        'This month was filed before the export recorded revenue by category, so there is no way to tell rent from fees from tax in it. Reopen the month and close it again to file the figures a journal needs — the figures themselves will not change.',
    }
  }

  const figures = snapshot.periodDerived
  const billed = figures.billedByCategory
  const collected = figures.collectedByCategory

  // Promotional discounts only. `referralRewardsCents` is a SUBSET of
  // `discountsCents` (they are the same invoice line type, split by
  // description), so posting both in full would double the reduction.
  const promotionalDiscounts = figures.discountsCents - figures.referralRewardsCents
  const grossBilled = billed.rent + billed.fee + billed.protection + billed.tax
  const receivableFromBilling = grossBilled - figures.discountsCents

  // Everything received, whether or not it landed against an invoice.
  const collectedTotal = collected.rent + collected.fee + collected.protection + collected.tax

  const lines = [
    line(chart.accountsReceivable, receivableFromBilling, 'debit', 'Billed in the period'),
    line(chart.discountsGiven, promotionalDiscounts, 'debit', 'Promotional discounts given'),
    line(chart.referralRewards, figures.referralRewardsCents, 'debit', 'Referral rewards given'),
    line(chart.rentalIncome, billed.rent, 'credit', 'Rent billed'),
    line(chart.feeIncome, billed.fee, 'credit', 'Fees billed'),
    line(chart.protectionIncome, billed.protection, 'credit', 'Protection plan billed'),
    line(chart.salesTaxPayable, billed.tax, 'credit', 'Sales tax billed'),

    line(
      chart.undepositedFunds,
      collectedTotal + figures.unappliedCents,
      'debit',
      'Money received in the period',
    ),
    line(chart.accountsReceivable, collectedTotal, 'credit', 'Applied against invoices'),
    line(chart.customerDeposits, figures.unappliedCents, 'credit', 'Received but not yet applied'),

    line(chart.badDebtExpense, figures.writeOffsCents, 'debit', 'Balances written off'),
    line(chart.accountsReceivable, figures.writeOffsCents, 'credit', 'Balances written off'),
  ].filter((entry): entry is JournalLine => entry !== null)

  const totalDebitCents = lines.reduce((sum, entry) => sum + entry.debitCents, 0)
  const totalCreditCents = lines.reduce((sum, entry) => sum + entry.creditCents, 0)
  // Unreachable by construction — every sub-entry above balances — and asserted
  // anyway, because an unbalanced journal reaching a real general ledger is the
  // one failure this module exists to prevent, and it would not be visible from
  // here.
  if (totalDebitCents !== totalCreditCents) {
    throw new UnbalancedJournalError(totalDebitCents, totalCreditCents)
  }

  return {
    ok: true,
    journal: {
      date: lastDayOf(period.year, period.month),
      reference: period.reference,
      lines,
      totalDebitCents,
      totalCreditCents,
    },
  }
}

/// yyyy-mm-dd for the last day of a calendar month, in plain calendar terms.
///
/// No timezone conversion on purpose: this is the DATE written on a journal
/// entry, not an instant. `Date.UTC(year, month, 0)` is the last day of `month`
/// because day 0 of the next month is the day before it.
export function lastDayOf(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}
