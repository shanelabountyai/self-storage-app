import { prisma } from '@storage/db'
import type { ImpersonationEndReason, Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import type { Actor } from '@/lib/rbac/actor'
import { loadStaffActor } from '@/lib/rbac/actor'
import { ForbiddenError, type FacilityAccess } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { canImpersonate, type ImpersonationSubject } from './guard'

/// PRD 09 §5.1/§6.1 (B-091). Starting, ending and re-validating a support
/// session.
///
/// Nothing here makes a request RUN as the subject — that actor swap, the
/// service-layer write blocks and the banner are B-091 part 2, and they land
/// together on purpose so that no commit ever ships "a session can start"
/// before "writes are blocked and the banner shows".

/// FR-3. Thirty minutes, server-enforced.
///
/// **Deliberately a constant and not a column.** FR-3 also says "per-org
/// configurable, hard maximum 8 hours", and this repo's own rule is that a
/// column configuring behaviour ships with its control or does not ship — five
/// of them once shipped reachable only from a database client, and took two
/// clean-up passes to close. The safety-bearing half (a short,
/// server-enforced expiry) is here; the knob is
/// left for whoever builds the control, and a future config must clamp to the
/// 8-hour maximum FR-3 names.
export const IMPERSONATION_TTL_MINUTES = 30

/// SR-7. Reuses the session table itself as the counter rather than adding a
/// mechanism: "how many did this person start in the last hour" is one indexed
/// query against rows we are required to keep for seven years anyway.
export const IMPERSONATION_RATE_LIMIT = { max: 10, windowMinutes: 60 } as const

export type StartResult =
  | { ok: true; sessionId: string; expiresAt: Date }
  | { ok: false; refusal: string; message: string }

/// Everything the guard needs about a subject, read fresh. Returns null when
/// the subject does not exist at all.
export async function loadSubject(
  type: ImpersonationSubject['type'],
  id: string,
): Promise<ImpersonationSubject | null> {
  if (type === 'tenant') {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, deletedAt: true, leases: { select: { facilityId: true } } },
    })
    if (!tenant) return null
    return {
      type: 'tenant',
      id: tenant.id,
      active: tenant.deletedAt === null,
      // A tenant reaches the facilities they hold a lease at. Never `all`:
      // there is no such thing as a portfolio-wide tenant.
      scope: {
        all: false,
        facilityIds: [...new Set(tenant.leases.map((lease) => lease.facilityId))],
      },
      // FR-6: tenants are rank 0.
      ranks: [],
    }
  }

  const staff = await prisma.staffUser.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      assignments: { select: { facilityId: true, role: { select: { rank: true } } } },
    },
  })
  if (!staff) return null

  const scope: FacilityAccess = staff.assignments.some((a) => a.facilityId === null)
    ? { all: true }
    : {
        all: false,
        facilityIds: [
          ...new Set(
            staff.assignments
              .map((a) => a.facilityId)
              .filter((facilityId): facilityId is string => facilityId !== null),
          ),
        ],
      }

  return {
    type: 'staff',
    id: staff.id,
    active: staff.deletedAt === null && staff.status === 'active',
    scope,
    ranks: staff.assignments.map((a) => a.role.rank),
  }
}

function scopeSnapshot(actor: Actor): Prisma.InputJsonValue {
  if (actor.kind !== 'staff') return { all: false, facilityIds: [] }
  const all = actor.assignments.some((assignment) => assignment.facilityId === null)
  return all
    ? { all: true }
    : {
        all: false,
        facilityIds: [
          ...new Set(
            actor.assignments
              .map((assignment) => assignment.facilityId)
              .filter((id): id is string => id !== null),
          ),
        ],
      }
}

export async function startImpersonation(
  actor: Actor,
  input: {
    subjectType: ImpersonationSubject['type']
    subjectId: string
    reason: string
    ticketRef?: string | null
    ipAddress?: string | null
    alreadyImpersonating?: boolean
    now?: Date
  },
): Promise<StartResult> {
  // FR-2. Refused before anything is read, because a session that exists
  // without a stated why is the thing SR-6 exists to make impossible.
  const reason = input.reason.trim()
  if (!reason) {
    return { ok: false, refusal: 'no_reason', message: 'A reason is required to start a support session.' }
  }

  const subject = await loadSubject(input.subjectType, input.subjectId)
  if (!subject) {
    return { ok: false, refusal: 'no_subject', message: 'No such account.' }
  }

  const decision = canImpersonate(actor, subject, {
    alreadyImpersonating: input.alreadyImpersonating,
  })
  if (!decision.allowed) {
    return { ok: false, refusal: decision.refusal, message: decision.message }
  }
  // Narrowed by the guard, but the compiler cannot know that.
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff access required')

  const now = input.now ?? new Date()
  const started = await prisma.impersonationSession.count({
    where: {
      impersonatorStaffId: actor.staffUserId,
      startedAt: { gte: new Date(now.getTime() - IMPERSONATION_RATE_LIMIT.windowMinutes * 60_000) },
    },
  })
  if (started >= IMPERSONATION_RATE_LIMIT.max) {
    return {
      ok: false,
      refusal: 'throttled',
      message: `You have started ${started} support sessions in the last hour. Wait before starting another.`,
    }
  }

  // SR-6: if the row cannot be written the session does not start. One
  // transaction with the audit entry, so a session can never exist unlogged.
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.impersonationSession.create({
      data: {
        impersonatorStaffId: actor.staffUserId,
        subjectType: subject.type,
        subjectId: subject.id,
        facilityScopeSnapshot: scopeSnapshot(actor),
        reason,
        ticketRef: input.ticketRef?.trim() || null,
        expiresAt: new Date(now.getTime() + IMPERSONATION_TTL_MINUTES * 60_000),
        ipAddress: input.ipAddress ?? null,
      },
      select: { id: true, expiresAt: true },
    })

    // The actor is the impersonator, not the subject: starting a session is
    // something the staff member did as themselves. Only entries written
    // DURING the session carry the subject as actor (FR-24).
    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'impersonation.started',
        entityType: 'ImpersonationSession',
        entityId: created.id,
        reasonCode: reason,
        context: {
          subjectType: subject.type,
          subjectId: subject.id,
          ticketRef: input.ticketRef?.trim() || null,
          expiresAt: created.expiresAt.toISOString(),
        },
      },
      tx,
    )
    return created
  })

  return { ok: true, sessionId: session.id, expiresAt: session.expiresAt }
}

