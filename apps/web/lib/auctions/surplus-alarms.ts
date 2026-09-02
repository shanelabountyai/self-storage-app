import { prisma } from '@storage/db'
import { surplusDispositionDue, surplusObligation } from '@storage/core/auctions'
import { createTask } from '@/lib/admin/tasks'
import { formatCents } from '@/lib/format'

// PRD 02 §4.6 US-28 / US-29 (B-234). The alarm on a held surplus.
//
// B-062 built the arithmetic and one reader: `outstandingSurpluses`, rendered
// on `/admin/auctions` for the single facility the switcher happens to be on —
// a screen nobody opens at a site with no live cases. So a surplus became
// overdue a year after the sale and nothing anywhere said so. What is added is
// the alarm, not the maths: this reads the same `surplusObligation` the screen
// does and turns it into `Task` rows, which is the one list a part-timer
// checks (US-41).
//
// The durations are configuration and stay configuration (US-29, D-10). This
// alarms on whatever the facility is set to and asserts nothing about what any
// state requires.

export type SurplusAlarmResult = { raised: number; escalated: number }

/// Raises — and escalates — the tasks a facility's held surpluses need.
///
/// Guarded on an existing OPEN task rather than on `createTask`'s
/// per-business-date idempotency, which would otherwise raise a fresh card
/// every night for the whole year a hold runs and teach staff that this queue
/// means nothing. Escalation happens on the row that is already there: once
/// the deadline passes the open task is bumped to `high` rather than joined by
/// a duplicate.
export async function raiseSurplusAlarms(
  facilityId: string,
  now: Date = new Date(),
  recordItem?: (outcome: { itemId: string; ok: boolean; message?: string }) => void,
): Promise<SurplusAlarmResult> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { surplusNoticeLeadDays: true },
  })

  const cases = await prisma.auctionCase.findMany({
    // The same filter `outstandingSurpluses` uses: sold, still `held`. A
    // surplus claimed or remitted is discharged, and one that never arose has
    // nothing to alarm about.
    where: { facilityId, status: 'sold', surplusDisposition: 'held' },
    select: {
      id: true,
      surplusCents: true,
      surplusHoldUntil: true,
      surplusTenantNotifiedAt: true,
      unit: { select: { number: true } },
      lease: { select: { tenant: { select: { firstName: true, lastName: true } } } },
    },
  })

  let raised = 0
  let escalated = 0

  for (const row of cases) {
    const surplusCents = row.surplusCents ?? 0
    const obligation = surplusObligation(
      {
        surplusCents,
        disposition: 'held',
        holdUntil: row.surplusHoldUntil,
        notifiedAt: row.surplusTenantNotifiedAt,
      },
      now,
    )
    if (!obligation.outstanding) continue

    // The amount and the former tenant on the card itself. The action is
    // off-system — a cheque, or a comptroller filing — so a staffer needs to
    // know who and how much before they open anything.
    const tenant = row.lease.tenant
    const detail =
      `${formatCents(surplusCents)} held for ${tenant.firstName} ${tenant.lastName}, ` +
      `from the sale of unit ${row.unit.number}.`

    if (!row.surplusTenantNotifiedAt) {
      if (await ensureTask(facilityId, 'surplus_notice_due', row.id, detail, 'normal', now)) raised += 1
    }

    if (surplusDispositionDue(row.surplusHoldUntil, facility.surplusNoticeLeadDays, now)) {
      const priority = obligation.overdue ? 'high' : 'normal'
      const outcome = await ensureTask(
        facilityId,
        'surplus_disposition_due',
        row.id,
        obligation.overdue
          ? `${detail} The holding period has run out.`
          : detail,
        priority,
        now,
      )
      if (outcome === true) raised += 1
      else if (outcome === 'escalated') escalated += 1
    }
  }

  recordItem?.({
    itemId: facilityId,
    ok: true,
    message: `${raised} surplus alarm${raised === 1 ? '' : 's'} raised, ${escalated} escalated`,
  })

  return { raised, escalated }
}

/// Creates the task, or escalates the open one already standing for it.
///
/// Returns `true` when a card was created, `'escalated'` when an existing one
/// was bumped to `high`, and `false` when there was already an equivalent card
/// at the right priority.
async function ensureTask(
  facilityId: string,
  type: 'surplus_notice_due' | 'surplus_disposition_due',
  caseId: string,
  detail: string,
  priority: 'normal' | 'high',
  now: Date,
): Promise<true | 'escalated' | false> {
  const open = await prisma.task.findFirst({
    where: { type, entityId: caseId, status: 'open' },
    select: { id: true, priority: true },
  })

  if (!open) {
    await createTask({
      facilityId,
      type,
      entityType: 'AuctionCase',
      entityId: caseId,
      at: now,
      priority,
      detail,
    })
    return true
  }

  // Only ever upwards. A card a person deliberately left at `high` is not
  // something a later quiet night should demote.
  if (priority === 'high' && open.priority !== 'high') {
    await prisma.task.update({ where: { id: open.id }, data: { priority: 'high', detail } })
    return 'escalated'
  }
  return false
}
