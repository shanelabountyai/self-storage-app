import { randomUUID } from 'node:crypto'
import { type Prisma, prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { emitEvent } from '@storage/core/events'
import { businessDateFor } from '@storage/core/jobs'
import { rateVariance, wholeMonthsBetween } from '@storage/core/metrics'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import {
  applyIsDue,
  decreaseProblem,
  DEFAULT_ELIGIBILITY,
  isCancellable,
  isEligibleForIncrease,
  LIVE_RATE_INCREASE_STATUSES,
  noticeDateFor,
  noticeDeliveryVerdict,
  noticeIsDue,
  projectedMonthlyDeltaCents,
  scheduleProblem,
  isRateDecrease,
  targetRateFor,
  utcDay,
  type CandidateLease,
  type DecreaseProblem,
  type EligibilityRule,
  type ScheduleProblem,
} from '@storage/core/pricing'
import { createTask } from '@/lib/admin/tasks'
import { can, checkMonetaryAuthority, nextApproverRole, requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.3 US-11 (B-076). Scheduling, approving and applying tenant rate
// increases.
//
// ── The one rule this file exists to enforce ────────────────────────────────
//
// US-11's schema AC: "`Lease.monthlyRateCents` is written **only** through the
// function that writes the history row — the same discipline as
// `recomputeUnitStatus()`." Until this item there was exactly one writer
// (move-in, inline in `checkout/provision.ts`) and no such function.
// `applyRateChange` below is it: every future path that moves an in-place
// rate — this item's ECRI batches, B-077's transfers, a promo expiry — goes
// through it, so the history can never disagree with the column.

/// Regional. Matches the auction approval bar and for the same reason:
/// US-11 says "regional/owner approval", and a site manager approving an
/// increase on their own site's tenant is exactly the check this is.
const REGIONAL_RANK = 30

function rankAt(actor: Actor, facilityId: string): number {
  if (actor.kind !== 'staff') return 0
  return Math.max(
    0,
    ...actor.assignments
      .filter((one) => one.facilityId === null || one.facilityId === facilityId)
      .map((one) => one.rank),
  )
}

function staffIdOf(actor: Actor): string | null {
  return actor.kind === 'staff' ? actor.staffUserId : null
}

export type ActionResult = { ok: true } | { ok: false; reason: string }

const PROBLEM_MESSAGE: Record<ScheduleProblem, string> = {
  notice_days_not_positive:
    'This facility has no rate-increase notice period configured. Set one in Settings before scheduling an increase.',
  not_an_increase: 'The new rate has to be higher than the current one.',
  effective_not_in_future: 'The effective date has to be in the future.',
  insufficient_notice: 'That effective date does not leave the required notice period.',
}

/// The one write-through for an in-place rate. Updates the column and writes
/// the history row in the same transaction, so neither can exist without the
/// other.
///
/// Exported because B-077 (transfers) and any later promo-expiry path must
/// use it rather than touching `Lease.monthlyRateCents` themselves — that is
/// the whole point of it existing.
export async function applyRateChange(
  input: {
    leaseId: string
    newRateCents: number
    effectiveFrom: Date
    reason: 'move_in' | 'ecri' | 'transfer' | 'promo_expiry' | 'retention' | 'manual'
    actorStaffId?: string | null
    noticeDays?: number | null
    rateIncreaseId?: string | null
  },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ previousRateCents: number; newRateCents: number }> {
  const lease = await client.lease.findUniqueOrThrow({
    where: { id: input.leaseId },
    select: { monthlyRateCents: true },
  })

  await client.lease.update({
    where: { id: input.leaseId },
    data: { monthlyRateCents: input.newRateCents },
  })
  await client.leaseRateChange.create({
    data: {
      leaseId: input.leaseId,
      previousRateCents: lease.monthlyRateCents,
      newRateCents: input.newRateCents,
      effectiveFrom: input.effectiveFrom,
      reason: input.reason,
      actorStaffId: input.actorStaffId ?? null,
      noticeDays: input.noticeDays ?? null,
      rateIncreaseId: input.rateIncreaseId ?? null,
    },
  })

  return { previousRateCents: lease.monthlyRateCents, newRateCents: input.newRateCents }
}

export type ScheduleOneOffInput = {
  leaseId: string
  newRateCents: number
  effectiveDate: Date
}

export type ScheduleResult = { ok: true; id: string } | { ok: false; reason: string }

/// US-11's one-off path: this tenant, this new rate, this date.
export async function scheduleRateIncrease(
  actor: Actor,
  facilityId: string,
  input: ScheduleOneOffInput,
): Promise<ScheduleResult> {
  requirePermission(actor, 'rates:tenant_increase', facilityId)

  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: { id: true, facilityId: true, status: true, monthlyRateCents: true },
  })
  if (!lease || lease.facilityId !== facilityId) {
    return { ok: false, reason: 'That lease is not at this facility.' }
  }
  if (!OCCUPYING_LEASE_STATUSES.includes(lease.status as never)) {
    return { ok: false, reason: 'That lease has ended — there is no rate to raise.' }
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { timezone: true, rateIncreaseNoticeDays: true },
  })
  const today = businessDateFor(new Date(), facility.timezone)
  const effectiveDate = utcDay(input.effectiveDate)

  const problem = scheduleProblem({
    currentRateCents: lease.monthlyRateCents,
    newRateCents: input.newRateCents,
    effectiveDate,
    noticeDays: facility.rateIncreaseNoticeDays,
    today,
  })
  if (problem) return { ok: false, reason: PROBLEM_MESSAGE[problem] }

  // One live increase per lease. A second scheduled on top of the first would
  // mean two notices quoting different "new rates" to the same tenant, and
  // whichever applied second would silently overwrite the other.
  const existing = await prisma.tenantRateIncrease.findFirst({
    where: { leaseId: input.leaseId, status: { in: [...LIVE_RATE_INCREASE_STATUSES] } },
    select: { id: true },
  })
  if (existing) {
    return { ok: false, reason: 'This lease already has a scheduled increase. Cancel it first.' }
  }

  const created = await prisma.tenantRateIncrease.create({
    data: {
      facilityId,
      leaseId: input.leaseId,
      currentRateCents: lease.monthlyRateCents,
      newRateCents: input.newRateCents,
      effectiveDate,
      noticeDate: noticeDateFor(effectiveDate, facility.rateIncreaseNoticeDays),
      noticeDays: facility.rateIncreaseNoticeDays,
      createdByStaffId: staffIdOf(actor),
    },
  })
  return { ok: true, id: created.id }
}

