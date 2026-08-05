import { prisma, type Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { businessDateFor } from '@storage/core/jobs'
import { missingProofFields, taskTypeIsSensitive, taskTypeSpec, type TaskType } from '@storage/core/tasks'
import { assertFacilityAccess, can, facilityAccess, ForbiddenError } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.9 US-41 (B-095). One task queue. Every function here is generic
// over `type` — the catalog (packages/core/tasks) is what a caller adds to,
// never this file.

export type CreateTaskInput = {
  facilityId: string
  type: TaskType
  entityType: string
  entityId: string
  /// Defaults to now, in the facility's own timezone. Callers pass an
  /// explicit instant only when backdating (e.g. an abandonment task dated to
  /// last occupancy evidence) — none do yet.
  at?: Date
  priority?: 'normal' | 'high'
  sourceEventId?: string
  client?: Prisma.TransactionClient | typeof prisma
}

/// Creates a task, or does nothing if an equivalent one already exists.
///
/// "Equivalent" is US-41's own idempotency key: the same (type, entityId) on
/// the same facility-local business day. A domain event that redelivers — the
/// normal case for an at-least-once outbox — must produce one task, not one
/// per delivery. Callers that already know the facility's timezone can pass
/// it; this reads it otherwise, since most call sites have only a facilityId.
export async function createTask(input: CreateTaskInput): Promise<{ id: string; created: boolean }> {
  const client = input.client ?? prisma
  const facility = await client.facility.findUniqueOrThrow({
    where: { id: input.facilityId },
    select: { timezone: true },
  })
  const businessDate = businessDateFor(input.at ?? new Date(), facility.timezone)

  const existing = await client.task.findUnique({
    where: { type_entityId_businessDate: { type: input.type, entityId: input.entityId, businessDate } },
    select: { id: true },
  })
  if (existing) return { id: existing.id, created: false }

  try {
    const task = await client.task.create({
      data: {
        facilityId: input.facilityId,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        businessDate,
        priority: input.priority ?? 'normal',
        sourceEventId: input.sourceEventId,
      },
    })
    return { id: task.id, created: true }
  } catch (error) {
    // A concurrent creator won the race between the read above and this
    // insert — the unique constraint is the real guarantee, the findUnique
    // above is just the fast path that avoids hitting it on every redelivery.
    if (isUniqueConstraintError(error)) {
      const row = await client.task.findUniqueOrThrow({
        where: { type_entityId_businessDate: { type: input.type, entityId: input.entityId, businessDate } },
        select: { id: true },
      })
      return { id: row.id, created: false }
    }
    throw error
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}

export type TaskRow = {
  id: string
  type: string
  label: string
  facilityId: string
  facilityName: string
  entityType: string
  entityId: string
  businessDate: Date
  priority: 'normal' | 'high'
  overdue: boolean
  assigneeName: string | null
  status: 'open' | 'completed' | 'cancelled'
}

/// "My day": open tasks at a facility, today's business date by default.
/// Overdue means the row's own business day has already passed while it is
/// still open — a task never becomes overdue by clock time within the day it
/// was created.
export async function facilityTasks(
  actor: Actor,
  facilityId: string,
  options: { businessDate?: Date; includeCompleted?: boolean } = {},
): Promise<TaskRow[]> {
  assertFacilityAccess(actor, facilityId)
  if (!can(actor, 'tenants:view', facilityId)) {
    throw new ForbiddenError('Missing permission to read tasks', 'tenants:view', facilityId)
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { name: true, timezone: true },
  })
  const today = businessDateFor(new Date(), facility.timezone)
  const businessDate = options.businessDate ?? today

  const tasks = await prisma.task.findMany({
    where: {
      facilityId,
      businessDate: options.businessDate ? businessDate : { lte: businessDate },
      status: options.includeCompleted ? undefined : 'open',
    },
    orderBy: [{ businessDate: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      type: true,
      facilityId: true,
      entityType: true,
      entityId: true,
      businessDate: true,
      priority: true,
      status: true,
      assignee: { select: { firstName: true, lastName: true } },
    },
  })

  return tasks.map((task) => ({
    id: task.id,
    type: task.type,
    label: taskTypeSpec(task.type)?.label ?? task.type,
    facilityId: task.facilityId,
    facilityName: facility.name,
    entityType: task.entityType,
    entityId: task.entityId,
    businessDate: task.businessDate,
    priority: task.priority,
    overdue: task.status === 'open' && task.businessDate.getTime() < today.getTime(),
    assigneeName: task.assignee ? `${task.assignee.firstName} ${task.assignee.lastName}` : null,
    status: task.status,
  }))
}

export type FacilityRollup = { facilityId: string; facilityName: string; openCount: number; overdueCount: number }

/// The regional roll-up: open-task counts per facility, for an actor who can
/// see more than one. A facility a single-site manager cannot see never
/// appears — this is `facilityScope`, not every facility that has tasks.
export async function taskRollup(actor: Actor): Promise<FacilityRollup[]> {
  const access = facilityAccess(actor)
  const facilities = await prisma.facility.findMany({
    where: access.all ? {} : { id: { in: access.facilityIds } },
    select: { id: true, name: true, timezone: true },
  })
  if (facilities.length === 0) return []

  const openTasks = await prisma.task.findMany({
    where: { facilityId: { in: facilities.map((f) => f.id) }, status: 'open' },
    select: { facilityId: true, businessDate: true },
  })

  const byFacility = new Map(facilities.map((f) => [f.id, { open: 0, overdue: 0, timezone: f.timezone }]))
  for (const task of openTasks) {
    const bucket = byFacility.get(task.facilityId)
    if (!bucket) continue
    bucket.open += 1
    const today = businessDateFor(new Date(), bucket.timezone)
    if (task.businessDate.getTime() < today.getTime()) bucket.overdue += 1
  }

  return facilities.map((facility) => ({
    facilityId: facility.id,
    facilityName: facility.name,
    openCount: byFacility.get(facility.id)?.open ?? 0,
    overdueCount: byFacility.get(facility.id)?.overdue ?? 0,
  }))
}

export type CompleteTaskResult = { ok: true } | { ok: false; missingFields: string[] }

/// Completes a task. Refuses when the type's required proof fields (the
/// catalog) are not all present — "proof-gated completion" is enforced here,
/// once, rather than by each screen that happens to render a Complete button.
export async function completeTask(
  actor: Actor,
  taskId: string,
  proof: Record<string, unknown>,
): Promise<CompleteTaskResult> {
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff access required')

  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } })
  assertFacilityAccess(actor, task.facilityId)
  if (!can(actor, 'tenants:edit', task.facilityId)) {
    throw new ForbiddenError('Missing permission to complete tasks', 'tenants:edit', task.facilityId)
  }
  if (task.status !== 'open') return { ok: true }

  const missingFields = missingProofFields(task.type, proof)
  if (missingFields.length > 0) return { ok: false, missingFields }

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        proof: proof as Prisma.InputJsonValue,
        completedByStaffId: actor.staffUserId,
        completedAt: new Date(),
      },
    })

    if (taskTypeIsSensitive(task.type)) {
      await recordAudit(
        {
          actor: toAuditActor(actor),
          facilityId: task.facilityId,
          action: 'task.completed',
          entityType: 'Task',
          entityId: taskId,
          context: { type: task.type, entityType: task.entityType, entityId: task.entityId, proof },
        },
        tx,
      )
    }
  })

  return { ok: true }
}

