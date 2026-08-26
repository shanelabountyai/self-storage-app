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
): PlanProblem[] {
  const problems: PlanProblem[] = []

  if (installments.length === 0) {
    return [{ index: null, problem: 'A payment plan needs at least one installment.' }]
  }
  if (installments.length > MAX_INSTALLMENTS) {
    problems.push({ index: null, problem: `A plan can have at most ${MAX_INSTALLMENTS} installments.` })
  }
  if (totalCents <= 0) {
    problems.push({ index: null, problem: 'There is nothing owed to put on a plan.' })
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

  if (sum !== totalCents) {
    problems.push({
      index: null,
      problem: `The installments total ${sum} cents against ${totalCents} cents owed. They must add up exactly — round the last installment to make up the difference.`,
    })
  }

  return problems
}

export type InstallmentStatus = 'paid' | 'upcoming' | 'missed'

export type InstallmentView = PlannedInstallment & {
  position: number
  status: InstallmentStatus
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
): InstallmentView[] {
  let remaining = Math.max(0, paidSincePlanStartCents)
  const ordered = [...installments].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())

  return ordered.map((installment, index) => {
    const covered = remaining >= installment.amountCents
    remaining = covered ? remaining - installment.amountCents : 0
    const status: InstallmentStatus = covered
      ? 'paid'
      : installment.dueDate.getTime() < asOf.getTime()
        ? 'missed'
        : 'upcoming'
    return { ...installment, position: index + 1, status }
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