const DECREASE_PROBLEM_MESSAGE: Record<DecreaseProblem, string> = {
  rate_below_zero: 'A monthly rate cannot be negative.',
  not_a_decrease: 'The new rate has to be lower than what they pay now. Use an increase for the other direction.',
  effective_in_past: 'The effective date cannot be in the past — the rate that applied on an invoiced day is a fact.',
}

export type ScheduleDecreaseInput = {
  leaseId: string
  newRateCents: number
  effectiveDate: Date
  /// US-38: this is a discretionary giveaway to one tenant, so the audit row
  /// is worthless without it.
  reasonCode: string
}

export type ScheduleDecreaseResult =
  | { ok: true; id: string }
  | { ok: false; reason: string }
  | { ok: false; reason: string; overLimit: true; limitCents: number; escalateTo: string | null }

/// PRD 02 §4.3 US-11, §3 Roles & Permissions (B-153). The retention save:
/// the same workflow in the other direction.
///
/// B-076 built the increase and D-37 gave it a model; ECRI itself is what
/// creates the demand for this, and without it a manager keeping a good
/// tenant either edits the lease rate directly — bypassing the write-through
/// US-11's schema AC exists to enforce — or does nothing.
///
/// **Three things are deliberately NOT symmetric with an increase:**
///
/// *No notice period.* US-11's minimum notice protects a tenant about to be
/// charged more. Nothing statutory governs charging less, and a discount that
/// waits thirty days is no use against a tenant who is on the phone now.
///
/// *No separate approval step.* The authority check IS the approval, so the
/// row is created `approved` and applies on its effective date. A
/// pending_approval state would mean a manager acting inside their own limit
/// still had to wait for somebody else.
///
/// *A different permission.* `rates:tenant_increase` is regional-and-above by
/// seed, which is right for raising a cohort's rent and wrong for a counter
/// conversation. This gates on the EXISTING monetary limits instead —
/// `checkMonetaryAuthority(..., 'credit', ...)` against the monthly amount
/// being given away — which lands on manager-and-above by default (a manager
/// holds `credits:manual` with a limit; counter and bookkeeper hold neither)
/// without minting a new threshold or touching the seed. Over the limit it
/// escalates to the next role that can carry it, exactly as a refund does.
export async function scheduleRateDecrease(
  actor: Actor,
  facilityId: string,
  input: ScheduleDecreaseInput,
): Promise<ScheduleDecreaseResult> {
  if (!input.reasonCode.trim()) return { ok: false, reason: 'Lowering a rate has to record why.' }

  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: { id: true, facilityId: true, status: true, monthlyRateCents: true },
  })
  if (!lease || lease.facilityId !== facilityId) {
    return { ok: false, reason: 'That lease is not at this facility.' }
  }
  if (!OCCUPYING_LEASE_STATUSES.includes(lease.status as never)) {
    return { ok: false, reason: 'That lease has ended — there is no rate to lower.' }
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { timezone: true, rateIncreaseNoticeDays: true },
  })
  const today = businessDateFor(new Date(), facility.timezone)
  const effectiveDate = utcDay(input.effectiveDate)

  const problem = decreaseProblem({
    currentRateCents: lease.monthlyRateCents,
    newRateCents: input.newRateCents,
    effectiveDate,
    today,
  })
  if (problem) return { ok: false, reason: DECREASE_PROBLEM_MESSAGE[problem] }

  // The monthly giveaway, which is what the limit is measured against — not
  // the new rate, and not the whole remaining term. A $15 save is a $15
  // decision every month, and annualising it here would put a routine
  // retention call over every manager's limit.
  const monthlyReductionCents = lease.monthlyRateCents - input.newRateCents
  const decision = checkMonetaryAuthority(actor, 'credit', monthlyReductionCents, facilityId)
  if (!decision.allowed) {
    if (decision.reason === 'forbidden') {
      return { ok: false, reason: 'You do not have the authority to lower a tenant’s rate.' }
    }
    const approver = await nextApproverRole('credit', monthlyReductionCents, decision.escalateToRank ?? 0)
    return {
      ok: false,
      overLimit: true,
      limitCents: decision.limitCents,
      escalateTo: approver?.name ?? null,
      reason: approver
        ? `That is more than your ${formatLimit(decision.limitCents)} a month limit. A ${approver.name} has to make this one.`
        : `That is more than your ${formatLimit(decision.limitCents)} a month limit, and no role above you can carry it either.`,
    }
  }

  // The same one-live-change-per-lease rule the increase path enforces, and
  // for a sharper reason here: a decrease and an increase both pending would
  // race, and whichever applied second would silently win.
  const existing = await prisma.tenantRateIncrease.findFirst({
    where: { leaseId: input.leaseId, status: { in: [...LIVE_RATE_INCREASE_STATUSES] } },
    select: { id: true },
  })
  if (existing) {
    return { ok: false, reason: 'This lease already has a scheduled rate change. Cancel it first.' }
  }

  const staffId = staffIdOf(actor)
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.tenantRateIncrease.create({
      data: {
        facilityId,
        leaseId: input.leaseId,
        currentRateCents: lease.monthlyRateCents,
        newRateCents: input.newRateCents,
        effectiveDate,
        // A decrease gives no notice, so there is no notice date to record.
        // Stored as the effective date rather than left misleading: the
        // column is not nullable, and a date in the past here would read as
        // a notice that was due and never went out.
        noticeDate: effectiveDate,
        noticeDays: 0,
        createdByStaffId: staffId,
        // The authority check above IS the approval — recorded as such so the
        // review screen and any later dispute see who made the call.
        status: 'approved',
        approvedByStaffId: staffId,
        approvedAt: new Date(),
      },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId,
        action: 'rate.tenant_decreased',
        entityType: 'TenantRateIncrease',
        entityId: row.id,
        reasonCode: input.reasonCode.trim(),
        context: {
          leaseId: input.leaseId,
          previousRateCents: lease.monthlyRateCents,
          newRateCents: input.newRateCents,
          monthlyReductionCents,
          effectiveDate: effectiveDate.toISOString().slice(0, 10),
        },
      },
      tx,
    )
    return row
  })

  return { ok: true, id: created.id }
}

