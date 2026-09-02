import { describe, expect, it } from 'vitest'
import {
  ledgerTotals,
  openItems,
  reconcile,
  runningBalance,
  type LedgerRow,
} from '../packages/core/billing'

// PRD 02 US-24 (B-049). The ledger, and the reconciliation that is its AC.

const t = (iso: string) => new Date(`2026-09-${iso}T12:00:00.000Z`)

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'a',
    kind: 'charge',
    description: 'Rent',
    occurredAt: t('01'),
    amountCents: 12_900,
    invoiceNumber: '000001',
    ...overrides,
  }
}

describe('runningBalance', () => {
  it('accumulates in date order', () => {
    const lines = runningBalance([
      row({ id: 'b', kind: 'payment', amountCents: -5_000, occurredAt: t('05') }),
      row({ id: 'a', amountCents: 12_900, occurredAt: t('01') }),
    ])
    expect(lines.map((line) => line.balanceCents)).toEqual([12_900, 7_900])
  })

  it('breaks a timestamp tie on id, so a statement reprints identically', () => {
    // A charge and the payment settling it are routinely written in one
    // transaction with the same timestamp. Without a stable second key the
    // balance column renders one way today and the other tomorrow — and a
    // tenant can hold two statements up and show they disagree.
    const same = t('01')
    const first = runningBalance([
      row({ id: 'b', kind: 'payment', amountCents: -1_000, occurredAt: same }),
      row({ id: 'a', amountCents: 3_000, occurredAt: same }),
    ])
    const second = runningBalance([
      row({ id: 'a', amountCents: 3_000, occurredAt: same }),
      row({ id: 'b', kind: 'payment', amountCents: -1_000, occurredAt: same }),
    ])
    expect(first.map((line) => line.id)).toEqual(second.map((line) => line.id))
    expect(first.map((line) => line.balanceCents)).toEqual([3_000, 2_000])
  })

  it('never re-signs an entry', () => {
    // The ledger is append-only (FR-8). A screen that flipped signs to tidy a
    // column would be presenting something other than the record.
    const [line] = runningBalance([row({ kind: 'payment', amountCents: -5_000 })])
    expect(line.amountCents).toBe(-5_000)
  })

  it('ends at zero for a fully settled lease', () => {
    const lines = runningBalance([
      row({ id: 'a', amountCents: 12_900 }),
      row({ id: 'b', kind: 'payment', amountCents: -12_900, occurredAt: t('02') }),
    ])
    expect(lines.at(-1)!.balanceCents).toBe(0)
  })

  it('handles an empty ledger', () => {
    expect(runningBalance([])).toEqual([])
  })
})

describe('ledgerTotals', () => {
  const rows = [
    row({ id: 'a', kind: 'charge', amountCents: 12_900 }),
    row({ id: 'b', kind: 'charge', amountCents: 806 }),
    row({ id: 'c', kind: 'payment', amountCents: -10_000 }),
    row({ id: 'd', kind: 'credit', amountCents: -2_000 }),
    row({ id: 'e', kind: 'refund', amountCents: 500 }),
    row({ id: 'f', kind: 'write_off', amountCents: -206 }),
  ]

  it('reports reductions as positive magnitudes', () => {
    // "Payments: -$129.00" reads as a payment that went the wrong way.
    const totals = ledgerTotals(rows)
    expect(totals.paidCents).toBe(10_000)
    expect(totals.creditedCents).toBe(2_000)
    expect(totals.writtenOffCents).toBe(206)
  })

  it('keeps a refund as an increase, because the money went back', () => {
    expect(ledgerTotals(rows).refundedCents).toBe(500)
  })

  it('computes the balance from the signs, not the summary columns', () => {
    // 12900 + 806 - 10000 - 2000 + 500 - 206
    expect(ledgerTotals(rows).balanceCents).toBe(2_000)
  })

  it('agrees with the last running-balance line', () => {
    // The two are computed separately and must never disagree — that is the
    // whole reason both exist in one module with one test.
    expect(ledgerTotals(rows).balanceCents).toBe(runningBalance(rows).at(-1)!.balanceCents)
  })

  it('leaves an adjustment out of both columns but inside the balance', () => {
    // An adjustment can go either way; bucketing it would be a guess. It still
    // has to reconcile.
    const totals = ledgerTotals([row({ kind: 'adjustment', amountCents: -300 })])
    expect(totals.chargedCents).toBe(0)
    expect(totals.creditedCents).toBe(0)
    expect(totals.balanceCents).toBe(-300)
  })
})

