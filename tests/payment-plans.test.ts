import { describe, expect, it } from 'vitest'
import {
  MAX_INSTALLMENTS,
  evenSchedule,
  installmentViews,
  isBreached,
  isFullyPaid,
  problemsByRow,
  validateSchedule,
  type PlannedInstallment,
} from '../packages/core/payment-plans'

// PRD 02 §4.6 US-25 / PRD 01 §9 (B-090 part 3). The schedule and the breach
// rule, pure.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function schedule(...pairs: [string, number][]): PlannedInstallment[] {
  return pairs.map(([iso, amountCents]) => ({ dueDate: d(iso), amountCents }))
}

describe('validateSchedule', () => {
  it('refuses an empty schedule', () => {
    expect(validateSchedule([], 0, d('2026-08-01'))).toEqual([
      { index: null, problem: 'A payment plan needs at least one installment.' },
    ])
  })

  it('refuses more than MAX_INSTALLMENTS rows', () => {
    const rows = Array.from({ length: MAX_INSTALLMENTS + 1 }, (_, i) => [
      `2026-0${(i % 9) + 1}-01`,
      100,
    ]) as [string, number][]
    const problems = validateSchedule(schedule(...rows), rows.length * 100, d('2026-01-01'))
    expect(problems.some((p) => p.problem.includes('at most'))).toBe(true)
  })

  it('refuses a schedule that finishes past the facility ceiling (D-98)', () => {
    // The count cap alone caps nothing that matters: six installments spaced
    // sixty days apart halt dunning, late fees and access suspension for a
    // year while the lien clock never runs.
    const problems = validateSchedule(
      schedule(['2026-09-01', 5000]),
      5000,
      d('2026-08-01'),
      15,
    )
    expect(problems.some((p) => p.problem.includes('15 days'))).toBe(true)

    // Inside the window, and unlimited when no ceiling is passed — which is
    // what every pre-D-98 caller has.
    expect(validateSchedule(schedule(['2026-09-01', 5000]), 5000, d('2026-08-01'), 90)).toEqual([])
    expect(validateSchedule(schedule(['2028-09-01', 5000]), 5000, d('2026-08-01'))).toEqual([])
  })

  it('refuses installments that do not add up to the arrears, in dollars', () => {
    // B-188 made this branch reachable: `totalCents` is now the lease's actual
    // past-due balance, not the sum of these same installments, so the message
    // is one a staffer reads on the form.
    const problems = validateSchedule(schedule(['2026-09-01', 5000]), 180_000, d('2026-08-01'))
    expect(problems.some((p) => p.problem.includes('add up exactly'))).toBe(true)
    expect(problems.some((p) => p.problem.includes('$50.00') && p.problem.includes('$1800.00'))).toBe(
      true,
    )
  })

  it('refuses a plan when nothing is past due, and says only that', () => {
    expect(validateSchedule(schedule(['2026-09-01', 5000]), 0, d('2026-08-01'))).toEqual([
      { index: null, problem: 'There is nothing past due on this lease to put on a plan.' },
    ])
  })

  it('refuses a due date on or before the day the plan is created', () => {
    const problems = validateSchedule(schedule(['2026-08-01', 5000]), 5000, d('2026-08-01'))
    expect(problems.some((p) => p.problem.includes('must be in the future'))).toBe(true)
  })

  it('refuses two installments on the same date', () => {
    const installments = [
      { dueDate: d('2026-09-01'), amountCents: 5000 },
      { dueDate: d('2026-09-01'), amountCents: 5000 },
    ]
    const problems = validateSchedule(installments, 10000, d('2026-08-01'))
    expect(problems.some((p) => p.problem.includes('date order'))).toBe(true)
  })

  it('refuses a non-positive installment amount', () => {
    const problems = validateSchedule(schedule(['2026-09-01', 0]), 5000, d('2026-08-01'))
    expect(problems.some((p) => p.problem.includes('positive amount'))).toBe(true)
  })

  it('accepts a schedule that adds up, in order, all in the future', () => {
    const installments = schedule(['2026-09-01', 5000], ['2026-10-01', 5000])
    expect(validateSchedule(installments, 10000, d('2026-08-01'))).toEqual([])
  })
})

