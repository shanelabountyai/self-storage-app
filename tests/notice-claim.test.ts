import { describe, expect, it } from 'vitest'
import { buildClaim, claimForNotice } from '../packages/core/notices/claim'
import type { LedgerRow } from '../packages/core/billing'

// B-061 / PRD 02 §4.6 US-27. "The itemized claim on the notice reconciles to
// the ledger at generation time."

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

function row(overrides: Partial<LedgerRow> & { id: string; amountCents: number }): LedgerRow {
  return {
    kind: 'charge',
    description: 'Rent',
    occurredAt: d('2026-06-01'),
    invoiceNumber: null,
    ...overrides,
  }
}

describe('buildClaim', () => {
  it('itemizes every row and sums to the balance', () => {
    const result = buildClaim([
      row({ id: 'a', amountCents: 12_900, occurredAt: d('2026-06-01') }),
      row({ id: 'b', amountCents: 12_900, occurredAt: d('2026-07-01') }),
      row({ id: 'c', amountCents: -5_000, kind: 'payment', description: 'Card', occurredAt: d('2026-07-05') }),
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.claim.lines).toHaveLength(3)
    expect(result.claim.totalCents).toBe(20_800)
  })

  it('lists the payments the tenant DID make, not only what was charged', () => {
    // A claim showing only charges would overstate the debt by exactly the
    // amount they paid — the first thing an attorney checks.
    const result = buildClaim([
      row({ id: 'a', amountCents: 12_900 }),
      row({ id: 'b', amountCents: -3_000, kind: 'payment', description: 'Partial payment' }),
    ])
    if (!result.ok) throw new Error('unreachable')

    expect(result.claim.lines.map((line) => line.amountCents)).toEqual([12_900, -3_000])
    expect(result.claim.totalCents).toBe(9_900)
  })

  it('always sums to its own total — the identity the notice is read against', () => {
    const result = buildClaim([
      row({ id: 'a', amountCents: 12_900 }),
      row({ id: 'b', amountCents: 2_500, description: 'Late fee' }),
      row({ id: 'c', amountCents: -1_000, kind: 'credit', description: 'Goodwill credit' }),
      row({ id: 'd', amountCents: 1_064, description: 'Tax' }),
    ])
    if (!result.ok) throw new Error('unreachable')

    const summed = result.claim.lines.reduce((sum, line) => sum + line.amountCents, 0)
    expect(summed).toBe(result.claim.totalCents)
  })

  it('orders by accrual date so the notice reads chronologically', () => {
    const result = buildClaim([
      row({ id: 'b', amountCents: 12_900, occurredAt: d('2026-07-01') }),
      row({ id: 'a', amountCents: 12_900, occurredAt: d('2026-06-01') }),
    ])
    if (!result.ok) throw new Error('unreachable')
    expect(result.claim.lines.map((line) => line.ledgerEntryId)).toEqual(['a', 'b'])
  })

  it('reports the oldest charge, not the oldest row', () => {
    // "You have owed us since" has to name a charge. A credit posted in May on
    // an account first charged in June is not when the debt began.
    const result = buildClaim([
      row({ id: 'credit', amountCents: -500, kind: 'credit', occurredAt: d('2026-05-01') }),
      row({ id: 'rent', amountCents: 12_900, occurredAt: d('2026-06-01') }),
    ])
    if (!result.ok) throw new Error('unreachable')
    expect(result.claim.oldestAccrualAt).toEqual(d('2026-06-01'))
  })

  it('refuses when nothing is owed', () => {
    const result = buildClaim([
      row({ id: 'a', amountCents: 12_900 }),
      row({ id: 'b', amountCents: -12_900, kind: 'payment' }),
    ])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.problem.kind).toBe('nothing_owed')
  })

  it('refuses when the lease is in credit', () => {
    // Serving a lien notice on someone who is ahead on payments is the kind of
    // mistake that ends up in a news story.
    const result = buildClaim([
      row({ id: 'a', amountCents: 12_900 }),
      row({ id: 'b', amountCents: -15_000, kind: 'payment' }),
    ])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.problem.kind).toBe('nothing_owed')
  })

  it('refuses an empty ledger rather than claiming zero', () => {
    expect(buildClaim([]).ok).toBe(false)
  })
})

describe('claimForNotice — the US-27 gate', () => {
  const owed: LedgerRow[] = [row({ id: 'a', amountCents: 12_900 })]

  it('passes when the ledger and the invoices agree', () => {
    const result = claimForNotice({
      rows: owed,
      invoiceOutstandingCents: 12_900,
      uninvoicedChargeCents: 0,
    })
    expect(result.ok).toBe(true)
  })

  it('accepts an uninvoiced charge, which is normal rather than a discrepancy', () => {
    // A move-in charge (B-026) predates invoicing by design.
    const result = claimForNotice({
      rows: owed,
      invoiceOutstandingCents: 0,
      uninvoicedChargeCents: 12_900,
    })
    expect(result.ok).toBe(true)
  })

  it('REFUSES when the ledger and the invoices disagree', () => {
    // The point of the whole file. If the two sources of truth disagree, nobody
    // knows what this tenant owes — so no document may state a number.
    const result = claimForNotice({
      rows: owed,
      invoiceOutstandingCents: 9_900,
      uninvoicedChargeCents: 0,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.problem.kind).toBe('ledger_does_not_reconcile')
    expect(result.problem.message).toContain('no notice')
  })

  it('refuses in the other direction too', () => {
    const result = claimForNotice({
      rows: owed,
      invoiceOutstandingCents: 20_000,
      uninvoicedChargeCents: 0,
    })
    expect(result.ok).toBe(false)
  })

  it('checks "nothing owed" before reconciliation, so a paid-up lease says so plainly', () => {
    const result = claimForNotice({
      rows: [row({ id: 'a', amountCents: 12_900 }), row({ id: 'b', amountCents: -12_900, kind: 'payment' })],
      // Deliberately inconsistent — the tenant owing nothing is the more
      // useful thing to say to whoever is standing at the counter.
      invoiceOutstandingCents: 5_000,
      uninvoicedChargeCents: 0,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.problem.kind).toBe('nothing_owed')
  })
})