function formatLimit(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export type BatchPreviewRow = CandidateLease & {
  tenantName: string
  unitNumber: string
  newRateCents: number
  /// street − in-place, the same definition the rate-variance report uses.
  /// Carried so `rateVariance` can order this shape directly.
  gapCents: number
}

/// US-11's rule-based path, evaluated but not committed. The approval screen
/// shows this before anything is written, because "≥9 months and ≥$15 below
/// street" against a live portfolio is not a number an operator can predict.
export async function previewEligibleIncreases(
  actor: Actor,
  facilityId: string,
  rule: EligibilityRule = DEFAULT_ELIGIBILITY,
): Promise<BatchPreviewRow[]> {
  requirePermission(actor, 'rates:tenant_increase', facilityId)

  const leases = await prisma.lease.findMany({
    where: { facilityId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: {
      id: true,
      monthlyRateCents: true,
      startDate: true,
      tenant: { select: { firstName: true, lastName: true } },
      unit: { select: { number: true, unitTypeId: true } },
      rateChanges: { orderBy: { effectiveFrom: 'desc' }, take: 1, select: { effectiveFrom: true } },
      rateIncreases: {
        where: { status: { in: [...LIVE_RATE_INCREASE_STATUSES] } },
        select: { id: true },
      },
    },
  })
  if (leases.length === 0) return []

  const rates = await prisma.unitTypeRate.findMany({
    where: { facilityId, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: 'desc' },
    select: { unitTypeId: true, streetRateCents: true },
  })
  const streetByType = new Map<string, number>()
  for (const rate of rates) {
    if (!streetByType.has(rate.unitTypeId)) streetByType.set(rate.unitTypeId, rate.streetRateCents)
  }

  const now = new Date()
  const rows: BatchPreviewRow[] = leases
    // A lease already carrying a live increase is not a candidate — the same
    // one-at-a-time rule the one-off path enforces above.
    .filter((lease) => lease.rateIncreases.length === 0)
    .map((lease) => {
      const streetRateCents = streetByType.get(lease.unit.unitTypeId) ?? 0
      const lastChange = lease.rateChanges[0]?.effectiveFrom ?? lease.startDate
      const candidate: CandidateLease = {
        leaseId: lease.id,
        inPlaceRateCents: lease.monthlyRateCents,
        streetRateCents,
        monthsSinceLastChange: wholeMonthsBetween(lastChange, now),
      }
      return {
        ...candidate,
        tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
        unitNumber: lease.unit.number,
        newRateCents: targetRateFor(candidate),
        gapCents: streetRateCents - lease.monthlyRateCents,
      }
    })
    .filter((row) => isEligibleForIncrease(row, rule))

  // Ordered by the same core definition the rate-variance report uses — the
  // worklist and the report must not disagree about which lease is most
  // worth raising (§4.11's "one metrics definition layer").
  return rateVariance(rows)
}

export type BatchResult = { ok: true; batchId: string; scheduled: number } | { ok: false; reason: string }

/// Commits a rule-based batch. Every row gets its own `TenantRateIncrease`
/// (they are approved, noticed and applied individually) sharing one
/// `batchId`, so the screen can act on the batch as a unit.
export async function scheduleEligibleBatch(
  actor: Actor,
  facilityId: string,
  effectiveDate: Date,
  rule: EligibilityRule = DEFAULT_ELIGIBILITY,
): Promise<BatchResult> {
  requirePermission(actor, 'rates:tenant_increase', facilityId)

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { timezone: true, rateIncreaseNoticeDays: true },
  })
  const today = businessDateFor(new Date(), facility.timezone)
  const effective = utcDay(effectiveDate)

  // Checked once for the batch rather than per row: the date and the notice
  // period are the same for all of them, and a per-row failure here would be
  // the same failure repeated.
  const dateProblem = scheduleProblem({
    currentRateCents: 0,
    newRateCents: 1,
    effectiveDate: effective,
    noticeDays: facility.rateIncreaseNoticeDays,
    today,
  })
  if (dateProblem) return { ok: false, reason: PROBLEM_MESSAGE[dateProblem] }

  const candidates = await previewEligibleIncreases(actor, facilityId, rule)
  if (candidates.length === 0) return { ok: false, reason: 'No leases meet the rule right now.' }

  const batchId = randomUUID()
  const noticeDate = noticeDateFor(effective, facility.rateIncreaseNoticeDays)

  await prisma.tenantRateIncrease.createMany({
    data: candidates.map((row) => ({
      facilityId,
      leaseId: row.leaseId,
      currentRateCents: row.inPlaceRateCents,
      newRateCents: row.newRateCents,
      effectiveDate: effective,
      noticeDate,
      noticeDays: facility.rateIncreaseNoticeDays,
      batchId,
      createdByStaffId: staffIdOf(actor),
    })),
  })

  return { ok: true, batchId, scheduled: candidates.length }
}

