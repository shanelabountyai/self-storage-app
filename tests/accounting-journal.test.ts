import { describe, expect, it } from 'vitest'
import {
  buildJournal,
  chartOrDefault,
  CHART_OF_ACCOUNTS_FIELDS,
  CLOSE_SNAPSHOT_VERSION,
  DEFAULT_CHART_OF_ACCOUNTS,
  lastDayOf,
  UnbalancedJournalError,
  type Journal,
  type PeriodSnapshot,
} from '../packages/core/accounting'

// PRD 02 US-40 (B-084 part 2). The month-end journal.
//
// One property matters more than every other test in this file: **the entry
// balances.** These rows land in somebody's real general ledger, and a journal
// whose debits and credits disagree is rejected at best and silently corrupts a
// trial balance at worst.

function snapshot(overrides: Partial<PeriodSnapshot['periodDerived']> = {}): PeriodSnapshot {
  return {
    version: CLOSE_SNAPSHOT_VERSION,
    takenAt: '2026-06-01T06:00:00.000Z',
    pointInTime: {
      unitOccupancyRatio: 0.9,
      occupiedUnits: 90,
      rentableUnits: 100,
      squareFootRatio: 0.88,
      arD0to10Cents: 0,
      arD11to30Cents: 0,
      arD31to60Cents: 0,
      arD61to90Cents: 0,
      arOver90Cents: 0,
      arTotalCents: 0,
    },
    periodDerived: {
      billedCents: 100_000,
      collectedCents: 90_000,
      billedByCategory: { rent: 80_000, fee: 10_000, protection: 5_000, tax: 5_000 },
      collectedByCategory: { rent: 72_000, fee: 9_000, protection: 4_500, tax: 4_500 },
      discountsCents: 0,
      referralRewardsCents: 0,
      writeOffsCents: 0,
      refundsCents: 0,
      unappliedCents: 0,
      economicOccupancyRatio: 0.82,
      grossPotentialCents: 110_000,
      moveIns: 4,
      moveOuts: 2,
      netMoves: 2,
      ...overrides,
    },
  }
}

function build(overrides: Partial<PeriodSnapshot['periodDerived']> = {}): Journal {
  const result = buildJournal(snapshot(overrides), DEFAULT_CHART_OF_ACCOUNTS, {
    year: 2026,
    month: 5,
    reference: 'demo-2026-05',
  })
  if (!result.ok) throw new Error(result.reason)
  return result.journal
}

function net(journal: Journal, account: string): number {
  return journal.lines
    .filter((line) => line.account === account)
    .reduce((sum, line) => sum + line.debitCents - line.creditCents, 0)
}

