import { prisma } from '@storage/db'
import { isOverdue } from '@storage/core/access'
import { requiredProofFieldsForType } from '@storage/core/tasks'
import type { ProofField } from '@storage/core/delinquency'
import { parseWeeklySchedule } from '@storage/core/facility-settings'
import { instructionFor, type ManualInstruction } from '@/lib/access/manual-adapter'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

/// Every row in this queue is one type, which is what makes the proof gate a
/// constant here rather than a lookup per row.
const TASK_TYPE = 'gate_manual_action'
const PROOF_FIELDS_FOR_TYPE = requiredProofFieldsForType(TASK_TYPE)

// PRD 03 US-6 (B-065). The work queue a manual facility runs from.
//
// Reads `Task` — §4.9 US-41 is explicit that every later queue reads the one
// task entity rather than inventing its own — and joins each row back to the
// `GateCommand` it was raised for, so the instruction is DERIVED at render
// time rather than frozen into the task when it was created.
//
// That is the whole reason the instruction is not stored: `Task.proof` is what
// staff supply on completion and completing replaces it, so an instruction
// parked there would be overwritten by the note saying it was done.

export type ManualQueueItem = {
  taskId: string
  commandId: string
  commandType: string
  createdAt: Date
  /// US-6 AC2. Business hours against the facility's own office hours, so a
  /// task raised at 6pm on Friday is not four hours late on Friday night.
  overdue: boolean
  assigneeName: string | null
  instruction: ManualInstruction
  /// B-170. The gate `completeTask` will apply, so the card renders a control
  /// for each field rather than assuming a note. Read from the type here rather
  /// than in the view, for the same reason the instruction is: a queue should
  /// not have to know a `Task.type` string to render its own row.
  requiredProofFields: readonly ProofField[]
}

export async function manualQueue(
  actor: Actor,
  facilityId: string,
): Promise<{ items: ManualQueueItem[]; slaHours: number; adapter: string }> {
  assertFacilityAccess(actor, facilityId)
  if (!can(actor, 'tenants:view', facilityId)) {
    throw new ForbiddenError('Missing permission to read tasks', 'tenants:view', facilityId)
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { timezone: true, officeHours: true, manualTaskSlaHours: true, gateAdapter: true },
  })

  const tasks = await prisma.task.findMany({
    where: { facilityId, type: TASK_TYPE, status: 'open' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      entityId: true,
      createdAt: true,
      assignee: { select: { firstName: true, lastName: true } },
    },
  })
  if (tasks.length === 0) {
    return { items: [], slaHours: facility.manualTaskSlaHours, adapter: facility.gateAdapter }
  }

  const commands = await prisma.gateCommand.findMany({
    where: { id: { in: tasks.map((task) => task.entityId) } },
    select: {
      id: true,
      type: true,
      payload: true,
      credentialId: true,
    },
  })
  const commandById = new Map(commands.map((command) => [command.id, command]))

  // Who and which unit, resolved in one pass rather than per row.
  const credentialIds = commands
    .map((command) => command.credentialId)
    .filter((id): id is string => typeof id === 'string')
  const credentials = credentialIds.length
    ? await prisma.accessCredential.findMany({
        where: { id: { in: credentialIds } },
        select: {
          id: true,
          lease: { select: { unit: { select: { number: true } } } },
          grant: { select: { tenant: { select: { firstName: true, lastName: true } } } },
        },
      })
    : []
  const credentialById = new Map(credentials.map((row) => [row.id, row]))

  const now = new Date()
  const officeHours = parseWeeklySchedule(facility.officeHours)

  const items: ManualQueueItem[] = []
  for (const task of tasks) {
    const command = commandById.get(task.entityId)
    // A task whose command has vanished is not renderable as an instruction.
    // Skipped rather than shown as a broken row — nothing can be done about it
    // at a keypad, and the task itself is still visible in the ordinary list.
    if (!command) continue

    const credential = command.credentialId ? credentialById.get(command.credentialId) : null
    const tenant = credential?.grant.tenant
    const payload = (command.payload ?? {}) as Record<string, unknown>

    items.push({
      taskId: task.id,
      requiredProofFields: PROOF_FIELDS_FOR_TYPE,
      commandId: command.id,
      commandType: command.type,
      createdAt: task.createdAt,
      overdue: isOverdue({
        schedule: officeHours,
        createdAt: task.createdAt,
        now,
        slaHours: facility.manualTaskSlaHours,
        timezone: facility.timezone,
      }),
      assigneeName: task.assignee
        ? `${task.assignee.firstName} ${task.assignee.lastName}`
        : null,
      instruction: instructionFor(command.type, {
        code: typeof payload.code === 'string' ? payload.code : null,
        tenantName: tenant ? `${tenant.firstName} ${tenant.lastName}` : null,
        unitNumber: credential?.lease?.unit?.number ?? null,
      }),
    })
  }

  // Overdue first, then oldest. The order somebody working the queue wants.
  items.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    return a.createdAt.getTime() - b.createdAt.getTime()
  })

  return { items, slaHours: facility.manualTaskSlaHours, adapter: facility.gateAdapter }
}