/// US-11 AC: "regional/owner approval is required before notices go out."
/// The audit catalog already marks `rate.tenant_increased` as requiring a
/// reason code, so approval is where that reason is captured — this is the
/// decision a dispute asks about, not the nightly job that acted on it.
export async function approveRateIncrease(
  actor: Actor,
  id: string,
  reasonCode: string,
): Promise<ActionResult> {
  const row = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id } })
  requirePermission(actor, 'rates:tenant_increase', row.facilityId)

  if (rankAt(actor, row.facilityId) < REGIONAL_RANK) {
    return {
      ok: false,
      reason: 'Approving a rate increase needs a regional manager or an owner, not a site manager.',
    }
  }
  if (!reasonCode.trim()) return { ok: false, reason: 'An approval has to record why.' }
  if (row.status !== 'pending_approval') {
    return { ok: false, reason: `This increase is already ${row.status.replace(/_/g, ' ')}.` }
  }

  await prisma.$transaction(async (tx) => {
    await tx.tenantRateIncrease.update({
      where: { id },
      data: { status: 'approved', approvedByStaffId: staffIdOf(actor), approvedAt: new Date() },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: row.facilityId,
        action: 'rate.tenant_increased',
        entityType: 'TenantRateIncrease',
        entityId: id,
        reasonCode: reasonCode.trim(),
        context: {
          leaseId: row.leaseId,
          previousRateCents: row.currentRateCents,
          newRateCents: row.newRateCents,
          effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
          noticeDays: row.noticeDays,
        },
      },
      tx,
    )
  })
  return { ok: true }
}