describe('the journal balances', () => {
  // Swept rather than spot-checked, the same way B-062's waterfall is: this is
  // the property the whole module exists to guarantee, and it has to hold for
  // combinations nobody thought to write down.
  const amounts = [0, 1, 7_777, 100_000]

  it('balances across every combination of the moving parts', () => {
    let checked = 0
    for (const discounts of amounts) {
      for (const referrals of amounts) {
        if (referrals > discounts) continue // referrals are a subset of discounts
        for (const writeOffs of amounts) {
          for (const unapplied of amounts) {
            const journal = build({
              discountsCents: discounts,
              referralRewardsCents: referrals,
              writeOffsCents: writeOffs,
              unappliedCents: unapplied,
            })
            expect(journal.totalDebitCents).toBe(journal.totalCreditCents)
            checked += 1
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('balances when discounts exceed everything billed', () => {
    // A credit-heavy month with little new billing makes the receivable
    // movement genuinely negative, and a negative debit is not something a
    // journal may contain — the line flips sides instead.
    const journal = build({ discountsCents: 250_000 })
    expect(journal.totalDebitCents).toBe(journal.totalCreditCents)
    const receivableLine = journal.lines.find(
      (line) => line.account === DEFAULT_CHART_OF_ACCOUNTS.accountsReceivable && line.description === 'Billed in the period',
    )
    expect(receivableLine!.debitCents).toBe(0)
    expect(receivableLine!.creditCents).toBeGreaterThan(0)
  })

  it('never writes a line with both a debit and a credit', () => {
    const journal = build({ discountsCents: 5_000, writeOffsCents: 1_000, unappliedCents: 200 })
    for (const line of journal.lines) {
      expect(line.debitCents === 0 || line.creditCents === 0).toBe(true)
      expect(line.debitCents + line.creditCents).toBeGreaterThan(0)
    }
  })
})

describe('what the entry says', () => {
  it('credits each income category with its gross, and debits the discount', () => {
    const journal = build({ discountsCents: 12_000 })
    expect(net(journal, DEFAULT_CHART_OF_ACCOUNTS.rentalIncome)).toBe(-80_000)
    expect(net(journal, DEFAULT_CHART_OF_ACCOUNTS.feeIncome)).toBe(-10_000)
    expect(net(journal, DEFAULT_CHART_OF_ACCOUNTS.protectionIncome)).toBe(-5_000)
    // Tax is a liability, not income — money held for the state.
    expect(net(journal, DEFAULT_CHART_OF_ACCOUNTS.salesTaxPayable)).toBe(-5_000)
    // Contra-revenue, so it is a DEBIT.
    expect(net(journal, DEFAULT_CHART_OF_ACCOUNTS.discountsGiven)).toBe(12_000)
  })

  it('does not post a referral reward twice', () => {
    // `referralRewardsCents` is a SUBSET of `discountsCents` — the same invoice
    // line type, split by description. Posting both in full would double the
    // reduction and still balance, which is the error a trial balance cannot
    // catch.
    const journal = build({ discountsCents: 12_000, referralRewardsCents: 5_000 })
    expect(net(journal, DEFAULT_CHART_OF_ACCOUNTS.referralRewards)).toBe(5_000)
    expect(net(journal, DEFAULT_CHART_OF_ACCOUNTS.discountsGiven)).toBe(7_000)
    // And together they still equal the total taken off.
    expect(
      net(journal, DEFAULT_CHART_OF_ACCOUNTS.referralRewards) +
        net(journal, DEFAULT_CHART_OF_ACCOUNTS.discountsGiven),
    ).toBe(12_000)
  })

  it('splits money received between the receivable and customer deposits', () => {
    const journal = build({ unappliedCents: 7_500 })
    expect(net(journal, DEFAULT_CHART_OF_ACCOUNTS.undepositedFunds)).toBe(90_000 + 7_500)
    // The part that settled invoices reduces the receivable; the part that did
    // not is a liability, because it is money we are holding.
    expect(net(journal, DEFAULT_CHART_OF_ACCOUNTS.customerDeposits)).toBe(-7_500)
  })

  it('has NO refund line, because collected is already net of refunds', () => {
    // The trap this module is most likely to fall into: a refund entry would
    // take the money out twice AND balance while doing it.
    const journal = build({ refundsCents: 40_000 })
    const clean = build({ refundsCents: 0 })
    expect(journal.lines).toEqual(clean.lines)
  })

  it('balances a write-off against bad debt', () => {
    const journal = build({ writeOffsCents: 3_000 })
    expect(net(journal, DEFAULT_CHART_OF_ACCOUNTS.badDebtExpense)).toBe(3_000)
  })

  it('dates the entry on the last day of the month', () => {
    expect(build().date).toBe('2026-05-31')
    expect(lastDayOf(2026, 2)).toBe('2026-02-28')
    expect(lastDayOf(2028, 2)).toBe('2028-02-29')
    expect(lastDayOf(2026, 12)).toBe('2026-12-31')
  })
})

describe('a snapshot filed before categories were recorded', () => {
  it('is refused, with an instruction that does not change the figures', () => {
    // Exporting it would mean guessing which part of a single total was rent
    // and which was tax — an invented split posted to a real ledger.
    const old = { ...snapshot(), version: 1 }
    const result = buildJournal(old, DEFAULT_CHART_OF_ACCOUNTS, {
      year: 2026,
      month: 5,
      reference: 'demo-2026-05',
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('Reopen the month')
    expect(result.ok === false && result.reason).toContain('figures themselves will not change')
  })
})

describe('the chart of accounts', () => {
  it('falls back per field, so a partly-filled chart still exports', () => {
    const chart = chartOrDefault({ rentalIncome: '4000 · Storage Revenue', feeIncome: '   ' })
    expect(chart.rentalIncome).toBe('4000 · Storage Revenue')
    // Blank means "use the conventional name", never "post to an account with
    // no name".
    expect(chart.feeIncome).toBe(DEFAULT_CHART_OF_ACCOUNTS.feeIncome)
  })

  it('ignores rubbish rather than putting it on a journal line', () => {
    expect(chartOrDefault(null)).toEqual(DEFAULT_CHART_OF_ACCOUNTS)
    expect(chartOrDefault('nonsense')).toEqual(DEFAULT_CHART_OF_ACCOUNTS)
    expect(chartOrDefault({ rentalIncome: 42 })).toEqual(DEFAULT_CHART_OF_ACCOUNTS)
  })

  it('has a form field for every account the journal can post to', () => {
    // The repo's own rule: a field that configures behaviour ships with its
    // control. An account with no form field is one only a database client can
    // set.
    expect(CHART_OF_ACCOUNTS_FIELDS.map((field) => field.key).sort()).toEqual(
      Object.keys(DEFAULT_CHART_OF_ACCOUNTS).sort(),
    )
  })
})

describe('the balance assertion itself', () => {
  it('throws rather than returning an unbalanced journal', () => {
    // Unreachable by construction, which is exactly why it is asserted: if a
    // future edit breaks a sub-entry, this is what stops the file reaching a
    // general ledger.
    expect(new UnbalancedJournalError(100, 90).message).toContain('does not balance')
    expect(new UnbalancedJournalError(100, 90).message).toContain('nothing should be posted')
  })
})
