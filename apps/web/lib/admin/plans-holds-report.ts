import { prisma } from '@storage/db'
import { installmentViews, type InstallmentView } from '@storage/core/payment-plans'
import { financialFacilities } from '@/lib/admin/reports'
import { activeHoldsByLease, type HoldInForce } from '@/lib/admin/holds'
import { planProgressByPlan } from '@/lib/admin/payment-plans'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.7 US-39.4, §4.6 US-25/US-26, §4.5 US-42 (B-195). Who is halted,
// why, and whether the plans are working.
//
// ── The hole this fills ──────────────────────────────────────────────────────
//
// The aging report's arithmetic was always right and never said the one thing
// that decides what to do about it. A regional looking at $40,000 in the 90+
// bucket could not tell whether it was being chased, was under an agreed plan,
// or had been halted behind a bankruptcy hold nobody had opened in four
// months — and a manager could not answer "who is on a plan at my site" from
// any screen in the product, because the delinquency engine filters an on-hold
// lease out of the queue and nothing else lists them.
//
// So: `delinquency-detail.ts` splits each bucket into chased and halted, and
// this file is the list behind the halted half.
//
// ── Two questions, two clocks, and they are not interchangeable (D-65) ───────
//
// `haltedLeases` answers AS OF NOW and cannot answer for a date range: holds
// and plan status keep no history, exactly like `Unit.status`, so "who was
// halted last March" is a question this schema cannot answer and this report
// must not appear to. It takes an instant, never a range — the same defect
// B-131, B-150 and B-183 each found in turn.
//
// `planEffectiveness` DOES take a range, and legitimately: `createdAt`,
// `brokenAt` and `completedAt` are timestamps on the plan row, so "plans
// agreed in March" is a fact the schema holds. What it still cannot do is
// value them as of the end of that range — progress is read from the invoices
// now — so the figure is named for what it is and the screen says so.

export type HaltedLeaseRow = {
  leaseId: string
  facilityId: string
  facilityName: string
  tenantId: string
  tenantName: string
  unitNumber: string
  leaseStatus: string
  /// Every hold in force that stops the chasing, oldest first. The LABEL, not
  /// the type key — "halted" with no reason beside it is the same dead end as
  /// no split at all.
  holdLabels: string[]
  /// Holds in force that do NOT halt dunning — a `do_not_contact` sitting
  /// beside a plan, say. Listed separately because a lease can carry both and
  /// summing them would make this screen claim more is halted than is.
  otherHoldLabels: string[]
  haltedSince: Date
  daysHalted: number
  /// The lease's outstanding balance — the money that is not being chased
  /// while this hold stands. The ledger, same definition as everywhere else
  /// (PRD 01 §7.3), so this column sums to the aging report's halted total.
  deferredCents: number
  /// The live plan, when there is one. A hold without a plan is the case that
  /// matters most here: it is deferral with nothing agreed in return.
  plan: HaltedPlanSummary | null
}

export type HaltedPlanSummary = {
  id: string
  status: 'active' | 'completed' | 'broken' | 'cancelled'
  totalCents: number
  /// What the plan has RETIRED, however it came down — `PlanProgress.progressCents`,
  /// the figure `installmentViews` below is measured against, so this row and
  /// its next-installment cell cannot disagree. Deliberately not the
  /// effectiveness table's `collectedCents`, which excludes waivers; the
  /// screen and the export say "cleared" for exactly that reason (B-209).
  collectedCents: number
  /// The next installment not yet covered, or null once every one is. Derived
  /// through `installmentViews` rather than by reading a stored flag, which is
  /// the only definition of "paid" this product has (see the schema comment on
  /// `PaymentPlanInstallment`).
  nextInstallment: InstallmentView | null
  /// Installments whose date has passed uncovered. A plan reading "active"
  /// with a missed installment is one the breach job has not yet run over.
  missedCount: number
}

