import { createHash } from 'node:crypto'
import { prisma } from '@storage/db'
import {
  computedOnCurrentVersion,
  largestDrift,
  periodDrift,
  type DriftRow,
  type PeriodSnapshot,
} from '@storage/core/accounting'
import { createTask } from '@/lib/admin/tasks'
import { figuresFor, periodLabel } from '@/lib/admin/accounting-close'
import { formatCents } from '@/lib/format'

// PRD 02 §8 US-39.5, US-44 (B-307). The alarm on a month that has already been
// filed and no longer matches.
//
// `periodDrift` has existed since B-084 and had two readers, both of which
// somebody has to decide to open: the close screen and the management pack. So
// when B-297 and B-298 changed the report layer, every already-filed month
// started disagreeing with what the same query returns and nothing anywhere
// said so — the next person to notice would have been the CPA reconciling
// against the bank, or nobody. A close that silently moves is worse than one
// that was always wrong.
//
// What this does NOT do is put it right. Re-filing or restating a month that
// somebody has already sent to an accountant is a person's decision, and
// making it visible is the whole of this job.

/// How far back a night's check recomputes.
///
/// ponytail: a fixed 12-month window rather than every period ever filed. Each
/// month costs four report queries and this runs per facility per day; a year
/// is also roughly how far back a period stays restatable in practice. The
/// upgrade, if a month older than that ever matters, is to skip the recompute
/// for a snapshot whose computation version already says it must have moved.
const DRIFT_WINDOW_MONTHS = 12

export type CloseDriftResult = { checked: number; drifted: number; raised: number }

/// Checks a facility's filed months and raises at most one card.
export async function raiseClosedPeriodDriftTasks(
  facilityId: string,
  now: Date = new Date(),
  recordItem?: (outcome: { itemId: string; ok: boolean; message?: string }) => void,
): Promise<CloseDriftResult> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { name: true },
  })

  const filed = await prisma.accountingPeriod.findMany({
    where: { facilityId, closedAt: { not: null } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: DRIFT_WINDOW_MONTHS,
    select: { year: true, month: true, startsAt: true, endsAt: true, snapshot: true },
  })

  const drifted: { label: string; rows: DriftRow[]; onCurrentVersion: boolean }[] = []
  for (const period of filed) {
    // `reopenPeriod` clears the snapshot but the row survives; a closed row
    // with no figures is not a thing to compare against.
    if (!period.snapshot) continue
    const snapshot = period.snapshot as unknown as PeriodSnapshot
    // The window as FILED, never as `monthBounds` resolves it today — the same
    // reasoning as `driftFor`: a timezone correction must not read as revenue
    // having moved.
    const current = await figuresFor(facilityId, facility.name, period.startsAt, period.endsAt)
    const rows = periodDrift(snapshot.periodDerived, current.periodDerived)
    if (rows.length === 0) continue
    drifted.push({
      label: periodLabel(period.year, period.month),
      rows,
      onCurrentVersion: computedOnCurrentVersion(snapshot.computationVersion),
    })
  }

  const result: CloseDriftResult = {
    checked: filed.length,
    drifted: drifted.length,
    raised: 0,
  }

  if (drifted.length > 0) {
    // Keyed on the drift itself, not on the facility and not on the business
    // date. A month somebody has looked at and decided to leave as filed must
    // not come back tomorrow (B-304's lesson), and a month that drifts FURTHER
    // must — the fingerprint is what tells those two apart, and it is why a
    // note is allowed to close this card at all.
    const entityId = `${facilityId}:${fingerprint(drifted)}`
    // Any status and any date, not `createTask`'s own (type, entityId,
    // businessDate) key — that one would raise the same card again tomorrow
    // night, which is exactly what must not happen for a state nothing
    // automatic is going to clear.
    const seen = await prisma.task.findFirst({
      where: { type: 'closed_period_drifted', entityId },
      select: { id: true },
    })
    if (seen) {
      recordItem?.({
        itemId: facilityId,
        ok: true,
        message: `${result.checked} filed months checked, ${result.drifted} drifted, already raised`,
      })
      return result
    }

    const { created } = await createTask({
      facilityId,
      type: 'closed_period_drifted',
      entityType: 'AccountingPeriod',
      entityId,
      at: now,
      priority: 'high',
      detail: driftDetail(drifted),
    })
    if (created) result.raised = 1
  }

  recordItem?.({
    itemId: facilityId,
    ok: true,
    message: `${result.checked} filed month${result.checked === 1 ? '' : 's'} checked, ${result.drifted} drifted, ${result.raised} raised`,
  })

  return result
}

/// A stable name for one particular state of the drift.
///
/// The figures and their deltas, not just which months moved: a month whose
/// billed total moves again is new information and has to raise a new card.
function fingerprint(drifted: readonly { label: string; rows: DriftRow[] }[]): string {
  const canonical = drifted.map((period) => [
    period.label,
    period.rows.map((row) => `${row.key}=${row.deltaValue}`).sort(),
  ])
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16)
}

/// The sentence on the card: which months, how big, and — the part the close
/// screen also says — whether the data moved or the code did.
function driftDetail(
  drifted: readonly { label: string; rows: DriftRow[]; onCurrentVersion: boolean }[],
): string {
  const names = drifted.map((period) => period.label)
  const listed =
    names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`

  // Across every drifted month, so the number on the card is the one worth
  // opening the screen for rather than the newest month's.
  const worst = drifted
    .map((period) => ({ label: period.label, row: largestDrift(period.rows)! }))
    .reduce((best, entry) =>
      Math.abs(entry.row.deltaValue) > Math.abs(best.row.deltaValue) ? entry : best,
    )
  const amount =
    worst.row.kind === 'cents'
      ? `${worst.row.deltaValue > 0 ? '+' : '−'}${formatCents(Math.abs(worst.row.deltaValue))}`
      : `${worst.row.deltaValue > 0 ? '+' : '−'}${Math.abs(worst.row.deltaValue)}`

  const cause = drifted.every((period) => period.onCurrentVersion)
    ? 'Something dated inside them has changed since they were filed.'
    : 'The way these figures are calculated changed after they were filed, so at least part of this is not a change in the data.'

  return (
    `${drifted.length} filed ${drifted.length === 1 ? 'month no longer matches' : 'months no longer match'} what the same query returns: ${listed}. ` +
    `The largest difference is ${worst.row.label} for ${worst.label}, ${amount}. ` +
    `${cause} Reports → Monthly close shows each figure side by side.`
  )
}
