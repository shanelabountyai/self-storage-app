import { describe, expect, it } from 'vitest'
import { refusalFigures } from '../apps/web/lib/notices/service'

// B-306. The figures an audit entry carries beside the sentence, so a refusal
// can still be read after the ledger it refused over has been repaired.

describe('refusalFigures', () => {
  it('carries both sides of a claim that does not sum', () => {
    // Unreachable from real rows — `buildClaim` derives the total and the lines
    // from the same array — which is exactly why it is checked here.
    expect(
      refusalFigures({
        kind: 'claim_does_not_sum',
        message: 'The itemized lines do not sum to the balance.',
        expectedCents: 12_900,
        actualCents: 12_800,
      }),
    ).toEqual({ expectedCents: 12_900, actualCents: 12_800 })
  })

  it('carries the difference when the ledger does not reconcile', () => {
    expect(
      refusalFigures({
        kind: 'ledger_does_not_reconcile',
        message: 'The ledger and the invoices disagree.',
        reconciliation: {
          reconciles: false,
          differenceCents: -4_200,
          explanation: 'The invoices say more is outstanding than the ledger does.',
        },
      }),
    ).toEqual({ differenceCents: -4_200 })
  })

  it('carries no figures for a refusal that has none', () => {
    expect(refusalFigures({ kind: 'nothing_owed', message: 'Nothing to claim.' })).toEqual({})
    expect(refusalFigures({ kind: 'no_address', message: 'No address of record.' })).toEqual({})
  })
})
