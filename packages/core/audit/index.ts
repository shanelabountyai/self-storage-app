import { prisma } from '@storage/db'
import type { AuditLog, Prisma } from '@storage/db'
import { requiresReasonCode } from './actions.ts'
import { diffSnapshots, redact, type Json } from './redact.ts'

export * from './actions.ts'
export { diffSnapshots, redact, REDACTED, type Json } from './redact.ts'

/// Deliberately independent of the RBAC Actor type: packages/core must not
/// depend on apps/web. Callers map their actor to this shape.
export type AuditActor =
  | { type: 'staff'; staffUserId: string; label?: string }
  | { type: 'tenant'; tenantId: string; label?: string }
  | { type: 'system'; label: string }

export type RecordAuditInput = {
  actor: AuditActor
  action: string
  entityType: string
  entityId: string
  facilityId?: string | null
  /// Entity snapshots. Reduced to changed fields and redacted before storage.
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  reasonCode?: string | null
  /// Ties related entries together — one move-in, one billing run, one request.
  correlationId?: string | null
  /// Extra context merged into `after`, e.g. { amountCents, invoiceId }.
  context?: Record<string, unknown> | null
  occurredAt?: Date
  /// PRD 09 FR-24 (B-091). Set on every entry written DURING an impersonated
  /// session.
  ///
  /// The `actor` above stays the SUBJECT — they are who appeared to act — and
  /// this names the real human alongside. Passing the impersonator as the actor
  /// instead would make a log filtered to a tenant stop showing what happened
  /// to their account, which is half of what the log is for.
  impersonation?: { impersonatorStaffId: string; sessionId: string } | null
}

export class MissingReasonCodeError extends Error {
  // Explicit field, not a constructor-parameter-property: see the comment on
  // ForbiddenError in apps/web/lib/rbac/authorize.ts.
  readonly action: string

  constructor(action: string) {
    super(`Action "${action}" requires a reason code`)
    this.name = 'MissingReasonCodeError'
    this.action = action
  }
}

function actorFields(actor: AuditActor) {
  switch (actor.type) {
    case 'staff':
      return {
        actorType: 'staff' as const,
        actorStaffId: actor.staffUserId,
        actorLabel: actor.label ?? null,
      }
    case 'tenant':
      return {
        actorType: 'tenant' as const,
        actorStaffId: null,
        // The database requires a label for non-staff actors, so the tenant id
        // stands in when the caller supplies nothing friendlier.
        actorLabel: actor.label ?? `tenant:${actor.tenantId}`,
      }
    case 'system':
      return { actorType: 'system' as const, actorStaffId: null, actorLabel: actor.label }
  }
}

/// Writes one append-only entry. Throws rather than silently skipping when a
/// required reason code is absent — a missing audit trail on a privileged
/// action is worse than a failed request.
export async function recordAudit(
  input: RecordAuditInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<AuditLog> {
  if (requiresReasonCode(input.action) && !input.reasonCode?.trim()) {
    throw new MissingReasonCodeError(input.action)
  }

  const { before, after } = diffSnapshots(input.before, input.after)
  const context = input.context ? (redact(input.context) as { [key: string]: Json }) : null
  const hasBefore = Object.keys(before).length > 0
  const hasAfter = Object.keys(after).length > 0 || context !== null

  return client.auditLog.create({
    data: {
      ...actorFields(input.actor),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      facilityId: input.facilityId ?? null,
      before: hasBefore ? before : undefined,
      after: hasAfter ? { ...after, ...(context ?? {}) } : undefined,
      reasonCode: input.reasonCode?.trim() || null,
      correlationId: input.correlationId ?? null,
      impersonatorStaffId: input.impersonation?.impersonatorStaffId ?? null,
      impersonationSessionId: input.impersonation?.sessionId ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    },
  })
}

// ------------------------------------------------------------- querying ----

export type AuditQuery = {
  /// Restricts to these facilities. Callers must pass the actor's allowed set —
  /// this function does not resolve permissions itself.
  facilityIds?: string[] | null
  actorStaffId?: string
  /// FR-24's second question: everything one staff member did while wearing
  /// someone else's identity. Distinct from `actorStaffId`, which would return
  /// only what they did as themselves.
  impersonatorStaffId?: string
  impersonationSessionId?: string
  entityType?: string
  entityId?: string
  action?: string | string[]
  from?: Date
  to?: Date
  limit?: number
  cursor?: string
}

/// Filterable by actor, entity, action and date, per PRD 02 US-38.
export async function findAuditEntries(query: AuditQuery = {}): Promise<AuditLog[]> {
  const where: Prisma.AuditLogWhereInput = {}

  if (query.facilityIds) where.facilityId = { in: query.facilityIds }
  if (query.actorStaffId) where.actorStaffId = query.actorStaffId
  if (query.impersonatorStaffId) where.impersonatorStaffId = query.impersonatorStaffId
  if (query.impersonationSessionId) where.impersonationSessionId = query.impersonationSessionId
  if (query.entityType) where.entityType = query.entityType
  if (query.entityId) where.entityId = query.entityId
  if (query.action) {
    where.action = Array.isArray(query.action) ? { in: query.action } : query.action
  }
  if (query.from || query.to) {
    where.occurredAt = { ...(query.from && { gte: query.from }), ...(query.to && { lte: query.to }) }
  }

  return prisma.auditLog.findMany({
    where,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: Math.min(query.limit ?? 100, 1000),
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  })
}

const CSV_COLUMNS = [
  'occurredAt',
  'occurredAtLocal',
  'facilityId',
  'actorType',
  'actorStaffId',
  'actorLabel',
  'entityType',
  'entityId',
  'action',
  'reasonCode',
  'correlationId',
  'before',
  'after',
] as const

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = value instanceof Date ? value.toISOString() : String(value)
  // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${guarded.replace(/"/g, '""')}"`
}

/// US-38 requires CSV export matching the on-screen data. Timestamps are given
/// twice — UTC as stored, and facility-local for the reader.
export function toCsv(
  entries: readonly AuditLog[],
  facilityTimezones: Record<string, string> = {},
): string {
  const rows = entries.map((entry) => {
    const timezone = entry.facilityId ? facilityTimezones[entry.facilityId] : undefined
    const local = timezone
      ? entry.occurredAt.toLocaleString('en-US', { timeZone: timezone })
      : ''
    return CSV_COLUMNS.map((column) => {
      if (column === 'occurredAtLocal') return csvCell(local)
      const value = entry[column as keyof AuditLog]
      return csvCell(
        value !== null && typeof value === 'object' && !(value instanceof Date)
          ? JSON.stringify(value)
          : value,
      )
    }).join(',')
  })

  return [CSV_COLUMNS.join(','), ...rows].join('\n')
}
