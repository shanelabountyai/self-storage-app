import type { EmailDocument, EmailSection } from '../comms/report-email.ts'
import type { PeriodDerivedFigures, PointInTimeFigures } from './close.ts'

// PRD 02 US-40 (B-084 part 4). The monthly management pack.
//
// **HTML, not the PDF US-40 names** — D-64. No JavaScript PDF library in this
// runtime emits *tagged* PDFs, and an untagged one is a screen-reader dead end.
//
// Built as an `EmailDocument`, the structure part 3 defined, for a reason that
// is not laziness: a management pack is a thing an owner both OPENS and is
// SENT, and building it as one document means the page and the email cannot
// say different things about the same month. The FR-9a renderer then makes the
// emailed version accessible for free.
//
// Pure. What varies — whether the figures are filed or live — arrives as a
// flag, so both cases are testable without a database.

export type PackInput = {
  facilityName: string
  periodLabel: string
  pointInTime: PointInTimeFigures
  periodDerived: PeriodDerivedFigures
  /// Whether these came from a filed close (part 1) or were read live.
  filed: boolean
  /// When a filed month's figures no longer match what the same query returns
  /// today. Empty is not the same as absent — see `provenance`.
  driftLabels: string[]
  /// B-234. Auction surpluses still held, read AT THE MOMENT THE PACK IS BUILT
  /// rather than for the month — see the section's own paragraph. Empty means
  /// there are none, and the section is omitted entirely.
  heldSurpluses: HeldSurplus[]
  links: { label: string; url: string }[]
}

/// One held surplus, as the pack states it.
export type HeldSurplus = {
  unitNumber: string
  tenantName: string
  amountCents: number
  /// When the holding period runs out. Null only for a row whose sale predates
  /// the deadline being recorded.
  holdUntil: Date | null
  overdue: boolean
  notified: boolean
}