export type PlanEffectiveness = {
  /// Plans AGREED in the period, and what they promised to clear.
  agreedCount: number
  agreedCents: number
  /// What those same plans have actually COLLECTED — as of now, not as of the
  /// end of the period. See the note at the top of the file.
  ///
  /// Allocations only (B-209). Progress, which is what the schedule is
  /// measured against, also comes down when a manager voids a covered invoice
  /// — right there, wrong here: this is the figure an owner uses to decide
  /// whether plans work at all, and waiving $600 of fees to make four plans
  /// agreeable read as $600 collected.
  collectedCents: number
  /// The forgiven half of that same reduction, shown beside it rather than
  /// dropped. It is not a smaller number for being the wrong kind of money —
  /// four plans bought with waivers is the thing worth seeing.
  waivedCents: number
  /// Plans that BROKE in the period, and how much of what they promised was
  /// still outstanding. Not a subset of the agreed figures: a plan agreed in
  /// February and broken in March belongs to February's `agreedCents` and
  /// March's `brokenCents`, which is what makes both months honest.
  brokenCount: number
  brokenCents: number
  /// Plans that ran to completion in the period.
  completedCount: number
  completedCents: number
}

export type FacilityPlansHolds = {
  facilityId: string
  facilityName: string
  rows: HaltedLeaseRow[]
  effectiveness: PlanEffectiveness
  /// The halted money at this facility — the sum of `rows[].deferredCents`.
  deferredCents: number
}

export type PlansHoldsReport = {
  facilities: FacilityPlansHolds[]
  total: PlanEffectiveness
  totalDeferredCents: number
  haltedLeaseCount: number
  /// The instant the halted list describes. Named on the screen, because a
  /// page with a date range on it implies an answer for that range.
  asOf: Date
  periodStart: Date
  periodEnd: Date
}

const EMPTY_EFFECTIVENESS: PlanEffectiveness = {
  agreedCount: 0,
  agreedCents: 0,
  collectedCents: 0,
  waivedCents: 0,
  brokenCount: 0,
  brokenCents: 0,
  completedCount: 0,
  completedCents: 0,
}

/// The whole report, scoped to the facilities this actor may see money for.
///
/// `reports:financial`, not `reports:operational` — deferral amounts and what
/// a plan collected are receivables, the same call B-055 made for the aging
/// report itself.
export async function plansAndHoldsReport(
  actor: Actor,
  periodStart: Date,
  periodEnd: Date,
  asOf: Date = new Date(),
): Promise<PlansHoldsReport> {
  const facilities = await financialFacilities(actor)
  if (facilities.length === 0) {
    return {
      facilities: [],
      total: EMPTY_EFFECTIVENESS,
      totalDeferredCents: 0,
      haltedLeaseCount: 0,
      asOf,
      periodStart,
      periodEnd,
    }
  }

  const facilityIds = facilities.map((facility) => facility.id)
  const [rows, effectivenessByFacility] = await Promise.all([
    haltedLeases(facilityIds, asOf),
    planEffectiveness(facilityIds, periodStart, periodEnd),
  ])

  const rowsByFacility = new Map<string, HaltedLeaseRow[]>()
  for (const row of rows) {
    const list = rowsByFacility.get(row.facilityId) ?? []
    list.push(row)
    rowsByFacility.set(row.facilityId, list)
  }

  const byFacility = facilities
    .map((facility) => {
      const facilityRows = rowsByFacility.get(facility.id) ?? []
      return {
        facilityId: facility.id,
        facilityName: facility.name,
        rows: facilityRows,
        effectiveness: effectivenessByFacility.get(facility.id) ?? EMPTY_EFFECTIVENESS,
        deferredCents: facilityRows.reduce((sum, row) => sum + row.deferredCents, 0),
      }
    })
    .sort((a, b) => a.facilityName.localeCompare(b.facilityName))

  return {
    facilities: byFacility,
    total: sumEffectiveness(byFacility.map((facility) => facility.effectiveness)),
    totalDeferredCents: byFacility.reduce((sum, facility) => sum + facility.deferredCents, 0),
    haltedLeaseCount: rows.length,
    asOf,
    periodStart,
    periodEnd,
  }
}

