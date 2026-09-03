import { prisma } from '@storage/db'
import { type JobItemOutcome } from '@storage/core/jobs'
import { can, facilityAccess, ForbiddenError, hasPermissionAnywhere } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { SCHEDULED_JOBS, scheduledJobLabel } from '@/lib/jobs/registry'
import { dueRunQueue } from '@/lib/jobs/queue'
import { runScheduledJob } from '@/lib/jobs/run'
import { resolveTaskSubjects, type TaskSubject } from '@/lib/admin/task-subjects'

// PRD 02 FR-4: "logged to a Billing Runs screen with per-item outcomes, and
// manually re-runnable by admin."
//
// A read over `JobRun`, which already carries everything the screen needs —
// B-006 built the row and B-043's catch-up filled in the history. Nothing new
// is stored for this screen.

/// B-229. A failed item's subject, resolved the way a task card's is — a
/// tenant name and a unit number, linked to the profile — instead of the raw
/// cuid `recordItem` was handed.
export type BillingRunItem = JobItemOutcome & { subject: TaskSubject }

export type BillingRunRow = {
  id: string
  jobName: string
  /// What an operator would call this job. `jobName` is kept alongside it for
  /// the re-run form and the screen-reader sentence, never rendered on its own.
  jobLabel: string
  facilityId: string | null
  facilityName: string
  businessDate: Date
  status: string
  startedAt: Date
  finishedAt: Date | null
  itemsOk: number
  itemsFailed: number
  items: BillingRunItem[]
  lastError: string | null
  /// False for a job whose handler is no longer registered — the row is still
  /// history worth reading, it just cannot be re-run.
  rerunnable: boolean
}

const READ_PERMISSIONS = ['reports:financial', 'payments:take'] as const

/// Recent runs the actor may see, newest first.
///
/// Global runs (facilityId null) are visible only to an actor with
/// all-facilities access: a single-site manager has no business reading the
/// portfolio-wide outbox drain, and there is no facility to scope it to.
export async function recentRuns(actor: Actor, limit = 100): Promise<BillingRunRow[]> {
  if (!hasPermissionAnywhere(actor, READ_PERMISSIONS)) {
    throw new ForbiddenError('Missing permission to read billing runs', 'reports:financial')
  }
  const access = facilityAccess(actor)

  const runs = await prisma.jobRun.findMany({
    where: access.all ? {} : { facilityId: { in: access.facilityIds } },
    orderBy: [{ startedAt: 'desc' }],
    take: limit,
    include: { facility: { select: { name: true } } },
  })

  const registered = new Set(SCHEDULED_JOBS.map((job) => job.name))
  const rows = runs.map((run) => ({ run, items: itemsOf(run.details) }))
  const subjects = await resolveFailedItemSubjects(rows)

  return rows.map(({ run, items }) => ({
    id: run.id,
    jobName: run.jobName,
    jobLabel: scheduledJobLabel(run.jobName),
    facilityId: run.facilityId,
    facilityName: run.facility?.name ?? 'All facilities',
    businessDate: run.businessDate,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    itemsOk: run.itemsOk,
    itemsFailed: run.itemsFailed,
    items: items.map((item) => ({
      ...item,
      subject: item.ok
        ? { label: item.itemId, href: null }
        : (subjects.get(item.itemId) ?? UNKNOWN_SUBJECT),
    })),
    lastError: run.lastError,
    rerunnable: registered.has(run.jobName),
  }))
}

/// B-236. What the scheduler still owes, right now.
///
/// The load-bearing half of B-236, and deliberately DERIVED rather than
/// recorded. A tick that runs out of its budget could report "I deferred 40
/// runs" — but a tick that never fires at all reports nothing, and that is the
/// failure an operator most needs to see. Asking `dueRunQueue` the same
/// question the scheduler asks answers both, and cannot drift from it.
///
/// This is what makes B-229's alarm mean something: a run that FAILED is a row
/// on the table below with a status and an error, a run that has not happened
/// YET is this line, and until now the second looked exactly like a quiet
/// night. `oldest` is the tell that separates the two — today's date is a tick
/// still in progress, an earlier one is a backlog.
export type OutstandingRuns = { total: number; facilities: number; oldest: Date | null }

export async function outstandingRuns(actor: Actor, now = new Date()): Promise<OutstandingRuns> {
  if (!hasPermissionAnywhere(actor, READ_PERMISSIONS)) {
    throw new ForbiddenError('Missing permission to read billing runs', 'reports:financial')
  }
  const access = facilityAccess(actor)

  const facilities = await prisma.facility.findMany({
    where: { status: 'active', ...(access.all ? {} : { id: { in: access.facilityIds } }) },
    select: { id: true, timezone: true },
  })
  // A single-site manager sees their own sites' backlog and not the global
  // jobs' — same rule as `recentRuns`, and for the same reason: there is no
  // facility to scope the portfolio-wide outbox drain to.
  const groups = (await dueRunQueue(facilities, now)).filter(
    (group) => access.all || group.facilityId !== null,
  )

  const runs = groups.flatMap((group) => group.runs)
  const oldest = runs.reduce<Date | null>(
    (earliest, run) => (!earliest || run.businessDate < earliest ? run.businessDate : earliest),
    null,
  )
  return { total: runs.length, facilities: groups.filter((g) => g.facilityId !== null).length, oldest }
}

