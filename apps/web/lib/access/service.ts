import { randomInt } from 'node:crypto'
import { type GateCommandType, type Prisma, prisma } from '@storage/db'
import { canTransition, type GrantCause, type GrantState } from '@storage/core/access'
import { emitEvent } from '@storage/core/events'
import { recordAudit } from '@storage/core/audit'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { raiseManualTask, usesManualAdapter } from '@/lib/access/manual-adapter'
import { adapterFor } from './adapter'
import {
  accessCodeEncryptionKey,
  CodeNotRevealableError,
  decryptCode,
  encryptCode,
  hashCode,
  unrevealableRef,
} from './secret'

// PRD 03 FR-1 / FR-2 / FR-3. The access-control service.

/// FR-2: per-facility code policy. One policy today, and the place to make it
/// per-facility later is this constant rather than a scatter of literals.
// ponytail: fixed 6-digit policy; per-facility length and banned patterns when
// a real controller imposes them.
const CODE_LENGTH = 6

/// Codes are generated server-side and never hand-typed (FR-2). Rejecting the
/// obvious patterns matters more than it looks: a keypad wears, and "123456" or
/// six identical digits is the code a stranger tries first.
export function generateCode(): string {
  for (;;) {
    let code = ''
    for (let i = 0; i < CODE_LENGTH; i++) code += randomInt(0, 10).toString()
    if (/^(\d)\1+$/.test(code)) continue
    if ('0123456789'.includes(code) || '9876543210'.includes(code)) continue
    return code
  }
}

export type EnsureGrantResult = {
  grantId: string
  state: GrantState
  created: boolean
}

/// FR-1: one grant per credential holder × facility — the tenant is one
/// holder, and each authorized person on one of their leases (US-9) is
/// another. Exactly one of `tenantId`/`authorizedPersonId` is set; the DB CHECK
/// constraint (migration 20260802110000) backstops that at write time too.
export type AccessHolder = { tenantId: string } | { authorizedPersonId: string }