/// Assigns (or unassigns, with `staffUserId: null`) a task. Split from
/// `completeTask` because picking up a task and finishing it are different
/// acts, and a "my day" list needs to be able to do the first without the
/// second.
export async function assignTask(actor: Actor, taskId: string, staffUserId: string | null): Promise<void> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } })
  assertFacilityAccess(actor, task.facilityId)
  if (!can(actor, 'tenants:edit', task.facilityId)) {
    throw new ForbiddenError('Missing permission to assign tasks', 'tenants:edit', task.facilityId)
  }
  await prisma.task.update({ where: { id: taskId }, data: { assigneeStaffId: staffUserId } })
}

/// Withdraws an open task without completing it — the request it was about
/// stopped being true (B-041: a tenant cancelled their own move-out request
/// before staff acted on it). No `Actor` parameter: this is called from
/// trusted server-side code as a direct side effect of the same action that
/// changed the underlying record, the same way `createTask` is, not from a
/// staff-facing form that needs a permission check of its own. A no-op if no
/// open task matches — cancelling a request that was never reviewed and one
/// that never had a task at all look the same from here.
export async function cancelOpenTask(
  type: TaskType,
  entityId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await client.task.updateMany({
    where: { type, entityId, status: 'open' },
    data: { status: 'cancelled' },
  })
}
