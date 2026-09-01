// PRD 02 §4.6 US-25 / PRD 01 §9 (B-090 part 3). A `payment_plan` hold has
// halted the pipeline since B-096; this is the schedule it was always
// missing. Pure, and separated from the database for the same reason
// `packages/core/delinquency` is: whether a plan has been kept or broken is a
// dispute-relevant fact, and every boundary in that decision should be
// checkable without a clock or a query.

export type PlannedInstallment = {
  dueDate: Date
  amountCents: number
}

export type PlanProblem = {
  index: number | null
  problem: string
}

// ponytail: a plain form with one row per installment, not a dynamic
// add/remove list — a fixed ceiling keeps the builder a static form with no
// client-side row management. 6 months covers what an operator would agree
// to at the counter; the form in `page.tsx` renders exactly this many rows.
// Raise both together if a real plan ever needs more.
export const MAX_INSTALLMENTS = 6

/// What a proposed schedule must satisfy before it can be agreed. Refuses
/// rather than warns, same posture as `validateTimeline`: a plan that doesn't
/// add up to what's owed is a promise nobody can point to later.
export function validateSchedule(
  installments: readonly PlannedInstallment[],
  totalCents: number,
  createdAt: Date,
  /// D-98 (B-190). How far from agreement the LAST installment may fall.
  /// `MAX_INSTALLMENTS` caps the count and on its own caps nothing that
  /// matters: six installments spaced sixty days apart halt dunning, late fees
  /// and access suspension for a year while the lien clock does not run.
  /// Omitted means no day cap, which is what every pre-D-98 caller had.
  maxDays?: number,
): PlanProblem[] {
  const problems: PlanProblem[] = []

  if (installments.length === 0) {
    return [{ index: null, problem: 'A payment plan needs at least one installment.' }]
  }
  if (installments.length > MAX_INSTALLMENTS) {
    problems.push({ index: null, problem: `A plan can have at most ${MAX_INSTALLMENTS} installments.` })
  }
  // Alone, not pushed alongside the sum mismatch below: "nothing is past due"
  // and "your installments total $300 against $0 past due" are the same fact
  // said twice, and the second reads as arithmetic advice on a plan that
  // should not exist.
  if (totalCents <= 0) {
    return [{ index: null, problem: 'There is nothing past due on this lease to put on a plan.' }]
  }

  // D-98's day cap, checked before the per-installment loop so that a plan
  // stretched too far is refused once rather than once per late row.
  if (maxDays !== undefined && maxDays > 0) {
    const last = installments.reduce(
      (latest, installment) =>
        installment.dueDate.getTime() > latest ? installment.dueDate.getTime() : latest,
      0,
    )
    const limit = createdAt.getTime() + maxDays * 86_400_000
    if (last > limit) {
      problems.push({
        index: null,
        problem: `A payment plan at this facility has to finish within ${maxDays} days — the last installment here is later than that. Bring the dates in, or ask for the limit to be changed in settings.`,
      })
    }
  }

  let sum = 0
  let lastDueDate: Date | null = null
  installments.forEach((installment, index) => {
    if (!Number.isInteger(installment.amountCents) || installment.amountCents <= 0) {
      problems.push({ index, problem: 'Each installment needs a positive amount.' })
    }
    if (installment.dueDate.getTime() <= createdAt.getTime()) {
      problems.push({ index, problem: 'Each installment date must be in the future.' })
    }
    if (lastDueDate && installment.dueDate.getTime() <= lastDueDate.getTime()) {
      problems.push({ index, problem: 'Installments must be in date order, one per date.' })
    }
    lastDueDate = installment.dueDate
    sum += installment.amountCents
  })

  // Reachable since B-188, and the check the whole feature rests on. Until
  // then `totalCents` was the sum of these same installments, so this could
  // not fire from the only production caller and a $50 plan against an $1,800
  // arrear validated. `totalCents` is now the lease's actual arrears, which is
  // what makes the comparison mean something — and the message is in dollars
  // because a staffer reads it on the form (it said "cents" while it was
  // unreachable).
  if (sum !== totalCents) {
    problems.push({
      index: null,
      problem: `The installments total ${dollars(sum)} against ${dollars(totalCents)} past due on this lease. They must add up exactly — round the last installment to make up the difference.`,
    })
  }

  return problems
}