export async function ensureGrantForHolder(
  facilityId: string,
  holder: AccessHolder,
  cause: GrantCause,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<EnsureGrantResult> {
  const existing =
    'tenantId' in holder
      ? await client.accessGrant.findUnique({
          where: { facilityId_tenantId: { facilityId, tenantId: holder.tenantId } },
        })
      : await client.accessGrant.findUnique({
          where: { authorizedPersonId: holder.authorizedPersonId },
        })
  if (existing) {
    return { grantId: existing.id, state: existing.state as GrantState, created: false }
  }

  const grant = await client.accessGrant.create({
    data: { facilityId, ...holder, state: 'pending', stateCause: cause },
  })
  return { grantId: grant.id, state: 'pending', created: true }
}

/// A tenant with two units at one site still holds one grant; the same tenant
/// at two sites holds two.
export async function ensureGrant(
  facilityId: string,
  tenantId: string,
  cause: GrantCause,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<EnsureGrantResult> {
  return ensureGrantForHolder(facilityId, { tenantId }, cause, client)
}

export type TransitionResult =
  | { ok: true; state: GrantState; changed: boolean }
  | { ok: false; reason: string }

/// Moves a grant, records the cause, and queues the hardware command.
///
/// Refusing an illegal move is the point: a revoked grant cannot be revived
/// (the history of why access ended is evidence), and re-suspending an already
/// suspended grant is a no-op rather than a second command to the controller.
export async function transitionGrant(
  grantId: string,
  to: GrantState,
  cause: GrantCause,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<TransitionResult> {
  const grant = await client.accessGrant.findUnique({ where: { id: grantId } })
  if (!grant) return { ok: false, reason: 'No such grant' }

  const from = grant.state as GrantState
  const verdict = canTransition(from, to)
  if (!verdict.allowed) {
    // Same-state is not an error to the caller — a delinquency run that fires
    // twice should be quiet — but it must not enqueue a second command.
    if (from === to) return { ok: true, state: from, changed: false }
    return { ok: false, reason: verdict.reason }
  }

  await client.accessGrant.update({
    where: { id: grantId },
    data: { state: to, stateCause: cause },
  })

  await enqueueCommand(
    {
      facilityId: grant.facilityId,
      grantId,
      type:
        to === 'active'
          ? from === 'suspended'
            ? 'resume_access'
            : 'grant_access'
          : to === 'suspended'
            ? 'suspend_access'
            : 'revoke_access',
      // Keyed on the grant AND the state it is moving to, so a retry of the
      // same transition dedupes while a genuine suspend→active→suspend does not.
      idempotencyKey: `grant:${grantId}:${to}:${grant.updatedAt.getTime()}`,
      payload: { cause },
    },
    client,
  )

  await emitEvent(
    {
      // `restored` and `granted` are different facts and the catalog has both:
      // one is a move-in, the other is a tenant who paid and is being let back
      // in. They mirror the command types chosen just above. Before B-098 this
      // emitted `granted` for a restore, so the restore notice CN-11 asks for
      // had no event to fire on.
      name:
        to === 'active'
          ? from === 'suspended'
            ? 'access.restored'
            : 'access.granted'
          : to === 'suspended'
            ? 'access.suspended'
            : 'access.revoked',
      facilityId: grant.facilityId,
      entityType: 'AccessGrant',
      entityId: grantId,
      payload: { from, to, cause },
    },
    client,
  )

  return { ok: true, state: to, changed: true }
}

/// FR-2's uniqueness scope: no two active codes at the same facility. Bounded
/// rather than infinite — the 6-digit keyspace minus the handful of banned
/// patterns is around 9.9 million, so this many collisions in a row means a
/// facility is nearly saturated, not bad luck, and a caller needs to know
/// rather than spin forever.
const MAX_CODE_ATTEMPTS = 20

/// Exported (rather than kept private) so its retry-and-give-up behavior is
/// directly testable without controlling `randomInt`'s output; `codeGenerator`
/// defaults to the real policy and only tests pass anything else.
export async function generateUniqueCode(
  facilityId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
  codeGenerator: () => string = generateCode,
): Promise<{ code: string; codeHash: string }> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = codeGenerator()
    const codeHash = hashCode(code)
    const collision = await client.accessCredential.findFirst({
      where: { facilityId, codeHash, state: 'active' },
      select: { id: true },
    })
    if (!collision) return { code, codeHash }
  }
  throw new Error(`No unique gate code available for facility ${facilityId} after ${MAX_CODE_ATTEMPTS} attempts`)
}

export type IssuedCredential = { credentialId: string; code: string }

/// Issues a gate code for a grant and queues it for the controller.
///
/// Returns the plaintext code exactly once, to its caller, for immediate
/// delivery (a confirmation screen, a counter receipt). The credential row
/// itself stores it encrypted (`lib/access/secret.ts`) rather than as a bare
/// reference, so a later, separately audited `revealCode()` can still recover
/// it (SR-2) — never plaintext, never logged.
export async function issueCredential(
  grantId: string,
  leaseId: string | null,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<IssuedCredential> {
  const grant = await client.accessGrant.findUniqueOrThrow({ where: { id: grantId } })
  const { code, codeHash } = await generateUniqueCode(grant.facilityId, client)
  const key = accessCodeEncryptionKey()

  const credential = await client.accessCredential.create({
    data: {
      facilityId: grant.facilityId,
      grantId,
      leaseId,
      type: 'pin',
      valueRef: key ? encryptCode(code, key) : unrevealableRef(),
      codeHash,
      state: 'active',
      syncStatus: 'pending',
    },
  })

  await enqueueCommand(
    {
      facilityId: grant.facilityId,
      grantId,
      credentialId: credential.id,
      type: 'set_credential',
      idempotencyKey: `credential:${credential.id}`,
      // Plaintext, because the controller needs the real digits — but it must
      // not reach a log line, and command payloads are not audit-logged.
      payload: { code },
    },
    client,
  )

  return { credentialId: credential.id, code }
}

export type RevealedCode = { available: true; code: string } | { available: false; reason: string }

/// SR-2: viewing a holder's actual code is a separate, audited action —
/// distinct from issuing it, which already returned the plaintext once to its
/// caller. `access.code_viewed` requires a reason code (audit catalog), same
/// posture as any other look-behind-the-mask action.
export async function revealCode(
  actor: Actor,
  credentialId: string,
  reasonCode: string,
): Promise<RevealedCode> {
  const credential = await prisma.accessCredential.findUniqueOrThrow({ where: { id: credentialId } })
  requirePermission(actor, 'access:view_codes', credential.facilityId)

  const key = accessCodeEncryptionKey()
  const result: RevealedCode = !key
    ? { available: false, reason: 'No encryption key is configured for this environment.' }
    : decryptOrUnavailable(credential.valueRef, key)

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'access.code_viewed',
    entityType: 'AccessCredential',
    entityId: credentialId,
    facilityId: credential.facilityId,
    reasonCode,
  })

  return result
}

function decryptOrUnavailable(valueRef: string, key: Buffer): RevealedCode {
  try {
    return { available: true, code: decryptCode(valueRef, key) }
  } catch (err) {
    if (err instanceof CodeNotRevealableError) return { available: false, reason: err.message }
    throw err
  }
}