export function sumEffectiveness(rows: readonly PlanEffectiveness[]): PlanEffectiveness {
  return rows.reduce(
    (acc, row) => ({
      agreedCount: acc.agreedCount + row.agreedCount,
      agreedCents: acc.agreedCents + row.agreedCents,
      collectedCents: acc.collectedCents + row.collectedCents,
      waivedCents: acc.waivedCents + row.waivedCents,
      brokenCount: acc.brokenCount + row.brokenCount,
      brokenCents: acc.brokenCents + row.brokenCents,
      completedCount: acc.completedCount + row.completedCount,
      completedCents: acc.completedCents + row.completedCents,
    }),
    EMPTY_EFFECTIVENESS,
  )
}

/// Every lease under a hold that stops the chasing, longest-halted first.
///
/// No lease-status filter and no balance filter, both deliberately. A hold on
/// an ENDED lease is exactly the case US-14 warns about — a balance that has
/// stopped being anybody's job — and a hold on a lease that owes nothing is
/// still an account with collections switched off, which is worth seeing
/// before somebody wonders why nothing has been sent for four months.
export async function haltedLeases(
  facilityIds: readonly string[],
  asOf: Date = new Date(),
): Promise<HaltedLeaseRow[]> {
  if (facilityIds.length === 0) return []

  // The holds first, so the lease read is scoped to the leases that have one
  // rather than to every lease in the portfolio.
  const heldLeaseIds = [
    ...new Set(
      (
        await prisma.leaseHold.findMany({
          where: { liftedAt: null, lease: { facilityId: { in: [...facilityIds] } } },
          select: { leaseId: true },
        })
      ).map((hold) => hold.leaseId),
    ),
  ]
  if (heldLeaseIds.length === 0) return []

  const [holdsByLease, leases, balances, plans] = await Promise.all([
    activeHoldsByLease(heldLeaseIds, asOf),
    prisma.lease.findMany({
      where: { id: { in: heldLeaseIds } },
      select: {
        id: true,
        facilityId: true,
        status: true,
        tenantId: true,
        tenant: { select: { firstName: true, lastName: true } },
        unit: { select: { number: true } },
        facility: { select: { name: true } },
      },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['leaseId'],
      where: { leaseId: { in: heldLeaseIds } },
      _sum: { amountCents: true },
    }),
    prisma.paymentPlan.findMany({
      where: { leaseId: { in: heldLeaseIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        leaseId: true,
        status: true,
        totalCents: true,
        invoiceIds: true,
        installments: { orderBy: { dueDate: 'asc' }, select: { dueDate: true, amountCents: true } },
      },
    }),
  ])

  const balanceByLease = new Map(balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))
  const progress = await planProgressByPlan(plans)

  // The newest plan per lease. `findMany` came back newest-first, so the first
  // one seen wins — a lease on its fifth plan (D-98) shows the fifth, and the
  // chain itself lives on the tenant profile where B-190 put it.
  const planByLease = new Map<string, (typeof plans)[number]>()
  for (const plan of plans) if (!planByLease.has(plan.leaseId)) planByLease.set(plan.leaseId, plan)

  const rows: HaltedLeaseRow[] = []
  for (const lease of leases) {
    const holds = holdsByLease.get(lease.id) ?? []
    const halting = holds.filter((hold) => hold.effects.includes('halt_dunning'))
    if (halting.length === 0) continue

    const haltedSince = oldestEffectiveFrom(halting)
    const plan = planByLease.get(lease.id)
    const collectedCents = plan ? (progress.get(plan.id)?.progressCents ?? 0) : 0
    const views = plan ? installmentViews(plan.installments, collectedCents, asOf) : []

    rows.push({
      leaseId: lease.id,
      facilityId: lease.facilityId,
      facilityName: lease.facility.name,
      tenantId: lease.tenantId,
      tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      unitNumber: lease.unit?.number ?? '—',
      leaseStatus: lease.status,
      holdLabels: halting.map((hold) => hold.label),
      otherHoldLabels: holds
        .filter((hold) => !hold.effects.includes('halt_dunning'))
        .map((hold) => hold.label),
      haltedSince,
      daysHalted: wholeDaysBetween(haltedSince, asOf),
      deferredCents: Math.max(0, balanceByLease.get(lease.id) ?? 0),
      plan: plan
        ? {
            id: plan.id,
            status: plan.status,
            totalCents: plan.totalCents,
            collectedCents,
            nextInstallment: views.find((view) => view.status !== 'paid') ?? null,
            missedCount: views.filter((view) => view.status === 'missed').length,
          }
        : null,
    })
  }

  // Longest halted first — the row B-195 asks for by name, because the oldest
  // hold is the one most likely to be somebody's forgotten decision rather
  // than an active arrangement. Largest deferral breaks the tie.
  rows.sort((a, b) => b.daysHalted - a.daysHalted || b.deferredCents - a.deferredCents)
  return rows
}

