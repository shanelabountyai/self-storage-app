import { describe, expect, it } from 'vitest'
import { selectListableLots, type LotCandidate } from '../packages/core/auctions/listing'
import type { Blocker } from '../packages/core/auctions/readiness'

// B-129 / PRD 02 §4.6 US-30. Which scheduled sales may be advertised.
//
// The rule this file exists to hold is that `status === 'scheduled'` is NOT
// the test. A sale is scheduled once and then sits there for weeks, and every
// blocker below can land in that window while the status never changes — the
// tenant pays, an SCRA hold arrives, somebody records a titled vehicle. An
// advertisement placed for a sale that cannot lawfully happen is the mirror
// image of the missing advertisement the row is about.

function blocker(message: string): Blocker {
  return { kind: 'balance_settled', message }
}

function lot(overrides: Partial<LotCandidate> = {}): LotCandidate {
  return {
    caseId: 'case-1',
    unitNumber: 'A-100',
    status: 'scheduled',
    scheduledSaleDate: new Date('2026-09-14T00:00:00Z'),
    readiness: { ready: true, blockers: [] },
    ...overrides,
  }
}

describe('selectListableLots', () => {
  it('exports a scheduled, dated, ready case', () => {
    const { lots, refused } = selectListableLots([lot()])
    expect(lots.map((one) => one.unitNumber)).toEqual(['A-100'])
    expect(refused).toEqual([])
  })

  it('keeps whatever extra fields the caller carried', () => {
    // The selection rule is generic on purpose — the address, size and terms
    // ride along without this module knowing about any of them.
    const { lots } = selectListableLots([{ ...lot(), unitId: 'unit-9' }])
    expect(lots[0].unitId).toBe('unit-9')
  })

  it('refuses a case that is still only eligible', () => {
    const { lots, refused } = selectListableLots([lot({ status: 'eligible' })])
    expect(lots).toEqual([])
    expect(refused[0].kind).toBe('not_scheduled')
  })

  it('refuses a scheduled case whose readiness has since lapsed', () => {
    // The whole point. Status says scheduled; the tenant paid this morning.
    const { lots, refused } = selectListableLots([
      lot({
        readiness: { ready: false, blockers: [blocker('This lease owes nothing.')] },
      }),
    ])
    expect(lots).toEqual([])
    expect(refused[0].kind).toBe('not_ready')
    expect(refused[0].reason).toBe('This lease owes nothing.')
  })

  it('gives every blocker, not the first', () => {
    // Same reasoning `auctionReadiness` gives for listing them all: an operator
    // clearing one at a time, discovering the next each round, is how a
    // deadline gets missed.
    const { refused } = selectListableLots([
      lot({
        readiness: {
          ready: false,
          blockers: [blocker('A hold blocks sale.'), blocker('Contains a vehicle.')],
        },
      }),
    ])
    expect(refused[0].reason).toBe('A hold blocks sale. Contains a vehicle.')
  })

  it('refuses a scheduled case with no sale date rather than exporting a blank one', () => {
    const { lots, refused } = selectListableLots([lot({ scheduledSaleDate: null })])
    expect(lots).toEqual([])
    expect(refused[0].kind).toBe('no_sale_date')
  })

  it('says nothing about sold or cancelled cases', () => {
    // Not refusals: nobody is about to advertise them, so a refusal line would
    // be noise on a screen whose whole value is that it is read to the end.
    const { lots, refused } = selectListableLots([
      lot({ caseId: 'sold', status: 'sold' }),
      lot({ caseId: 'cancelled', status: 'cancelled' }),
    ])
    expect(lots).toEqual([])
    expect(refused).toEqual([])
  })

  it('splits a mixed facility', () => {
    const { lots, refused } = selectListableLots([
      lot({ caseId: 'ok', unitNumber: 'A-1' }),
      lot({ caseId: 'eligible', unitNumber: 'A-2', status: 'eligible' }),
      lot({
        caseId: 'blocked',
        unitNumber: 'A-3',
        readiness: { ready: false, blockers: [blocker('Vehicle.')] },
      }),
      lot({ caseId: 'gone', unitNumber: 'A-4', status: 'sold' }),
    ])
    expect(lots.map((one) => one.caseId)).toEqual(['ok'])
    expect(refused.map((one) => one.unitNumber)).toEqual(['A-2', 'A-3'])
  })
})