/// US-11: "Increases are cancellable up to the effective date; cancellation
/// is audit-logged."
export async function cancelRateIncrease(
  actor: Actor,
  id: string,
  reasonCode: string,
): Promise<ActionResult> {
  const row = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id } })
  requirePermission(actor, 'rates:tenant_increase', row.facilityId)

  if (!reasonCode.trim()) return { ok: false, reason: 'A cancellation has to record why.' }
  if (!isCancellable(row.status)) {
    return {
      ok: false,
      reason:
        row.status === 'applied'
          ? 'This increase has already taken effect. Schedule a decrease instead.'
          : 'This increase is already cancelled.',
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.tenantRateIncrease.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledByStaffId: staffIdOf(actor) },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: row.facilityId,
        action: 'rate.increase_cancelled',
        entityType: 'TenantRateIncrease',
        entityId: id,
        reasonCode: reasonCode.trim(),
        context: {
          leaseId: row.leaseId,
          newRateCents: row.newRateCents,
          effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
          statusWhenCancelled: row.status,
        },
      },
      tx,
    )
  })
  return { ok: true }
}

export async function cancelBatch(actor: Actor, batchId: string, reasonCode: string): Promise<{ cancelled: number }> {
  const rows = await prisma.tenantRateIncrease.findMany({
    where: { batchId, status: { in: [...LIVE_RATE_INCREASE_STATUSES] } },
    select: { id: true },
  })
  let cancelled = 0
  for (const row of rows) {
    const result = await cancelRateIncrease(actor, row.id, reasonCode)
    if (result.ok) cancelled += 1
  }
  return { cancelled }
}

export async function approveBatch(actor: Actor, batchId: string, reasonCode: string): Promise<{ approved: number }> {
  const rows = await prisma.tenantRateIncrease.findMany({
    where: { batchId, status: 'pending_approval' },
    select: { id: true },
  })
  let approved = 0
  for (const row of rows) {
    const result = await approveRateIncrease(actor, row.id, reasonCode)
    if (result.ok) approved += 1
  }
  return { approved }
}

type RecordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => void

export type NoticeRunResult = { sent: number }