/// B-229. What `recordItem` is handed is an entity id with no type attached —
/// a lease, a tenant, an invoice, a payment plan or the facility, depending on
/// the job. Rather than adding a type to forty call sites, every candidate type
/// is offered to the one resolver both task screens already use and the first
/// hit wins; ids are cuids, so a collision across tables is not a thing that
/// happens.
///
/// FAILED items only. A nightly biller records one ok item per lease, so
/// resolving every item would put every lease at every facility into an `IN`
/// clause to label rows nobody reads — the failures are the three somebody
/// actually has to go and look at.
const CANDIDATE_TYPES = ['Lease', 'Invoice', 'Tenant', 'PaymentPlan'] as const

/// The honest fallback for an id nothing claims — a payment-plan installment
/// whose plan was deleted, or a job recording something these types do not
/// cover. Never the raw cuid, which is what this replaced.
const UNKNOWN_SUBJECT: TaskSubject = { label: 'Unknown record', href: null }

async function resolveFailedItemSubjects(
  rows: readonly { run: { facilityId: string | null }; items: readonly JobItemOutcome[] }[],
): Promise<Map<string, TaskSubject>> {
  const resolved = new Map<string, TaskSubject>()
  const unresolved = new Set<string>()

  for (const { run, items } of rows) {
    for (const item of items) {
      if (item.ok) continue
      // Two ids a job records that are not entity rows: a per-facility job
      // reporting on the facility as a whole, and a global one on the portfolio.
      // The Facility column already names the first, so this is an
      // acknowledgement rather than a repeat.
      if (item.itemId === 'global') resolved.set(item.itemId, { label: 'All facilities', href: null })
      else if (item.itemId === run.facilityId) resolved.set(item.itemId, { label: 'This facility', href: null })
      else unresolved.add(item.itemId)
    }
  }
  if (unresolved.size === 0) return resolved

  const candidates = [...unresolved].flatMap((entityId) =>
    CANDIDATE_TYPES.map((entityType) => ({ entityType, entityId })),
  )
  const found = await resolveTaskSubjects(candidates)

  for (const entityId of unresolved) {
    for (const entityType of CANDIDATE_TYPES) {
      const subject = found.get(`${entityType}:${entityId}`)
      if (subject) {
        resolved.set(entityId, subject)
        break
      }
    }
  }
  return resolved
}

/// `JobRun.details` is `{ items: [...] }` written by the runner. Read
/// defensively — it is JSON, and a row written by an older shape must render
/// as "no detail" rather than crash the screen.
function itemsOf(details: unknown): JobItemOutcome[] {
  if (!details || typeof details !== 'object') return []
  const items = (details as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  return items.filter(
    (item): item is JobItemOutcome =>
      Boolean(item) && typeof item === 'object' && typeof (item as JobItemOutcome).itemId === 'string',
  )
}

export type RerunResult =
  | { ok: true; status: string }
  | { ok: false; reason: 'unknown_job' }

/// FR-4's manual re-run. `force` is set here and nowhere else — the scheduler
/// never sets it, which is what keeps the nightly path idempotent.
///
/// Gated on `facility:settings` rather than the read permissions above:
/// re-running a billing job re-does work that may charge money, and counter
/// staff hold `payments:take`.
export async function rerunJobRun(actor: Actor, runId: string): Promise<RerunResult> {
  const run = await prisma.jobRun.findUniqueOrThrow({ where: { id: runId } })

  if (run.facilityId) {
    if (!can(actor, 'facility:settings', run.facilityId)) {
      throw new ForbiddenError('Missing permission to re-run billing jobs', 'facility:settings', run.facilityId)
    }
  } else {
    // A global run belongs to no facility, so "at this facility" cannot be
    // asked. Require both the permission and unrestricted facility access.
    if (!facilityAccess(actor).all || !hasPermissionAnywhere(actor, ['facility:settings'])) {
      throw new ForbiddenError('Missing permission to re-run global jobs', 'facility:settings')
    }
  }

  const job = SCHEDULED_JOBS.find((candidate) => candidate.name === run.jobName)
  if (!job) return { ok: false, reason: 'unknown_job' }

  const result = await runScheduledJob(job, {
    facilityId: run.facilityId,
    businessDate: run.businessDate,
    force: true,
  })
  return { ok: true, status: result.status === 'skipped' ? `skipped:${result.reason}` : result.run.status }
}