describe('reconcile — US-24’s acceptance criterion', () => {
  it('reconciles when the ledger matches the invoices', () => {
    const result = reconcile({
      ledgerBalanceCents: 12_900,
      invoiceOutstandingCents: 12_900,
      uninvoicedChargeCents: 0,
    })
    expect(result.reconciles).toBe(true)
    expect(result.differenceCents).toBe(0)
  })

  it('counts a move-in charge that never became an invoice', () => {
    // B-026 posts the opening charge before the billing engine exists. A
    // system that called that a discrepancy would cry wolf on every tenant who
    // ever moved in.
    const result = reconcile({
      ledgerBalanceCents: 20_000,
      invoiceOutstandingCents: 12_900,
      uninvoicedChargeCents: 7_100,
    })
    expect(result.reconciles).toBe(true)
  })

  it('reports a ledger that owes more than the invoices explain', () => {
    const result = reconcile({
      ledgerBalanceCents: 15_000,
      invoiceOutstandingCents: 12_900,
      uninvoicedChargeCents: 0,
    })
    expect(result.reconciles).toBe(false)
    expect(result.differenceCents).toBe(2_100)
    expect(result.explanation).toContain('without an invoice behind it')
  })

  it('reports the other direction differently, because the cause is different', () => {
    // Too much invoice is a payment on the wrong lease or an invoice with no
    // charge; too much ledger is an uninvoiced charge. A manager needs to know
    // which before they ring anyone.
    const result = reconcile({
      ledgerBalanceCents: 10_000,
      invoiceOutstandingCents: 12_900,
      uninvoicedChargeCents: 0,
    })
    expect(result.reconciles).toBe(false)
    expect(result.differenceCents).toBe(-2_900)
    expect(result.explanation).toContain('wrong lease')
  })

  it('reconciles a settled lease at zero', () => {
    expect(
      reconcile({ ledgerBalanceCents: 0, invoiceOutstandingCents: 0, uninvoicedChargeCents: 0 })
        .reconciles,
    ).toBe(true)
  })

  it('reconciles a credit balance', () => {
    // An over-payment leaves the ledger negative and no invoice outstanding.
    // That is a real state and not a discrepancy — it needs the uninvoiced
    // term to carry it, which is exactly what the adapter passes.
    expect(
      reconcile({
        ledgerBalanceCents: -5_000,
        invoiceOutstandingCents: 0,
        uninvoicedChargeCents: -5_000,
      }).reconciles,
    ).toBe(true)
  })
})

// B-232. The open items behind a balance — what `/portal/pay` itemises.
describe('openItems', () => {
  const history: LedgerRow[] = [
    row({ id: 'a', occurredAt: t('01'), amountCents: 12_900, description: 'August rent' }),
    row({ id: 'b', kind: 'payment', occurredAt: t('03'), amountCents: -12_900, description: 'Payment' }),
    row({ id: 'c', occurredAt: t('05'), amountCents: 12_900, description: 'September rent' }),
    row({ id: 'd', occurredAt: t('11'), amountCents: 2_000, description: 'Late fee' }),
  ]

  it('sums to the current balance, which is the whole point of it', () => {
    const items = openItems(history)
    const total = items.reduce((sum, line) => sum + line.amountCents, 0)
    const balance = history.reduce((sum, line) => sum + line.amountCents, 0)

    expect(total).toBe(balance)
    expect(total).toBe(14_900)
  })

  it('starts after the last time the account was square, not at the first charge', () => {
    // A settled August is not part of what is owed in September, and printing
    // it on a bill is how a tenant concludes they are being charged twice.
    expect(openItems(history).map((line) => line.id)).toEqual(['c', 'd'])
  })

  it('takes the LAST zero crossing when there have been several', () => {
    const items = openItems([
      ...history,
      row({ id: 'e', kind: 'payment', occurredAt: t('12'), amountCents: -14_900 }),
      row({ id: 'f', occurredAt: t('13'), amountCents: 12_900, description: 'October rent' }),
    ])
    expect(items.map((line) => line.id)).toEqual(['f'])
  })

  it('returns nothing when the account is square or in credit', () => {
    expect(openItems(history.slice(0, 2))).toEqual([])
    expect(openItems([...history.slice(0, 2), row({ id: 'x', kind: 'credit', amountCents: -500 })])).toEqual([])
    expect(openItems([])).toEqual([])
  })

  it('returns the whole history for a tenant who has never been square', () => {
    const never = [history[0], history[2]]
    expect(openItems(never).map((line) => line.id)).toEqual(['a', 'c'])
  })
})