/// Exported for B-064's gate-hours propagation, which enqueues one command per
/// grant from outside this file. Everything else here calls it directly.
export async function enqueueCommand(
  input: {
    facilityId: string
    grantId?: string
    credentialId?: string
    type: GateCommandType
    idempotencyKey: string
    payload: Record<string, unknown>
  },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  // A duplicate key means the same effect was already asked for; the outbox
  // swallows it rather than the caller having to check first.
  //
  // B-158: nextAttemptAt is set here from the app clock rather than left to
  // the column's DB-side `now()` default. drainGateCommands compares
  // nextAttemptAt against a Node-side `new Date()` — if the row's timestamp
  // came from Postgres's clock instead, a command enqueued microseconds
  // before a drain can carry a timestamp the drain's cutoff hasn't reached
  // yet, and get silently passed over until the next cron tick.
  await client.gateCommand.createMany({
    data: [
      {
        facilityId: input.facilityId,
        grantId: input.grantId ?? null,
        credentialId: input.credentialId ?? null,
        type: input.type,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload as Prisma.InputJsonValue,
        nextAttemptAt: new Date(),
      },
    ],
    skipDuplicates: true,
  })
}

/// FR-3: retry with backoff, then dead-letter. Five attempts over roughly an
/// hour is long enough to ride out a controller reboot and short enough that a
/// genuinely broken site reaches a human the same morning.
const MAX_ATTEMPTS = 5

function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** attempts, 30 * 60_000)
}

export type DrainResult = {
  attempted: number
  succeeded: number
  failed: number
  deadLettered: number
  /// Handed to a person rather than a controller (US-6). Not a failure and not
  /// a success — the counter is separate so a manual site's drain does not read
  /// as either.
  manual: number
}

/// Sends queued commands to the controller.
///
/// Nothing here can fail a move-in: by the time a command is in this queue the
/// renter has already paid and been given a lease (B-026). A dead letter is a
/// staff alert, not a customer-facing error.
export async function drainGateCommands(
  now: Date = new Date(),
  facilityId?: string,
): Promise<DrainResult> {
  const due = await prisma.gateCommand.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      nextAttemptAt: { lte: now },
      ...(facilityId ? { facilityId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  const result: DrainResult = { attempted: 0, succeeded: 0, failed: 0, deadLettered: 0, manual: 0 }

  // PRD 03 US-6. A facility running the ManualAdapter has no controller to
  // talk to, so its commands become tasks instead of sends. Resolved once per
  // drain rather than per command: a drain covering fifty commands at one site
  // would otherwise ask the same question fifty times.
  const manualFacilities = new Set<string>()
  for (const facilityId of new Set(due.map((command) => command.facilityId))) {
    if (await usesManualAdapter(facilityId)) manualFacilities.add(facilityId)
  }

  for (const command of due) {
    result.attempted += 1

    if (manualFacilities.has(command.facilityId)) {
      await raiseManualTask({
        id: command.id,
        type: command.type,
        facilityId: command.facilityId,
        grantId: command.grantId,
        credentialId: command.credentialId,
        payload: (command.payload ?? {}) as Record<string, unknown>,
      })
      // Parked, not retried. `awaiting_manual` exists precisely so the backoff
      // loop leaves it alone — five retries against a human would make five
      // tasks — and so it is distinguishable from a command that failed.
      await prisma.gateCommand.update({
        where: { id: command.id },
        data: { status: 'awaiting_manual' },
      })
      result.manual += 1
      continue
    }

    const adapter = adapterFor(command.facilityId)
    const outcome = await adapter.send({
      type: command.type,
      facilityId: command.facilityId,
      grantId: command.grantId,
      credentialId: command.credentialId,
      payload: (command.payload ?? {}) as Record<string, unknown>,
    })

    if (outcome.ok) {
      await prisma.$transaction(async (tx) => {
        await tx.gateCommand.update({
          where: { id: command.id },
          data: { status: 'succeeded', completedAt: new Date(), attempts: command.attempts + 1 },
        })
        if (command.credentialId) {
          // updateMany, not update: a credential that has since been deleted
          // must not throw and wedge the queue behind it. The command still
          // succeeded — the controller took it.
          await tx.accessCredential.updateMany({
            where: { id: command.credentialId },
            data: { syncStatus: 'synced', lastSyncAt: new Date() },
          })
        }
      })
      result.succeeded += 1
      continue
    }

    const attempts = command.attempts + 1
    const giveUp = !outcome.retryable || attempts >= MAX_ATTEMPTS

    await prisma.$transaction(async (tx) => {
      await tx.gateCommand.update({
        where: { id: command.id },
        data: {
          status: giveUp ? 'dead_lettered' : 'failed',
          attempts,
          lastError: outcome.message,
          nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
          deadLetteredAt: giveUp ? new Date() : null,
        },
      })
      if (giveUp && command.credentialId) {
        await tx.accessCredential.updateMany({
          where: { id: command.credentialId },
          data: { syncStatus: 'failed' },
        })
      }
      if (giveUp) {
        // The staff alert FR-3 requires. Somebody has to key this in by hand,
        // and the tenant is already moved in and expecting a code.
        await emitEvent(
          {
            name: 'access.sync_failed',
            facilityId: command.facilityId,
            entityType: 'GateCommand',
            entityId: command.id,
            payload: { type: command.type, error: outcome.message, attempts },
          },
          tx,
        )
      }
    })

    if (giveUp) result.deadLettered += 1
    else result.failed += 1
  }

  return result
}