/// B-192 / WCAG 3.3.1. Re-key the problems that belong to an installment onto
/// the FORM ROW each one came from, so a refusal can land on the field that
/// caused it instead of being joined into one page-level sentence.
///
/// The re-keying is the whole point and is not cosmetic: `validateSchedule`
/// numbers its problems by position in the array it was handed, and the
/// builder compacts that array — a staffer who fills rows 1, 2 and 5 sends
/// three installments, so problem index 2 is row 5. Reporting it against the
/// third row would put the message on an empty group two rows above the field
/// at fault, which is worse than the summary it replaces.
///
/// `rows[i]` is the form row installment `i` came from. Problems with a null
/// index are about the PLAN — the total mismatch, the day cap, an empty
/// schedule — and have no field to land on; they are left to the caller's
/// summary line rather than attached to an arbitrary row.
export function problemsByRow(
  problems: readonly PlanProblem[],
  rows: readonly number[],
): Map<number, string> {
  const byRow = new Map<number, string>()
  for (const { index, problem } of problems) {
    if (index === null) continue
    const row = rows[index]
    if (row === undefined) continue
    const existing = byRow.get(row)
    byRow.set(row, existing ? `${existing} ${problem}` : problem)
  }
  return byRow
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/// D-97. Whether a plan's installments will ACTUALLY be charged — which is
/// three separate facts, and no screen or message may conflate them: the plan
/// was agreed as auto-collect, the lease has autopay on, and the tenant has a
/// card saved. A plan agreed as automatic against a card since removed will
/// collect nothing, and telling somebody their payment is taken care of when it
/// is not is how they end up in collections believing they kept to the plan.
///
/// Here rather than in each caller because there are now four of them — the
/// plan view, the breach job, the autopay run and (B-191) the message that
/// tells the tenant which kind of plan they are on — and three of them had
/// their own copy of the expression.
export function isAutoCollecting(input: {
  autoCollect: boolean
  autopayEnabled: boolean
  hasSavedCard: boolean
}): boolean {
  return input.autoCollect && input.autopayEnabled && input.hasSavedCard
}

/// B-210. `late` is a fourth state, not a shade of `missed`: D-98's grace
/// window was applied ONLY inside the breach job, by shifting its own clock,
/// so every screen and message read the day after a due date as a broken
/// promise while the plan was in fact alive for `planGraceDays` more. Telling
/// a tenant their plan has ended when it has not is the same class of harm as
/// telling them a payment is taken care of when it is not (D-97) — it is a
/// reason to stop trying.
export type InstallmentStatus = 'paid' | 'upcoming' | 'late' | 'missed'

export type InstallmentView = PlannedInstallment & {
  position: number
  status: InstallmentStatus
  /// The last day this installment can be paid without breaking the plan —
  /// `dueDate` plus the facility's grace. Equal to `dueDate` where there is no
  /// grace. Carried on the view rather than recomputed per screen because it
  /// is the deadline the tenant is held to, and three screens and two emails
  /// state it.
  graceEndsOn: Date
}

/// Which installments a cumulative amount paid since the plan started covers.
///
/// No stored per-installment "paid" flag by design (see the schema comment on
/// `PaymentPlanInstallment`): this allocates whatever has actually been paid
/// against the lease, oldest installment first, and derives status from that
/// — a promise-to-pay schedule is a floor on cumulative payments by each
/// date, not a ledger of which dollar went to which line. A tenant who pays
/// the whole plan off in one visit clears every installment at once, exactly
/// as they should.
export function installmentViews(
  installments: readonly PlannedInstallment[],
  paidSincePlanStartCents: number,
  asOf: Date,
  /// D-98's grace window (`Facility.planGraceDays`), in days. Zero — the
  /// default, and what every pre-B-210 caller had — makes `late` unreachable
  /// and reproduces the old two-state behaviour exactly.
  ///
  /// `evaluatePaymentPlanBreaches` passes a clock already moved back by the
  /// same number of days instead, which lands on the identical boundary
  /// (`dueDate + grace < asOf`); it stays that way because the breach job
  /// measures the retry ladder against the unshifted date in the same call and
  /// must not net the two windows against each other.
  graceDays = 0,
): InstallmentView[] {
  let remaining = Math.max(0, paidSincePlanStartCents)
  const ordered = [...installments].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())

  return ordered.map((installment, index) => {
    const covered = remaining >= installment.amountCents
    remaining = covered ? remaining - installment.amountCents : 0
    const graceEndsOn = new Date(installment.dueDate.getTime() + Math.max(0, graceDays) * 86_400_000)
    const status: InstallmentStatus = covered
      ? 'paid'
      : graceEndsOn.getTime() < asOf.getTime()
        ? 'missed'
        : installment.dueDate.getTime() < asOf.getTime()
          ? 'late'
          : 'upcoming'
    return { ...installment, position: index + 1, status, graceEndsOn }
  })
}