/// CN-9: "send the tenant notice on the configured advance-notice date."
///
/// Emits the event and stamps `noticeSentAt`; the comms pipeline renders and
/// delivers it through the ordinary rule/template path (CN-9's own scope:
/// "this module only sends the electronic copy and records it").
///
/// **B-152 / D-88.** The claim, the stamp and the emit are ONE transaction,
/// and the emitted event id is written onto the row. Before B-152 the status
/// flipped first and the emit followed outside any transaction, so a row
/// could assert a notice had gone out with no event to show for it — and
/// nothing downstream ever asked what the provider did with it, which is why
/// an increase whose notice hard-bounced still applied thirty days later.
/// This function still cannot know the outcome (the outbox is drained by the
/// hourly cron, not inline), so the status it sets is a claim about the SEND,
/// and `reconcileRateIncreaseNotices` below is what later turns that claim
/// into a fact or into `notice_failed`.
export async function sendDueRateIncreaseNotices(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<NoticeRunResult> {
  const due = await prisma.tenantRateIncrease.findMany({
    where: { facilityId, status: 'approved', noticeDate: { lte: utcDay(businessDate) } },
  })

  let sent = 0
  for (const row of due) {
    if (!noticeIsDue(row, businessDate)) continue

    // Guarded update: two runs of the same business date (a catch-up tick,
    // a retry) must not send twice. `status: 'approved'` in the WHERE is the
    // claim — the second run matches zero rows. The emit rides inside the
    // same transaction, which is the outbox pattern `emitEvent`'s own doc
    // comment asks for: the status and the event it asserts commit together
    // or neither does.
    const noticed = await prisma.$transaction(async (tx) => {
      const claimed = await tx.tenantRateIncrease.updateMany({
        where: { id: row.id, status: 'approved' },
        data: { status: 'notice_sent', noticeSentAt: new Date() },
      })
      if (claimed.count === 0) return false

      const event = await emitEvent(
        {
          name: 'lease.rate_increase_scheduled',
          entityType: 'Lease',
          entityId: row.leaseId,
          facilityId,
          payload: {
            rateIncreaseId: row.id,
            previousRateCents: row.currentRateCents,
            newRateCents: row.newRateCents,
            effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
            noticeDays: row.noticeDays,
          },
        },
        tx,
      )
      await tx.tenantRateIncrease.update({
        where: { id: row.id },
        data: { noticeEventId: event.id },
      })
      return true
    })
    if (!noticed) continue

    sent += 1
    recordItem({ itemId: row.leaseId, ok: true, message: `rate-increase notice sent (effective ${row.effectiveDate.toISOString().slice(0, 10)})` })
  }

  return { sent }
}

/// How long a notice is given to produce a `Message` before "no send record"
/// is treated as a fact rather than as "the dispatcher has not got to it yet".
///
/// Two hours because the outbox drain is the FIRST thing the hourly cron does
/// (`app/api/cron/route.ts`), so an event emitted at any point in an hour has
/// been dispatched by the end of the next one. Anything still showing no
/// message after that produced none — a skip condition fired, or no rule
/// matched — and D-88 says that blocks.
///
/// It applies only to the "no record at all" verdict. A message that has
/// already bounced or been suppressed is a fact the moment it is recorded and
/// waits for nothing.
const NO_SEND_RECORD_GRACE_MS = 2 * 60 * 60 * 1000

export type NoticeReconcileResult = { checked: number; blocked: number }

/// PRD 02 §4.3 US-11, PRD 05 CN-9, D-88 (B-152). Checks what actually became
/// of every notice this facility has claimed to send, and holds the increases
/// whose notice provably did not arrive.
///
/// US-11 blocks an effective date that violates the minimum notice period —
/// a guarantee about DELIVERY. Until B-152 the code made that guarantee about
/// INTENT: `notice_sent` meant "we emitted an event", nothing ever reconciled
/// it against `Message.status`, and an increase noticed to a hard-bounced or
/// suppressed address applied on schedule anyway. That is the single fact
/// that makes an increase indefensible if the tenant disputes it.
///
/// D-88 (owner, Option A): a hard bounce, a suppression hit or no send record
/// **blocks** the increase and raises a task; the operator re-notices from a
/// good address and the clock restarts. Blocking is `notice_failed`, which
/// `applyIsDue` can never act on — the hold is structural, not a check the
/// apply job has to remember to repeat.
///
/// Called at the top of `applyDueRateIncreases`, which is per-facility and
/// daily, so it sweeps EVERY live notice rather than only the ones due today:
/// an operator who first hears about a dead address on the effective date has
/// no time left to re-notice, and thirty days of warning is the whole point.
export async function reconcileRateIncreaseNotices(
  facilityId: string,
  recordItem: RecordItem,
  now: Date = new Date(),
): Promise<NoticeReconcileResult> {
  const rows = await prisma.tenantRateIncrease.findMany({
    // `noticeEventId: null` is a row noticed before B-152 existed. Unjudgeable
    // rather than failed: there is nothing to look the messages up by, and
    // blocking on missing bookkeeping would hold increases whose notices were
    // fine. Every row written from B-152 onward has one, in the same
    // transaction as the status.
    where: { facilityId, status: 'notice_sent', noticeEventId: { not: null } },
    select: { id: true, leaseId: true, noticeEventId: true, noticeSentAt: true, effectiveDate: true },
  })

  const result: NoticeReconcileResult = { checked: 0, blocked: 0 }
  for (const row of rows) {
    const messages = await prisma.message.findMany({
      where: { eventId: row.noticeEventId! },
      select: { status: true },
    })
    result.checked += 1

    const verdict = noticeDeliveryVerdict(messages.map((message) => message.status))
    if (verdict === 'reached') continue
    if (
      verdict === 'no_send_record' &&
      now.getTime() - (row.noticeSentAt?.getTime() ?? 0) < NO_SEND_RECORD_GRACE_MS
    ) {
      continue
    }

    // Guarded on `notice_sent` for the same reason the send is: two ticks must
    // raise one task, not two.
    const blocked = await prisma.tenantRateIncrease.updateMany({
      where: { id: row.id, status: 'notice_sent' },
      data: { status: 'notice_failed', noticeFailureReason: verdict },
    })
    if (blocked.count === 0) continue

    await createTask({
      facilityId,
      type: 'rate_increase_notice_undelivered',
      entityType: 'Lease',
      entityId: row.leaseId,
      priority: 'high',
    })

    result.blocked += 1
    recordItem({
      itemId: row.leaseId,
      ok: false,
      message:
        verdict === 'undeliverable'
          ? `rate increase held — the notice did not arrive (effective ${row.effectiveDate.toISOString().slice(0, 10)})`
          : `rate increase held — no notice was ever sent (effective ${row.effectiveDate.toISOString().slice(0, 10)})`,
    })
  }

  return result
}

export type ApplyRunResult = { applied: number; skipped: number }

/// US-11: "The new rate applies automatically to the first invoice on/after
/// the effective date."
///
/// Runs at hour 0, BEFORE `billing.generate-invoices` at hour 1 — that
/// ordering is what makes "the first invoice on/after" true without
/// `invoices.ts` having to do an effective-dated read of its own. The rate
/// column is the current rate (US-11's own words), so once this has moved it,
/// every downstream reader is already correct.
export async function applyDueRateIncreases(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<ApplyRunResult> {
  // D-88 (B-152). Before anything is applied, ask what became of the notices.
  // Anything that provably did not arrive moves to `notice_failed` here and is
  // therefore not in the `due` set read on the next line.
  await reconcileRateIncreaseNotices(facilityId, recordItem)

  const due = await prisma.tenantRateIncrease.findMany({
    // `approved` is here for B-153's decreases, which never reach
    // `notice_sent` because they give no notice. `applyIsDue` is what decides
    // which of the two states is right for the row's direction — an approved
    // INCREASE is still refused, which is the property that had to survive
    // widening this query at all.
    where: {
      facilityId,
      status: { in: ['notice_sent', 'approved'] },
      effectiveDate: { lte: utcDay(businessDate) },
    },
  })

  const result: ApplyRunResult = { applied: 0, skipped: 0 }
  for (const row of due) {
    if (!applyIsDue(row, businessDate)) continue

    const lease = await prisma.lease.findUnique({
      where: { id: row.leaseId },
      select: { monthlyRateCents: true, status: true },
    })
    const decrease = isRateDecrease(row)
    const noun = decrease ? 'rate decrease' : 'rate increase'
    if (!lease || !OCCUPYING_LEASE_STATUSES.includes(lease.status as never)) {
      result.skipped += 1
      recordItem({ itemId: row.leaseId, ok: true, message: `${noun} skipped — the lease has ended` })
      continue
    }
    // The rate moved under an already-approved increase. Refused rather than
    // applied: the approver signed off on a delta from a specific figure, and
    // silently applying it to a different one would make the approval mean
    // something nobody agreed to.
    if (lease.monthlyRateCents !== row.currentRateCents) {
      result.skipped += 1
      recordItem({
        itemId: row.leaseId,
        ok: false,
        message: `${noun} skipped — the rate changed to ${lease.monthlyRateCents} after approval at ${row.currentRateCents}`,
      })
      continue
    }

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.tenantRateIncrease.updateMany({
        where: { id: row.id, status: row.status },
        data: { status: 'applied', appliedAt: new Date() },
      })
      if (claimed.count === 0) return

      await applyRateChange(
        {
          leaseId: row.leaseId,
          newRateCents: row.newRateCents,
          effectiveFrom: row.effectiveDate,
          reason: decrease ? 'retention' : 'ecri',
          actorStaffId: row.approvedByStaffId,
          noticeDays: row.noticeDays,
          rateIncreaseId: row.id,
        },
        tx,
      )
      result.applied += 1
      recordItem({
        itemId: row.leaseId,
        ok: true,
        message: `rate ${decrease ? 'lowered' : 'raised'} ${row.currentRateCents} → ${row.newRateCents}`,
      })
    })
  }

  return result
}

