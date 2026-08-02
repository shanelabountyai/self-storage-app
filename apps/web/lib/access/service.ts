import { randomBytes, randomInt } from 'node:crypto'
import { type Prisma, prisma } from '@storage/db'
import { canTransition, type GrantCause, type GrantState } from '@storage/core/access'
import { emitEvent } from '@storage/core/events'
import { adapterFor } from './adapter'

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

/// What we store instead of the code.
///
/// SR-2 makes viewing the real code a separate, audited permission, so the
/// credential row holds a reference and never the digits. Until a secret store
/// exists (B-028), the reference is all there is — which means the plaintext
/// code exists only in the moment it is generated and in whatever we send to
/// the controller.
function credentialRef(): string {
  // randomBytes rather than randomInt: `randomInt` caps its range at 2^48, and
  // a reference wants more entropy than that without needing to be a number.
  return `pin:${randomBytes(16).toString('hex')}`
}

export type EnsureGrantResult = {
  grantId: string
  state: GrantState
  created: boolean
}

/// One grant per tenant × facility (FR-1). A tenant with two units at one site
/// still holds one grant; the same tenant at two sites holds two.
///
/// B-029 widens this to one grant per *credential holder* — the tenant is one
/// holder and each authorized person on their lease is another. The unique
/// constraint is on (facilityId, tenantId) today, which is exactly that shape
/// with a single holder.
export async function ensureGrant(
  facilityId: string,
  tenantId: string,
  cause: GrantCause,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<EnsureGrantResult> {
  const existing = await client.accessGrant.findUnique({
    where: { facilityId_tenantId: { facilityId, tenantId } },
  })
  if (existing) {
    return { grantId: existing.id, state: existing.state as GrantState, created: false }
  }

  const grant = await client.accessGrant.create({
    data: { facilityId, tenantId, state: 'pending', stateCause: cause },
  })
  return { grantId: grant.id, state: 'pending', created: true }
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
      name: to === 'active' ? 'access.granted' : to === 'suspended' ? 'access.suspended' : 'access.revoked',
      facilityId: grant.facilityId,
      entityType: 'AccessGrant',
      entityId: grantId,
      payload: { from, to, cause },
    },
    client,
  )

  return { ok: true, state: to, changed: true }
}

export type IssuedCredential = { credentialId: string; code: string }

/// Issues a gate code for a grant and queues it for the controller.
///
/// Returns the plaintext code exactly once, to its caller. It is never stored
/// and never logged — the credential row holds a reference (SR-2), so this
/// return value is the only chance to deliver it to the renter.
export async function issueCredential(
  grantId: string,
  leaseId: string | null,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<IssuedCredential> {
  const grant = await client.accessGrant.findUniqueOrThrow({ where: { id: grantId } })
  const code = generateCode()

  const credential = await client.accessCredential.create({
    data: {
      facilityId: grant.facilityId,
      grantId,
      leaseId,
      type: 'pin',
      valueRef: credentialRef(),
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
      // The code goes to the controller and nowhere else. It is not written to
      // the credential row and must not reach a log line.
      payload: { code },
    },
    client,
  )

  return { credentialId: credential.id, code }
}

async function enqueueCommand(
  input: {
    facilityId: string
    grantId?: string
    credentialId?: string
    type: 'grant_access' | 'revoke_access' | 'suspend_access' | 'resume_access' | 'set_credential'
    idempotencyKey: string
    payload: Record<string, unknown>
  },
  client: Prisma.TransactionClient | typeof prisma,
): Promise<void> {
  // A duplicate key means the same effect was already asked for; the outbox
  // swallows it rather than the caller having to check first.
  await client.gateCommand.createMany({
    data: [
      {
        facilityId: input.facilityId,
        grantId: input.grantId ?? null,
        credentialId: input.credentialId ?? null,
        type: input.type,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload as Prisma.InputJsonValue,
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

export type DrainResult = { attempted: number; succeeded: number; failed: number; deadLettered: number }

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

  const result: DrainResult = { attempted: 0, succeeded: 0, failed: 0, deadLettered: 0 }

  for (const command of due) {
    result.attempted += 1
    const adapter = adapterFor(command.facilityId)
    const outcome = await adapter.send({
      type: command.type,
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
