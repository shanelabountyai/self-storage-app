import { prisma, Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { monthBounds, MONTH_NAMES } from '@storage/core/billing'
import {
  canClosePeriod,
  CLOSE_SNAPSHOT_VERSION,
  periodDrift,
  type DriftRow,
  type PeriodDerivedFigures,
  type PeriodSnapshot,
  type PointInTimeFigures,
} from '@storage/core/accounting'
import { requirePermission, assertFacilityAccess } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { delinquencyReport, movesReport, occupancyReport } from '@/lib/admin/reports'
import { revenueReport, billedTotal, collectedTotal } from '@/lib/admin/revenue-report'

// PRD 02 §8, US-40 (B-084 part 1). Filing a month's books.
//
// **Every figure comes from the existing report functions, not from queries
// written here.** §8's first principle is "one shared metrics-definition
// layer", and a close that computed its own economic occupancy would be a
// second definition of the number the whole product is measured on — which is
// exactly the drift §4.11's AC exists to prevent. The cost is that each of
// those functions computes every facility the actor can see and this throws
// most of it away; a close is run once a month by a person pressing a button,
// so that is the right trade and not a thing to optimise into a private query.

/// A month's row, whether or not it has ever been closed.
export type PeriodRow = {
  year: number
  month: number
  label: string
  startsAt: Date
  endsAt: Date
  closedAt: Date | null
  closedBy: string | null
  snapshot: PeriodSnapshot | null
  /// Whether the month has finished in the facility's own timezone.
  ended: boolean
}

export function periodLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

async function facilityFor(actor: Actor, facilityId: string) {
  assertFacilityAccess(actor, facilityId)
  return prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { id: true, name: true, timezone: true },
  })
}

/// Computes the figures for one facility and one month, from the shared report
/// layer.
///
/// Split into the two halves `packages/core/accounting/close.ts` describes,
/// because the split decides what drift-checking may compare — not because it
/// is a tidy way to group fields.
async function figuresFor(
  actor: Actor,
  facilityId: string,
  start: Date,
  end: Date,
): Promise<{ pointInTime: PointInTimeFigures; periodDerived: PeriodDerivedFigures }> {
  const [occupancy, revenue, moves, delinquency] = await Promise.all([
    occupancyReport(actor, start, end),
    revenueReport(actor, start, end),
    movesReport(actor, start, end),
    // No date parameter, deliberately — it does not take one. This is the
    // figure that can only ever be observed now, which is the whole reason the
    // close exists.
    delinquencyReport(actor),
  ])

  const occ = occupancy.rows.find((row) => row.facilityId === facilityId)
  const rev = revenue.rows.find((row) => row.facilityId === facilityId)
  const mov = moves.rows.find((row) => row.facilityId === facilityId)
  const ar = delinquency.rows.find((row) => row.facilityId === facilityId)?.aging

  return {
    pointInTime: {
      unitOccupancyRatio: occ?.occupancy.ratio ?? 0,
      occupiedUnits: occ?.occupancy.occupiedCount ?? 0,
      rentableUnits: occ?.occupancy.rentableCount ?? 0,
      squareFootRatio: occ?.occupancy.squareFootRatio ?? 0,
      arD0to10Cents: ar?.d0to10 ?? 0,
      arD11to30Cents: ar?.d11to30 ?? 0,
      arD31to60Cents: ar?.d31to60 ?? 0,
      arD61to90Cents: ar?.d61to90 ?? 0,
      arOver90Cents: ar?.over90 ?? 0,
      arTotalCents: ar?.totalCents ?? 0,
    },
    periodDerived: {
      billedCents: rev ? billedTotal(rev) : 0,
      collectedCents: rev ? collectedTotal(rev) : 0,
      discountsCents: rev?.discountsCents ?? 0,
      referralRewardsCents: rev?.referralRewardsCents ?? 0,
      writeOffsCents: rev?.writeOffsCents ?? 0,
      refundsCents: rev?.refundsCents ?? 0,
      unappliedCents: rev?.unappliedCents ?? 0,
      economicOccupancyRatio: occ?.economic.ratio ?? 0,
      grossPotentialCents: occ?.economic.grossPotentialCents ?? 0,
      moveIns: mov?.moves.moveIns ?? 0,
      moveOuts: mov?.moves.moveOuts ?? 0,
      netMoves: mov?.moves.net ?? 0,
    },
  }
}

export type CloseResult = { ok: true } | { ok: false; reason: string }

/// Files a month's figures.
export async function closePeriod(
  actor: Actor,
  facilityId: string,
  year: number,
  month: number,
  now = new Date(),
): Promise<CloseResult> {
  requirePermission(actor, 'accounting:close', facilityId)
  const facility = await facilityFor(actor, facilityId)

  // The same `monthBounds` a tenant statement uses, so a statement and a close
  // for one month cover exactly the same days rather than nearly the same ones.
  const bounds = monthBounds(year, month, facility.timezone)
  const existing = await prisma.accountingPeriod.findUnique({
    where: { facilityId_year_month: { facilityId, year, month } },
    select: { closedAt: true },
  })

  const verdict = canClosePeriod({
    periodEnd: bounds.end,
    now,
    alreadyClosed: Boolean(existing?.closedAt),
  })
  if (!verdict.allowed) return { ok: false, reason: verdict.reason }

  const figures = await figuresFor(actor, facilityId, bounds.start, bounds.end)
  const snapshot: PeriodSnapshot = {
    version: CLOSE_SNAPSHOT_VERSION,
    takenAt: now.toISOString(),
    ...figures,
  }

  await prisma.$transaction(async (tx) => {
    await tx.accountingPeriod.upsert({
      where: { facilityId_year_month: { facilityId, year, month } },
      create: {
        facilityId,
        year,
        month,
        startsAt: bounds.start,
        endsAt: bounds.end,
        closedAt: now,
        closedByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
        snapshot,
      },
      update: {
        // Re-resolved on every close: a facility whose timezone was corrected
        // while the month was open should be filed on the corrected one, and
        // the stored window is what stops it moving AFTER filing.
        startsAt: bounds.start,
        endsAt: bounds.end,
        closedAt: now,
        closedByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
        snapshot,
      },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId,
        action: 'period.closed',
        entityType: 'AccountingPeriod',
        entityId: `${facilityId}:${year}-${String(month).padStart(2, '0')}`,
        // The whole snapshot, so the append-only log — not the period row —
        // is the permanent record of every set of figures ever filed.
        after: snapshot as unknown as Record<string, unknown>,
      },
      tx,
    )
  })

  return { ok: true }
}

