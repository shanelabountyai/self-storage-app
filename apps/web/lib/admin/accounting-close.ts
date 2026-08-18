import { prisma, Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { monthBounds, MONTH_NAMES } from '@storage/core/billing'
import {
  buildJournal,
  canClosePeriod,
  chartOrDefault,
  CHART_OF_ACCOUNTS_FIELDS,
  CLOSE_SNAPSHOT_VERSION,
  periodDrift,
  type ChartOfAccounts,
  type Journal,
  type DriftRow,
  type PeriodDerivedFigures,
  type PeriodSnapshot,
  type PointInTimeFigures,
} from '@storage/core/accounting'
const EMPTY_SPLIT = { rent: 0, fee: 0, protection: 0, tax: 0 } as const

import { csvCents, toCsv } from '@/lib/admin/csv'
import { requirePermission, assertFacilityAccess } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { agingForFacility, movesForFacility, occupancyForFacility } from '@/lib/admin/reports'
import { facilityRevenue, billedTotal, collectedTotal } from '@/lib/admin/revenue-report'

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
/// Exported for B-084 part 4's management pack, which needs the SAME shape
/// whether a month has been filed or is still open — a closed month reads its
/// stored snapshot, an open one computes this. One document builder then serves
/// both, instead of two that can drift apart.
///
/// **Facility-explicit, with no actor** (D-67). Every caller has already
/// checked permission for this facility, and the alternative was the actor-
/// scoped reports — which compute every facility the actor can see and throw
/// all but one away. Part 1 shipped that waste with a comment admitting it;
/// part 3 built the per-facility variants; this is where the comment stops
/// being true.
export async function figuresFor(
  facilityId: string,
  facilityName: string,
  start: Date,
  end: Date,
): Promise<{ pointInTime: PointInTimeFigures; periodDerived: PeriodDerivedFigures }> {
  const [occ, rev, mov, aging] = await Promise.all([
    occupancyForFacility(facilityId, facilityName, start, end),
    facilityRevenue(facilityId, facilityName, start, end),
    movesForFacility(facilityId, facilityName, start, end),
    // No date parameter, deliberately — it does not take one. This is the
    // figure that can only ever be observed now, which is the whole reason the
    // close exists.
    agingForFacility(facilityId, facilityName),
  ])
  const ar = aging.aging

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
      // Split as well as totalled (snapshot v2): a journal credits rental
      // income, fee income and sales tax payable to different accounts, and a
      // single total cannot be taken apart after the fact.
      billedByCategory: { ...(rev?.billed ?? EMPTY_SPLIT) },
      collectedByCategory: { ...(rev?.collected ?? EMPTY_SPLIT) },
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

  const figures = await figuresFor(facilityId, facility.name, bounds.start, bounds.end)
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
  // The name is used for the report reads below; the stored WINDOW is what the
  // recompute uses, deliberately, rather than the facility's current timezone.
  const facility = await facilityFor(actor, facilityId)

  const stored = await prisma.accountingPeriod.findUnique({
    where: { facilityId_year_month: { facilityId, year, month } },
    select: { closedAt: true, snapshot: true, startsAt: true, endsAt: true },
  })
  if (!stored?.closedAt || !stored.snapshot) return null

  const filed = stored.snapshot as unknown as PeriodSnapshot
  // The window as FILED, not as `monthBounds` would resolve it today — the
  // whole point of storing it. Recomputing the boundaries would mean a
  // timezone correction showed up as revenue drift.
  const current = await figuresFor(facilityId, facility.name, stored.startsAt, stored.endsAt)
  return periodDrift(filed.periodDerived, current.periodDerived)
}

// ───────────────────────────────────────────── journal export (part 2) ──

export type JournalExport = { ok: true; journal: Journal } | { ok: false; reason: string }

/// The month-end journal for a CLOSED period, cut from its frozen figures.
///
/// Refuses an open month rather than exporting live numbers. That is the whole
/// ordering argument behind part 1: an export re-derived at click time
/// disagrees with the one taken yesterday, and an accountant who has already
/// posted the first has no way to tell which is right.
export async function journalFor(
  actor: Actor,
  facilityId: string,
  year: number,
  month: number,
): Promise<JournalExport> {
  requirePermission(actor, 'accounting:close', facilityId)
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { id: true, name: true, slug: true, timezone: true, chartOfAccounts: true },
  })
  assertFacilityAccess(actor, facilityId)

  const stored = await prisma.accountingPeriod.findUnique({
    where: { facilityId_year_month: { facilityId, year, month } },
    select: { closedAt: true, snapshot: true },
  })
  if (!stored?.closedAt || !stored.snapshot) {
    return {
      ok: false,
      reason: `${periodLabel(year, month)} is not closed. A journal is cut from filed figures, not from live ones — close the month first, so what is exported cannot change after it has been posted.`,
    }
  }

  return buildJournal(
    stored.snapshot as unknown as PeriodSnapshot,
    chartOrDefault(facility.chartOfAccounts),
    {
      year,
      month,
      // Stable and readable in a QuickBooks register: the site, then the month.
      reference: `${facility.slug}-${year}-${String(month).padStart(2, '0')}`,
    },
  )
}