/// Ends a session. Idempotent: a session already ended is left exactly as it
/// was, so a forced end racing an expiry cannot rewrite why it stopped.
export async function endImpersonation(
  sessionId: string,
  endedBy: ImpersonationEndReason,
  options: { endedByStaffId?: string | null; now?: Date; client?: Prisma.TransactionClient } = {},
): Promise<boolean> {
  const db = options.client ?? prisma
  const now = options.now ?? new Date()

  // Conditional update rather than read-then-write: two requests noticing the
  // same expiry at the same moment must produce one end, not two.
  const { count } = await db.impersonationSession.updateMany({
    where: { id: sessionId, endedAt: null },
    data: { endedAt: now, endedBy, endedByStaffId: options.endedByStaffId ?? null },
  })
  if (count === 0) return false

  const session = await db.impersonationSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { impersonatorStaffId: true, subjectType: true, subjectId: true },
  })

  await recordAudit(
    {
      // Attributed to the impersonator even when expiry or a forced end stopped
      // it: the entry answers "whose session was this", and `endedBy` says who
      // or what stopped it.
      actor: { type: 'staff', staffUserId: session.impersonatorStaffId },
      action: 'impersonation.ended',
      entityType: 'ImpersonationSession',
      entityId: sessionId,
      // FR-25's "(recording `endedBy`)". The only honest reason for the three
      // ends no person triggered.
      reasonCode: endedBy,
      context: {
        subjectType: session.subjectType,
        subjectId: session.subjectId,
        endedByStaffId: options.endedByStaffId ?? null,
      },
    },
    db,
  )
  return true
}

export type ValidationResult =
  | { ok: true; session: { id: string; impersonatorStaffId: string; subjectType: ImpersonationSubject['type']; subjectId: string; expiresAt: Date } }
  | { ok: false; reason: ImpersonationEndReason | 'unknown'; message: string }

/// FR-9. Called on every request that carries an `impersonationSessionId`
/// claim, by B-091 part 2's request path.
///
/// Re-reads the row (a JWT cannot be revoked), re-loads BOTH parties' live
/// assignments, and re-runs the same guard that permitted the start. A subject
/// promoted mid-session, or an impersonator demoted, ends the session here
/// rather than silently conferring the new authority — which is why the failure
/// mode is `authority_changed` and not merely "denied".
export async function validateImpersonationSession(
  sessionId: string,
  options: { now?: Date } = {},
): Promise<ValidationResult> {
  const now = options.now ?? new Date()
  const session = await prisma.impersonationSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      impersonatorStaffId: true,
      subjectType: true,
      subjectId: true,
      expiresAt: true,
      endedAt: true,
      endedBy: true,
    },
  })
  if (!session) {
    return { ok: false, reason: 'unknown', message: 'This support session no longer exists.' }
  }
  if (session.endedAt) {
    return { ok: false, reason: session.endedBy ?? 'unknown', message: 'This support session has ended.' }
  }

  // Expiry is enforced here rather than by a sweep job, and the row is left
  // authoritative: `endedAt` is stamped the first time anybody notices. An
  // active-session list must therefore filter on `expiresAt > now` as well as
  // `endedAt IS NULL` — a session nobody has touched since it expired is
  // expired, not active. That is a query, not a column.
  if (session.expiresAt <= now) {
    await endImpersonation(session.id, 'expiry', { now })
    return { ok: false, reason: 'expiry', message: 'This support session has expired.' }
  }

  const [impersonator, subject] = await Promise.all([
    loadStaffActor(session.impersonatorStaffId),
    loadSubject(session.subjectType, session.subjectId),
  ])

  if (!impersonator || !subject || !canImpersonate(impersonator, subject).allowed) {
    await endImpersonation(session.id, 'authority_changed', { now })
    return {
      ok: false,
      reason: 'authority_changed',
      message:
        'Your access or this account’s roles changed, so the support session ended. Start a new one if you still need it.',
    }
  }

  return { ok: true, session }
}
