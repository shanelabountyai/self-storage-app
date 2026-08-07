import { prisma, type Prisma } from '@storage/db'
import type { GateCommandType } from '@storage/db'
import { createTask } from '@/lib/admin/tasks'

// PRD 03 US-6 (B-065). The manual fallback.
//
// "As a facility manager at a site with a non-integrated legacy keypad (or
// during a vendor outage), I fulfill access changes from a work queue instead
// of the system talking to hardware."
//
// AC1 is precise about what the task has to carry: "the exact keypad action,
// code value, and reason". A task that says "sync credential abc123" is a task
// somebody has to come and ask about, which defeats the point — the person
// reading it is standing at a keypad and needs to know which buttons to press.

export type ManualInstruction = {
  /// One imperative line. What to do at the keypad, in the order to do it.
  action: string
  /// The code to key in, where the action needs one. Rendered on the queue
  /// screen behind its own heading rather than in the task title, so it is not
  /// splashed across every list view a code has no business appearing in.
  code: string | null
  /// Why this is being asked for, in a sentence a person can act on.
  reason: string
}

/// Turns a queued command into instructions a human can follow.
///
/// Exported and pure so the wording is testable without a database — the
/// failure mode here is not a crash, it is an instruction that reads fine to
/// its author and means nothing at 7am to somebody holding a clipboard.
export function instructionFor(
  type: GateCommandType,
  context: { code: string | null; tenantName: string | null; unitNumber: string | null },
): ManualInstruction {
  const who = context.tenantName ?? 'this tenant'
  const unit = context.unitNumber ? ` (unit ${context.unitNumber})` : ''

  switch (type) {
    case 'set_credential':
      return {
        action: `Programme the code below into the keypad for ${who}${unit}.`,
        code: context.code,
        reason: 'A new or changed gate code has been issued and the keypad does not have it yet.',
      }
    case 'grant_access':
    case 'resume_access':
      return {
        action: `Enable ${who}${unit} at the keypad.`,
        code: context.code,
        reason: 'This tenant is entitled to access and the keypad currently refuses them.',
      }
    case 'suspend_access':
      return {
        action: `Disable ${who}${unit} at the keypad — do not delete the code.`,
        code: context.code,
        // Spelled out because "suspend" and "delete" are the same button on
        // some legacy panels, and deleting loses the history AC3 of US-3
        // requires be kept.
        reason:
          'Access is suspended, not ended. The code must stop working but stay on file so it can be turned back on.',
      }
    case 'revoke_access':
      return {
        action: `Remove ${who}${unit} from the keypad.`,
        code: context.code,
        reason: 'This tenant has moved out and should no longer get through the gate.',
      }
    case 'set_time_window':
      return {
        action: `Set the access schedule for ${who}${unit} to match the facility's published gate hours.`,
        code: null,
        reason: 'The facility gate hours changed and this keypad enforces them locally.',
      }
    default:
      return {
        action: `Apply "${type}" for ${who}${unit} at the keypad.`,
        code: context.code,
        reason: 'An access change is outstanding.',
      }
  }
}

/// AC1: "every command becomes a task."
///
/// Returns the task id. Deliberately NOT an `AdapterResult` — the manual
/// adapter cannot answer "did the controller take this", because the
/// controller is a person who has not been asked yet. The drain treats a
/// manual facility as a separate branch for that reason rather than pretending
/// a queued task is a successful send.
export async function raiseManualTask(command: {
  id: string
  type: GateCommandType
  facilityId: string
  grantId: string | null
  credentialId: string | null
  payload: Record<string, unknown>
}): Promise<{ taskId: string; instruction: ManualInstruction }> {
  const credential = command.credentialId
    ? await prisma.accessCredential.findUnique({
        where: { id: command.credentialId },
        select: {
          lease: { select: { unit: { select: { number: true } } } },
          grant: { select: { tenant: { select: { firstName: true, lastName: true } } } },
        },
      })
    : command.grantId
      ? await prisma.accessGrant
          .findUnique({
            where: { id: command.grantId },
            select: { tenant: { select: { firstName: true, lastName: true } } },
          })
          .then((grant) => (grant ? { lease: null, grant } : null))
      : null

  const tenant = credential?.grant.tenant
  const instruction = instructionFor(command.type, {
    // The plaintext code rides on the command payload already — it is what
    // `set_credential` sends to a controller. Reusing it here rather than
    // decrypting the credential keeps the reveal path (SR-2, audited) the only
    // way to get a code out of storage.
    code: typeof command.payload.code === 'string' ? command.payload.code : null,
    tenantName: tenant ? `${tenant.firstName} ${tenant.lastName}` : null,
    unitNumber: credential?.lease?.unit?.number ?? null,
  })

  // Keyed on the COMMAND, so the outbox's own idempotency carries through:
  // one command is one task, however many times the drain looks at it.
  const task = await createTask({
    facilityId: command.facilityId,
    type: 'gate_manual_action',
    entityType: 'GateCommand',
    entityId: command.id,
    // High from the start. A tenant is standing at a gate that will not open,
    // or a moved-out tenant still has a working code — neither is a
    // when-you-get-to-it item.
    priority: 'high',
  })

  // The instruction is deliberately NOT written to the task row.
  //
  // `Task.proof` is what staff supply on completion, and completing replaces it
  // wholesale — parking the ask there would have it overwritten by the note
  // that says it was done. The task points at its `GateCommand` through
  // `entityId`, so the queue screen re-derives the instruction from the command
  // whenever it renders. Nothing to keep in step, and rewording an instruction
  // improves every open task rather than only the next one.
  return { taskId: task.id, instruction }
}