/// The sentence that says how much the numbers below can be trusted.
///
/// First, not last, and never omitted. A management pack's figures get quoted
/// in a board meeting, and "can this change?" is the question that determines
/// whether they should be. Three genuinely different states, three different
/// sentences — collapsing them into "monthly figures" is what makes a live
/// number get read as a final one.
export function provenance(input: Pick<PackInput, 'filed' | 'driftLabels' | 'periodLabel'>): string {
  if (!input.filed) {
    return `${input.periodLabel} has not been closed, so every figure here was read live and can still change. Close the month to fix them.`
  }
  if (input.driftLabels.length === 0) {
    return `${input.periodLabel} is closed. These are the filed figures, and nothing dated inside the month has changed since.`
  }
  return (
    `${input.periodLabel} is closed and these are the filed figures — but ${input.driftLabels.length} of them ` +
    `(${input.driftLabels.join(', ')}) no longer match what the same query returns today. ` +
    'Something dated inside the month has changed since it was filed. Treat the difference as a restatement to explain, not as an error in this pack.'
  )
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

/// Assembles the pack.
///
/// `money` is injected rather than imported so this module stays free of the
/// app's formatting layer and the tests can read plain numbers.
export function buildPack(input: PackInput, money: (cents: number) => string): EmailDocument {
  const point = input.pointInTime
  const derived = input.periodDerived
  const halted = point.arHalted

  /// One aging row, three columns when the split was recorded and two when it
  /// was not. Chased is derived rather than stored — the snapshot keeps the
  /// total and the halted half, and the third figure is arithmetic.
  const arRow = (label: string, total: number, haltedCents?: number): string[] =>
    haltedCents === undefined
      ? [label, money(total)]
      : [label, money(total - haltedCents), money(haltedCents), money(total)]

  const sections: EmailSection[] = [
    {
      heading: 'How full it was',
      // Labelled as at-the-time rather than for-the-period, because that is
      // what it is (D-65) and a reader comparing two months needs to know.
      paragraphs: ['Measured at the moment the month was filed, not averaged over it.'],
      table: {
        caption: `Occupancy at the end of ${input.periodLabel}`,
        columns: ['Measure', 'Value'],
        rows: [
          ['Unit occupancy', percent(point.unitOccupancyRatio)],
          ['Occupied of rentable', `${point.occupiedUnits} of ${point.rentableUnits}`],
          ['Square-foot occupancy', percent(point.squareFootRatio)],
          ['Economic occupancy', percent(derived.economicOccupancyRatio)],
          ['Gross potential at street', money(derived.grossPotentialCents)],
        ],
      },
    },
    {
      heading: 'What it earned',
      table: {
        caption: `Billed and collected in ${input.periodLabel}`,
        columns: ['Measure', 'Amount'],
        rows: [
          ['Billed', money(derived.billedCents)],
          ['Collected', money(derived.collectedCents)],
          ['Rent billed', money(derived.billedByCategory.rent)],
          ['Fees billed', money(derived.billedByCategory.fee)],
          ['Protection billed', money(derived.billedByCategory.protection)],
          ['Tax billed — held for the state, not income', money(derived.billedByCategory.tax)],
        ],
      },
    },
    {
      heading: 'What it gave away or lost',
      // Together in one section on purpose: an owner reading a discount figure
      // without the write-offs beside it is reading half the story about why
      // collected is below billed.
      table: {
        caption: `Reductions in ${input.periodLabel}`,
        columns: ['Measure', 'Amount'],
        rows: [
          ['Promotional discounts', money(derived.discountsCents - derived.referralRewardsCents)],
          ['Referral rewards', money(derived.referralRewardsCents)],
          ['Written off', money(derived.writeOffsCents)],
          ['Refunded — already deducted from collected', money(derived.refundsCents)],
          ['Received but not yet applied', money(derived.unappliedCents)],
        ],
      },
    },
    {
      heading: 'What was owed',
      // B-207. Split into what the collections ladder was working and what was
      // halted behind a hold. A month closed before that was recorded has no
      // split, and says so rather than reporting a zero halted figure that
      // would read as "everything was being chased".
      paragraphs: [
        'Measured at the moment the month was filed. There is no way to recompute it later.',
        halted
          ? 'Halted means a hold had stopped the collections ladder — an agreed payment plan, a bankruptcy, a deployment, a death. Nothing was being sent about it.'
          : 'This month was filed before the chased/halted split was recorded, so the total is all this pack can say.',
      ],
      table: {
        caption: 'Outstanding balances by age',
        columns: halted ? ['Age', 'Being chased', 'Halted', 'Total'] : ['Age', 'Amount'],
        rows: [
          arRow('Not yet 11 days', point.arD0to10Cents, halted?.d0to10),
          arRow('11 to 30 days', point.arD11to30Cents, halted?.d11to30),
          arRow('31 to 60 days', point.arD31to60Cents, halted?.d31to60),
          arRow('61 to 90 days', point.arD61to90Cents, halted?.d61to90),
          // The words, never a colour (FR-9a) — and this is the row somebody
          // has to act on.
          arRow('Over 90 days — needs attention', point.arOver90Cents, halted?.over90),
          arRow('Total owed', point.arTotalCents, halted?.totalCents),
        ],
      },
    },
    {
      heading: 'Who came and went',
      table: {
        caption: `Moves in ${input.periodLabel}`,
        columns: ['Measure', 'Count'],
        rows: [
          ['Move-ins', String(derived.moveIns)],
          ['Move-outs', String(derived.moveOuts)],
          ['Net', String(derived.netMoves)],
        ],
      },
    },
  ]

  // B-234. Only when there are any, and last: a pack that opens with an empty
  // liability table teaches an owner to scroll past the section, which is the
  // habit that let a surplus sit unread for the year its hold ran.
  //
  // US-28's own words: a surplus is a liability with a statutory life, not
  // revenue. It is in the pack rather than only on one facility's auctions
  // screen because a single-facility screen is exactly what failed — nobody
  // opens it at a site with no live cases, and the pack is the document an
  // owner actually reads.
  if (input.heldSurpluses.length > 0) {
    const overdue = input.heldSurpluses.filter((row) => row.overdue)
    sections.push({
      heading: 'Sale money still being held',
      paragraphs: [
        // Said plainly, because everything else in this pack is as-at-the-month
        // and this is not. A liability read for a closed month would be a
        // figure that is already wrong on the day the pack is opened.
        'Read at the moment this pack was built, not as at the end of the month — unlike every figure above. A surplus is a liability with a statutory life, not revenue.',
        overdue.length > 0
          ? `${overdue.length} of these are past the holding period this facility is set to and must be paid out or remitted now.`
          : 'None of these are past the holding period this facility is set to yet.',
        'The holding period is this facility’s own configuration, not a legal figure. Ask your attorney what your state requires.',
      ],
      table: {
        caption: 'Auction surpluses not yet paid out or remitted',
        columns: ['Unit', 'Former tenant', 'Amount', 'Hold ends', 'Status'],
        rows: input.heldSurpluses.map((row) => [
          row.unitNumber,
          row.tenantName,
          money(row.amountCents),
          row.holdUntil ? row.holdUntil.toISOString().slice(0, 10) : 'Not recorded',
          // The words, never a colour (FR-9a), and both facts on one line:
          // an overdue surplus the former tenant was never told about is a
          // worse position than an overdue one they have been chasing.
          [
            row.overdue ? 'Past the holding period' : 'Within the holding period',
            row.notified ? 'former tenant notified' : 'former tenant NOT yet notified',
          ].join(' — '),
        ]),
      },
    })
  }

  return {
    title: `Management pack — ${input.facilityName}, ${input.periodLabel}`,
    intro: provenance(input),
    sections,
    links: input.links,
    footer:
      'Figures come from the same reporting layer the dashboard reads, so this pack and the screens cannot disagree. ' +
      'Occupancy and the aging above are taken at a moment and cannot be recomputed for a past month; everything else is derived from dated rows.',
  }
}