/// Withdraws a filed month so it can be restated.
export async function reopenPeriod(
  actor: Actor,
  facilityId: string,
  year: number,
  month: number,
  reason: string,
): Promise<CloseResult> {
  requirePermission(actor, 'accounting:close', facilityId)
  await facilityFor(actor, facilityId)

  if (!reason.trim()) {
    return {
      ok: false,
      reason:
        'Say why this month is being reopened. Reopening means restating figures that have already been reported, and "why" is the first question asked about it afterwards.',
    }
  }

  const existing = await prisma.accountingPeriod.findUnique({
    where: { facilityId_year_month: { facilityId, year, month } },
    select: { closedAt: true, snapshot: true },
  })
  if (!existing?.closedAt) {
    return { ok: false, reason: 'This month is not closed, so there is nothing to reopen.' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.accountingPeriod.update({
      where: { facilityId_year_month: { facilityId, year, month } },
      // The snapshot is cleared, not kept. An open month must not go on
      // displaying withdrawn figures as though they were still authoritative;
      // they survive in the audit entry below, which is append-only.
      // `Prisma.DbNull` rather than `null`: on a Json column a bare null is
      // ambiguous between SQL NULL and the JSON value `null`, and Prisma makes
      // you say which. SQL NULL is what "there are no filed figures" means.
      data: { closedAt: null, closedByStaffId: null, snapshot: Prisma.DbNull },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId,
        action: 'period.reopened',
        entityType: 'AccountingPeriod',
        entityId: `${facilityId}:${year}-${String(month).padStart(2, '0')}`,
        reasonCode: reason.trim(),
        before: (existing.snapshot ?? null) as unknown as Record<string, unknown>,
      },
      tx,
    )
  })

  return { ok: true }
}

/// The months worth showing, newest first: every month from the facility's
/// first activity, capped so the screen does not grow without bound.
///
/// ponytail: a fixed 24-month window with no paging. The upgrade is a year
/// selector, and the trigger is somebody needing to look further back than two
/// years — which is also roughly when a period that old stops being restatable
/// in practice.
export const PERIOD_WINDOW_MONTHS = 24

export async function periodsFor(
  actor: Actor,
  facilityId: string,
  now = new Date(),
): Promise<PeriodRow[]> {
  requirePermission(actor, 'accounting:close', facilityId)
  const facility = await facilityFor(actor, facilityId)

  const rows = await prisma.accountingPeriod.findMany({
    where: { facilityId },
    select: {
      year: true,
      month: true,
      closedAt: true,
      snapshot: true,
      closedByStaff: { select: { firstName: true, lastName: true } },
    },
  })
  const byKey = new Map(rows.map((row) => [`${row.year}-${row.month}`, row]))

  // Walked back from the current facility-local month rather than read from
  // the table, so a month nobody has ever closed still has a row to close.
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: facility.timezone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)
  let year = Number(local.find((part) => part.type === 'year')!.value)
  let month = Number(local.find((part) => part.type === 'month')!.value)

  const periods: PeriodRow[] = []
  for (let index = 0; index < PERIOD_WINDOW_MONTHS; index += 1) {
    const bounds = monthBounds(year, month, facility.timezone)
    const stored = byKey.get(`${year}-${month}`)
    periods.push({
      year,
      month,
      label: periodLabel(year, month),
      startsAt: bounds.start,
      endsAt: bounds.end,
      closedAt: stored?.closedAt ?? null,
      closedBy: stored?.closedByStaff
        ? `${stored.closedByStaff.firstName} ${stored.closedByStaff.lastName}`
        : null,
      snapshot: (stored?.snapshot as PeriodSnapshot | null) ?? null,
      ended: now >= bounds.end,
    })
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }
  return periods
}

/// What has changed in a closed month since it was filed.
///
/// Returns null for a month that is not closed — there is nothing to compare
/// against, and an empty drift list would read as "checked, all fine".
export async function driftFor(
  actor: Actor,
  facilityId: string,
  year: number,
  month: number,
): Promise<DriftRow[] | null> {
  requirePermission(actor, 'accounting:close', facilityId)
  // Called for its access assertion, not its value — the stored window below is
  // what this function reads, deliberately, rather than the facility's current
  // timezone.
  await facilityFor(actor, facilityId)

  const stored = await prisma.accountingPeriod.findUnique({
    where: { facilityId_year_month: { facilityId, year, month } },
    select: { closedAt: true, snapshot: true, startsAt: true, endsAt: true },
  })
  if (!stored?.closedAt || !stored.snapshot) return null

  const filed = stored.snapshot as unknown as PeriodSnapshot
  // The window as FILED, not as `monthBounds` would resolve it today — the
  // whole point of storing it. Recomputing the boundaries would mean a
  // timezone correction showed up as revenue drift.
  const current = await figuresFor(actor, facilityId, stored.startsAt, stored.endsAt)
  return periodDrift(filed.periodDerived, current.periodDerived)
}