/// QuickBooks Online's journal-entry import shape.
///
/// Column names are QuickBooks' own, including the asterisks it puts on the
/// required ones — an import matches on the header text, so "Journal Date"
/// without the asterisk is a file it will not read.
export function journalCsv(journal: Journal): string {
  return toCsv(
    ['*JournalNo', '*JournalDate', '*AccountName', 'Debits', 'Credits', 'Description'],
    journal.lines.map((entry) => [
      journal.reference,
      journal.date,
      entry.account,
      // Blank rather than 0.00 on the side a line is not on: QuickBooks treats
      // a zero as a value and a blank as "not this side", and a line carrying
      // both reads as an error in the import preview.
      entry.debitCents === 0 ? '' : csvCents(entry.debitCents),
      entry.creditCents === 0 ? '' : csvCents(entry.creditCents),
      entry.description,
    ]),
  )
}

export type ChartResult = { ok: true } | { ok: false; field: string; problem: string }

/// Saves the account names this facility posts to.
export async function saveChartOfAccounts(
  actor: Actor,
  facilityId: string,
  input: Record<string, string>,
): Promise<ChartResult> {
  requirePermission(actor, 'accounting:close', facilityId)
  await facilityFor(actor, facilityId)

  const chart: Record<string, string> = {}
  for (const field of CHART_OF_ACCOUNTS_FIELDS) {
    const value = (input[field.key] ?? '').trim()
    // An account name with a comma or a newline in it breaks the import in a
    // way that surfaces as a mangled row rather than an error, so it is refused
    // here where the message can name the field.
    if (/[\r\n,]/.test(value)) {
      return {
        ok: false,
        field: field.key,
        problem: 'An account name cannot contain a comma or a line break — both break the import file. Use the name exactly as it appears in your chart of accounts.',
      }
    }
    // Empty means "use the conventional name", never "post to an account with
    // no name" — the same fallback rule the marketing copy fields follow.
    if (value) chart[field.key] = value
  }

  const before = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { chartOfAccounts: true },
  })

  await prisma.$transaction(async (tx) => {
    await tx.facility.update({
      where: { id: facilityId },
      data: { chartOfAccounts: Object.keys(chart).length > 0 ? chart : Prisma.DbNull },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId,
        action: 'facility.settings_changed',
        entityType: 'Facility',
        entityId: facilityId,
        before: { chartOfAccounts: before.chartOfAccounts } as Record<string, unknown>,
        after: { chartOfAccounts: chart } as Record<string, unknown>,
      },
      tx,
    )
  })

  return { ok: true }
}

/// What the form shows: the stored name where there is one, the conventional
/// name where there is not.
export async function chartOfAccountsFor(
  actor: Actor,
  facilityId: string,
): Promise<{ effective: ChartOfAccounts; stored: Record<string, string> }> {
  requirePermission(actor, 'accounting:close', facilityId)
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { chartOfAccounts: true },
  })
  assertFacilityAccess(actor, facilityId)

  const raw = (facility.chartOfAccounts ?? {}) as Record<string, unknown>
  const storedChart: Record<string, string> = {}
  for (const field of CHART_OF_ACCOUNTS_FIELDS) {
    const value = raw[field.key]
    if (typeof value === 'string' && value.trim()) storedChart[field.key] = value.trim()
  }
  return { effective: chartOrDefault(facility.chartOfAccounts), stored: storedChart }
}