export type PendingIncreaseRow = {
  id: string
  batchId: string | null
  leaseId: string
  tenantName: string
  unitNumber: string
  currentRateCents: number
  newRateCents: number
  effectiveDate: Date
  noticeDate: Date
  noticeDays: number
  status: string
  approvedAt: Date | null
  noticeSentAt: Date | null
  /// B-152. Why a `notice_failed` row is held. Null on every other status.
  noticeFailureReason: string | null
  /// B-153. A retention save reads differently from an increase at every
  /// column — "Approved — notice pending" is a lie about one.
  isDecrease: boolean
}

export type RateIncreaseReview = {
  rows: PendingIncreaseRow[]
  /// US-11 AC: "shows pending increases with projected revenue delta."
  projectedMonthlyDeltaCents: number
}

/// The review screen's data. Live increases only — applied and cancelled ones
/// are history, and a review screen that accumulates every increase ever made
/// stops being a worklist.
export async function pendingRateIncreases(actor: Actor, facilityId: string): Promise<RateIncreaseReview> {
  // B-153: either rate authority sees the worklist. A manager who can make a
  // retention save but cannot see or cancel the one they just made has half a
  // feature, and this exposes nothing new — the same manager already reads
  // in-place rates on the tenant page and in the rate-variance report.
  if (!can(actor, 'rates:tenant_increase', facilityId)) {
    requirePermission(actor, 'credits:manual', facilityId)
  }

  const rows = await prisma.tenantRateIncrease.findMany({
    where: { facilityId, status: { in: [...LIVE_RATE_INCREASE_STATUSES] } },
    orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
    include: {
      lease: {
        select: {
          tenant: { select: { firstName: true, lastName: true } },
          unit: { select: { number: true } },
        },
      },
    },
  })

  return {
    rows: rows.map((row) => ({
      id: row.id,
      batchId: row.batchId,
      leaseId: row.leaseId,
      tenantName: `${row.lease.tenant.firstName} ${row.lease.tenant.lastName}`,
      unitNumber: row.lease.unit?.number ?? '—',
      currentRateCents: row.currentRateCents,
      newRateCents: row.newRateCents,
      effectiveDate: row.effectiveDate,
      noticeDate: row.noticeDate,
      noticeDays: row.noticeDays,
      status: row.status,
      approvedAt: row.approvedAt,
      noticeSentAt: row.noticeSentAt,
      noticeFailureReason: row.noticeFailureReason,
      isDecrease: isRateDecrease(row),
    })),
    // B-152: a held increase is not projected revenue. It cannot apply until
    // somebody re-notices it, and counting it here would put money in front of
    // an approver that the workflow has already decided not to charge.
    projectedMonthlyDeltaCents: projectedMonthlyDeltaCents(
      rows.filter((row) => row.status !== 'notice_failed'),
    ),
  }
}