/// Whether the schedule has been broken as of `asOf` — any installment whose
/// due date has passed without being covered by cumulative payments.
export function isBreached(
  installments: readonly PlannedInstallment[],
  paidSincePlanStartCents: number,
  asOf: Date,
): boolean {
  return installmentViews(installments, paidSincePlanStartCents, asOf).some(
    (view) => view.status === 'missed',
  )
}

/// Whether every installment is covered — the plan can be closed out as kept.
export function isFullyPaid(
  installments: readonly PlannedInstallment[],
  paidSincePlanStartCents: number,
): boolean {
  if (installments.length === 0) return false
  const total = installments.reduce((sum, installment) => sum + installment.amountCents, 0)
  return paidSincePlanStartCents >= total
}

/// B-212. The arithmetic `validateSchedule`'s own refusal tells a staffer to
/// do — "they must add up exactly — round the last installment to make up the
/// difference" — done for them, because they are doing it in their head, in
/// front of a tenant, over up to twelve fields. $1,837.42 over six months is
/// not a sum anybody should be asked to compact by hand at a counter.
///
/// A SUGGESTION, never a constraint: it fills the same fields the staffer can
/// then edit, and `validateSchedule` remains the only thing that decides
/// whether a schedule may be agreed. Nothing here is a second copy of that
/// rule — it just produces a schedule that happens to satisfy it.
///
/// FLOOR on every installment but the last, remainder on the last, so the last
/// is the largest. Ceiling-and-shrink reads slightly better and can produce a
/// final installment of zero on a small arrears (20¢ over six is 4,4,4,4,4,0),
/// which `validateSchedule` then refuses — a "fill this in for me" control that
/// yields a refused form is the defect this row is fixing, not a new one.
///
/// Dates are `yyyy-mm-dd` because this fills `<input type="date">`. Monthly
/// from `startDate`, with the day of month CLAMPED to the length of each target
/// month: naive month arithmetic turns 31 January into 3 March and puts two
/// installments in the same month, which `validateSchedule` refuses for being
/// out of order.
export function evenSchedule(
  totalCents: number,
  count: number,
  startDate: string,
): { dueDate: string; amountCents: number }[] {
  // Never more rows than the form has, and never so many that an installment
  // rounds down to nothing.
  const n = Math.max(1, Math.min(count, MAX_INSTALLMENTS, totalCents))
  const each = Math.floor(totalCents / n)
  return Array.from({ length: n }, (_, i) => ({
    dueDate: addMonths(startDate, i),
    amountCents: i === n - 1 ? totalCents - each * (n - 1) : each,
  }))
}

function addMonths(startDate: string, months: number): string {
  const [year, month, day] = startDate.split('-').map(Number)
  if (!year || !month || !day) return startDate
  // Day 0 of the following month is the last day of the target month.
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate()
  const target = new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay)))
  return target.toISOString().slice(0, 10)
}
