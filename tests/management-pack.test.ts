import { describe, expect, it } from 'vitest'
import {
  buildPack,
  provenance,
  type PackInput,
  type PeriodDerivedFigures,
  type PointInTimeFigures,
} from '../packages/core/accounting'
import { renderReportEmail } from '../packages/core/comms'

// PRD 02 US-40 (B-084 part 4). The management pack.

const POINT: PointInTimeFigures = {
  unitOccupancyRatio: 0.9,
  occupiedUnits: 90,
  rentableUnits: 100,
  squareFootRatio: 0.88,
  arD0to10Cents: 1_000,
  arD11to30Cents: 2_000,
  arD31to60Cents: 3_000,
  arD61to90Cents: 4_000,
  arOver90Cents: 5_000,
  arTotalCents: 15_000,
}

const DERIVED: PeriodDerivedFigures = {
  billedCents: 100_000,
  collectedCents: 90_000,
  billedByCategory: { rent: 80_000, fee: 10_000, protection: 5_000, tax: 5_000 },
  collectedByCategory: { rent: 72_000, fee: 9_000, protection: 4_500, tax: 4_500 },
  discountsCents: 12_000,
  referralRewardsCents: 5_000,
  writeOffsCents: 3_000,
  refundsCents: 1_000,
  unappliedCents: 500,
  economicOccupancyRatio: 0.82,
  grossPotentialCents: 110_000,
  moveIns: 4,
  moveOuts: 2,
  netMoves: 2,
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

function input(overrides: Partial<PackInput> = {}): PackInput {
  return {
    facilityName: 'Austin South',
    periodLabel: 'July 2026',
    pointInTime: POINT,
    periodDerived: DERIVED,
    filed: true,
    driftLabels: [],
    links: [{ label: 'Open the monthly close', url: 'https://example.com/admin/reports/close' }],
    ...overrides,
  }
}

describe('the provenance sentence', () => {
  // The most important sentence in the pack: these figures get quoted in a
  // board meeting, and "can this still change?" decides whether they should be.
  it('says a live month can still change, and how to fix that', () => {
    const line = provenance({ filed: false, driftLabels: [], periodLabel: 'July 2026' })
    expect(line).toContain('has not been closed')
    expect(line).toContain('can still change')
    expect(line).toContain('Close the month')
  })

  it('says a filed month with no drift is settled', () => {
    const line = provenance({ filed: true, driftLabels: [], periodLabel: 'July 2026' })
    expect(line).toContain('is closed')
    expect(line).toContain('nothing dated inside the month has changed')
  })

  it('names what drifted, and calls it a restatement rather than an error', () => {
    // A pack that says "closed" while quietly disagreeing with today's query is
    // the worst of the three states, so it is the one that names its figures.
    const line = provenance({
      filed: true,
      driftLabels: ['Billed', 'Move-outs'],
      periodLabel: 'July 2026',
    })
    expect(line).toContain('2 of them')
    expect(line).toContain('Billed, Move-outs')
    expect(line).toContain('restatement to explain')
  })

  it('is three genuinely different sentences', () => {
    const live = provenance({ filed: false, driftLabels: [], periodLabel: 'July 2026' })
    const clean = provenance({ filed: true, driftLabels: [], periodLabel: 'July 2026' })
    const drifted = provenance({ filed: true, driftLabels: ['Billed'], periodLabel: 'July 2026' })
    expect(new Set([live, clean, drifted]).size).toBe(3)
  })
})

describe('what the pack contains', () => {
  const pack = buildPack(input(), money)

  it('leads with the provenance, before any figure', () => {
    expect(pack.intro).toContain('is closed')
  })

  it('separates promotional discounts from referral rewards', () => {
    // Same reasoning as the journal (D-66) and the revenue report: one is a
    // price decision, the other is acquisition cost, and merged they answer
    // neither question. Referral rewards are a SUBSET of discounts, so the
    // promotional line is the difference.
    const rows = pack.sections.flatMap((section) => section.table?.rows ?? [])
    expect(rows).toContainEqual(['Promotional discounts', '$70.00'])
    expect(rows).toContainEqual(['Referral rewards', '$50.00'])
  })

  it('labels tax as held for the state rather than as income', () => {
    const rows = pack.sections.flatMap((section) => section.table?.rows ?? [])
    const tax = rows.find((row) => row[0].startsWith('Tax billed'))
    expect(tax![0]).toContain('held for the state')
  })

  it('says refunds are already deducted, so nobody subtracts them twice', () => {
    const rows = pack.sections.flatMap((section) => section.table?.rows ?? [])
    const refund = rows.find((row) => row[0].startsWith('Refunded'))
    expect(refund![0]).toContain('already deducted')
  })

  it('marks the over-90 bucket with a word, not a colour', () => {
    const rows = pack.sections.flatMap((section) => section.table?.rows ?? [])
    expect(rows.some((row) => row[0] === 'Over 90 days — needs attention')).toBe(true)
  })

  it('says which figures were taken at a moment and cannot be recomputed', () => {
    // D-65 on the page rather than only in a decision log: an owner comparing
    // two months needs to know occupancy is a snapshot, not an average.
    const occupancy = pack.sections.find((section) => section.heading === 'How full it was')
    expect(occupancy!.paragraphs!.join(' ')).toContain('not averaged over it')
    expect(pack.footer).toContain('cannot be recomputed for a past month')
  })

  it('covers all five questions an owner asks', () => {
    expect(pack.sections.map((section) => section.heading)).toEqual([
      'How full it was',
      'What it earned',
      'What it gave away or lost',
      'What was owed',
      'Who came and went',
    ])
  })
})

describe('the pack is one document, rendered two ways', () => {
  it('renders through the FR-9a email renderer without losing anything', () => {
    // The reason it is built as an EmailDocument: a pack an owner OPENS and a
    // pack an owner is SENT must not be able to say different things about the
    // same month.
    const rendered = renderReportEmail(buildPack(input(), money))
    expect(rendered.html).toContain('<html lang="en">')
    expect(rendered.html).toContain('<th scope="row"')
    expect(rendered.text).toContain('How full it was')
    expect(rendered.text).toContain('$800.00') // rent billed
    for (const section of buildPack(input(), money).sections) {
      expect(rendered.text).toContain(section.heading)
    }
  })

  it('carries the drift warning into the emailed version too', () => {
    const rendered = renderReportEmail(buildPack(input({ driftLabels: ['Billed'] }), money))
    expect(rendered.text).toContain('restatement to explain')
  })
})