/// Whether the plans are working, per facility, for a period.
///
/// The three figures US-25 needs and no screen has ever shown: what was put on
/// plans, what came in under them, and what broke.
export async function planEffectiveness(
  facilityIds: readonly string[],
  periodStart: Date,
  periodEnd: Date,
): Promise<Map<string, PlanEffectiveness>> {
  if (facilityIds.length === 0) return new Map()

  const plans = await prisma.paymentPlan.findMany({
    where: {
      lease: { facilityId: { in: [...facilityIds] } },
      OR: [
        { createdAt: { gte: periodStart, lt: periodEnd } },
        { brokenAt: { gte: periodStart, lt: periodEnd } },
        { completedAt: { gte: periodStart, lt: periodEnd } },
      ],
    },
    select: {
      id: true,
      totalCents: true,
      invoiceIds: true,
      createdAt: true,
      brokenAt: true,
      completedAt: true,
      lease: { select: { facilityId: true } },
    },
  })

  const progress = await planProgressByPlan(plans)
  const inPeriod = (date: Date | null) =>
    date !== null && date >= periodStart && date < periodEnd

  const byFacility = new Map<string, PlanEffectiveness>()
  for (const plan of plans) {
    const facilityId = plan.lease.facilityId
    const moved = progress.get(plan.id) ?? { progressCents: 0, collectedCents: 0, waivedCents: 0 }
    const current = byFacility.get(facilityId) ?? { ...EMPTY_EFFECTIVENESS }

    if (inPeriod(plan.createdAt)) {
      current.agreedCount += 1
      current.agreedCents += plan.totalCents
      current.collectedCents += moved.collectedCents
      current.waivedCents += moved.waivedCents
    }
    if (inPeriod(plan.brokenAt)) {
      current.brokenCount += 1
      // What the plan promised and has still not delivered. Clamped because a
      // tenant can keep paying after a break, and "minus $200 broke" is not a
      // fact about anything.
      // Progress, not collections: a waived invoice is genuinely not owed any
      // more, so counting it here would report money nobody is going to chase.
      current.brokenCents += Math.max(0, plan.totalCents - moved.progressCents)
    }
    if (inPeriod(plan.completedAt)) {
      current.completedCount += 1
      current.completedCents += plan.totalCents
    }
    byFacility.set(facilityId, current)
  }
  return byFacility
}

function oldestEffectiveFrom(holds: readonly HoldInForce[]): Date {
  return holds.reduce(
    (oldest, hold) => (hold.effectiveFrom < oldest ? hold.effectiveFrom : oldest),
    holds[0].effectiveFrom,
  )
}

/// Whole UTC days, floored at 0 — the same arithmetic `daysPastDue` uses, so
/// "34 days halted" beside "50 days past due" is counted one way.
function wholeDaysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const startOfDay = (date: Date) =>
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return Math.max(0, Math.floor((startOfDay(to) - startOfDay(from)) / MS_PER_DAY))
}