/// Whether this facility talks to a controller or to a person.
export async function usesManualAdapter(facilityId: string): Promise<boolean> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { gateAdapter: true },
  })
  return facility?.gateAdapter === 'manual'
}

/// AC1: "completing the task confirms the grant state and stamps actor + time."
///
/// The stamp is `completeTask`'s own (B-095 records actor and timestamp on the
/// row, and this type is `sensitive` so it also writes an audit entry). What
/// this adds is the confirmation half: the command the task was raised for is
/// only settled once a human says they did it.
///
/// Idempotent — completing an already-completed task, or one whose command has
/// since been superseded, is a no-op rather than an error.
export async function settleCommandForTask(
  taskId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const task = await client.task.findUnique({
    where: { id: taskId },
    select: { type: true, entityType: true, entityId: true },
  })
  if (!task || task.type !== 'gate_manual_action' || task.entityType !== 'GateCommand') return

  const command = await client.gateCommand.findUnique({
    where: { id: task.entityId },
    select: { id: true, status: true, credentialId: true },
  })
  if (!command || command.status === 'succeeded') return

  await client.gateCommand.updateMany({
    where: { id: command.id },
    data: { status: 'succeeded', completedAt: new Date() },
  })
  if (command.credentialId) {
    // Same `updateMany` reasoning as the automated drain: a credential deleted
    // since must not throw and wedge the queue behind it.
    await client.accessCredential.updateMany({
      where: { id: command.credentialId },
      data: { syncStatus: 'synced', lastSyncAt: new Date() },
    })
  }
}

/// AC3: "Switching a facility between adapters preserves all grants and
/// history; pending commands are re-routed to the new adapter."
///
/// Grants and credentials are untouched on purpose — they are the record of who
/// is entitled to what, and no adapter owns them. What moves is only the
/// queue.
export async function switchGateAdapter(
  facilityId: string,
  adapter: 'simulated' | 'manual',
): Promise<{ rerouted: number }> {
  const before = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { gateAdapter: true },
  })
  if (before.gateAdapter === adapter) return { rerouted: 0 }

  await prisma.facility.update({ where: { id: facilityId }, data: { gateAdapter: adapter } })

  if (adapter === 'manual') {
    // Nothing to move: the next drain sees a manual facility and raises tasks
    // for whatever is still pending or failed. Dead-lettered commands are left
    // dead — they gave up for a reason and re-animating them silently would
    // undo a decision somebody has already been alerted about.
    return { rerouted: 0 }
  }

  // Switching back to an integrated controller. Commands parked on a human go
  // back into the automated queue, and their tasks are cancelled — leaving them
  // open would have staff keying in changes the controller is about to make.
  const parked = await prisma.gateCommand.findMany({
    where: { facilityId, status: 'awaiting_manual' },
    select: { id: true },
  })
  if (parked.length === 0) return { rerouted: 0 }

  await prisma.$transaction(async (tx) => {
    await tx.gateCommand.updateMany({
      where: { id: { in: parked.map((command) => command.id) } },
      // `attempts` deliberately not reset: a command that failed three times
      // against the controller, was parked, and is now coming back has not
      // earned a fresh five attempts.
      data: { status: 'pending', nextAttemptAt: new Date() },
    })
    await tx.task.updateMany({
      where: {
        facilityId,
        type: 'gate_manual_action',
        status: 'open',
        entityId: { in: parked.map((command) => command.id) },
      },
      data: { status: 'cancelled' },
    })
  })

  return { rerouted: parked.length }
}