describe('installmentViews', () => {
  const installments = schedule(['2026-09-01', 5000], ['2026-10-01', 5000], ['2026-11-01', 5000])

  it('allocates cumulative payments oldest-first', () => {
    const views = installmentViews(installments, 7000, d('2026-09-15'))
    expect(views.map((v) => v.status)).toEqual(['paid', 'upcoming', 'upcoming'])
  })

  it('marks an installment missed once its due date has passed unpaid', () => {
    const views = installmentViews(installments, 0, d('2026-09-02'))
    expect(views[0].status).toBe('missed')
    expect(views[1].status).toBe('upcoming')
  })

  it('gives the due date itself, not the moment after, to pay', () => {
    // asOf strictly equal to the due date has not yet passed it.
    const views = installmentViews(installments, 0, d('2026-09-01'))
    expect(views[0].status).toBe('upcoming')
  })

  it('a partial payment does not cover the installment it falls short of', () => {
    const views = installmentViews(installments, 4999, d('2026-09-15'))
    expect(views[0].status).toBe('missed')
  })

  // B-210. D-98's grace window reached only the breach job, so every screen
  // and both plan emails called a payment one day late a broken promise while
  // the plan was in fact alive for three more days.
  it('reads an installment inside the grace window as late, not missed', () => {
    const views = installmentViews(installments, 0, d('2026-09-02'), 3)
    expect(views[0].status).toBe('late')
    expect(views[0].graceEndsOn).toEqual(d('2026-09-04'))
  })

  it('is missed once the grace window itself has passed', () => {
    expect(installmentViews(installments, 0, d('2026-09-04'), 3)[0].status).toBe('late')
    expect(installmentViews(installments, 0, d('2026-09-05'), 3)[0].status).toBe('missed')
  })

  // The breach job moves its own clock back by the same number of days rather
  // than passing `graceDays`; the two must land on the identical boundary or a
  // plan breaks on a night the portal says it is still alive.
  it('lands on the same boundary as a clock moved back by the grace', () => {
    const shifted = (asOf: string) =>
      installmentViews(installments, 0, new Date(d(asOf).getTime() - 3 * 86_400_000))[0].status ===
      'missed'
    for (const day of ['2026-09-01', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-20']) {
      expect(installmentViews(installments, 0, d(day), 3)[0].status === 'missed').toBe(shifted(day))
    }
  })

  it('with no grace configured, behaves exactly as it did before', () => {
    expect(installmentViews(installments, 0, d('2026-09-02'), 0)[0].status).toBe('missed')
    expect(installmentViews(installments, 0, d('2026-09-02'), 0)[0].graceEndsOn).toEqual(
      d('2026-09-01'),
    )
  })

  it('numbers installments by schedule order, not input order', () => {
    const outOfOrder = [installments[2], installments[0], installments[1]]
    const views = installmentViews(outOfOrder, 0, d('2026-08-15'))
    expect(views.map((v) => v.position)).toEqual([1, 2, 3])
    expect(views[0].dueDate).toEqual(d('2026-09-01'))
  })
})

describe('isBreached / isFullyPaid', () => {
  const installments = schedule(['2026-09-01', 5000], ['2026-10-01', 5000])

  it('is not breached while every passed installment is covered', () => {
    expect(isBreached(installments, 5000, d('2026-09-15'))).toBe(false)
  })

  it('is breached once a due date passes uncovered', () => {
    expect(isBreached(installments, 0, d('2026-09-02'))).toBe(true)
  })

  it('is not breached on the due date itself', () => {
    expect(isBreached(installments, 0, d('2026-09-01'))).toBe(false)
  })

  it('is fully paid once cumulative payments reach the total', () => {
    expect(isFullyPaid(installments, 9999)).toBe(false)
    expect(isFullyPaid(installments, 10000)).toBe(true)
    expect(isFullyPaid(installments, 20000)).toBe(true)
  })

  it('an empty schedule is never fully paid', () => {
    expect(isFullyPaid([], 100)).toBe(false)
  })
})

// B-192 / WCAG 3.3.1. The builder sends a COMPACTED array — blank rows are
// dropped — so a problem's index is not the form row it came from, and the
// whole value of this function is that it does not assume they are.
describe('problemsByRow', () => {
  it('maps an installment problem back to the form row it came from', () => {
    // Rows 1, 2 and 5 filled: problem index 2 is form row 5, not row 3.
    const byRow = problemsByRow(
      [{ index: 2, problem: 'Installments must be in date order, one per date.' }],
      [1, 2, 5],
    )
    expect([...byRow]).toEqual([
      [5, 'Installments must be in date order, one per date.'],
    ])
  })

  it('drops the problems that are about the plan rather than an installment', () => {
    expect(problemsByRow([{ index: null, problem: 'The installments total …' }], [1]).size).toBe(0)
  })

  it('joins two problems on one installment rather than losing the first', () => {
    const byRow = problemsByRow(
      [
        { index: 0, problem: 'Each installment needs a positive amount.' },
        { index: 0, problem: 'Each installment date must be in the future.' },
      ],
      [3],
    )
    expect(byRow.get(3)).toBe(
      'Each installment needs a positive amount. Each installment date must be in the future.',
    )
  })

  it('ignores an index with no row behind it rather than keying on undefined', () => {
    expect(problemsByRow([{ index: 4, problem: 'x' }], [1, 2]).size).toBe(0)
  })
})

// B-212. The even split the builder offers, which exists only because
// `validateSchedule` demands cent-exact arithmetic across twelve fields and a
// staffer was doing it in their head at a counter. The property that matters
// is the one the refusal states: it must ADD UP EXACTLY, every time.
describe('evenSchedule', () => {
  it('adds up to the arrears exactly, at every count', () => {
    // 1,837.42 is the row's own example — the sum nobody should do by hand.
    for (const total of [183742, 100, 999_99, 7, 1]) {
      for (let count = 1; count <= MAX_INSTALLMENTS; count++) {
        const rows = evenSchedule(total, count, '2026-09-01')
        expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(total)
        // `validateSchedule` refuses a zero or negative installment, so a
        // "fill this in for me" control must never produce one.
        expect(rows.every((row) => row.amountCents > 0)).toBe(true)
      }
    }
  })

  it('produces a schedule validateSchedule accepts', () => {
    const rows = evenSchedule(183742, 6, '2026-09-30')
    const problems = validateSchedule(
      rows.map((row) => ({ dueDate: d(row.dueDate), amountCents: row.amountCents })),
      183742,
      d('2026-08-31'),
    )
    expect(problems).toEqual([])
  })

  it('clamps the day of month rather than rolling into the next one', () => {
    // Naive month arithmetic turns 31 January into 3 March, which puts two
    // installments in March and is refused for being out of order.
    expect(evenSchedule(600, 4, '2026-01-31').map((row) => row.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('never asks for more installments than there are cents, or than the form has rows', () => {
    expect(evenSchedule(3, 6, '2026-09-01')).toHaveLength(3)
    expect(evenSchedule(100_000, MAX_INSTALLMENTS + 2, '2026-09-01')).toHaveLength(MAX_INSTALLMENTS)
  })
})
