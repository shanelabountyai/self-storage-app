import { prisma, type IncidentType } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { accessEventLog } from '@/lib/access/event-log'
import { sendBroadcast, type BroadcastResult } from '@/lib/admin/broadcast'
import { createTask } from '@/lib/admin/tasks'
import { documentsFor, logManualDocument } from '@/lib/documents/store'
import { ForbiddenError, requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 US-37 "an incident is one record" (B-424). A break-in is recorded
// once: what happened, when, which units, the police report, and the gate log
// for the window as it stood that day. Every affected tenant gets a task, and
// one message goes to all of them, so nobody is told a different story.

export const INCIDENT_TYPE_LABEL: Record<IncidentType, string> = {
  break_in: 'Break-in',
  vandalism: 'Vandalism',
  fire: 'Fire',
  water: 'Water or flood',
  other: 'Other',
}

export function isIncidentType(value: string): value is IncidentType {
  return value in INCIDENT_TYPE_LABEL
}

/// Facility time, on the list and on the record.
export function formatIncidentWhen(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(at)
}

/// One frozen gate event. Names are copied, not referenced: the excerpt has to
/// read the same after a tenant is renamed or a credential is deleted.
export type GateLogExcerptRow = {
  occurredAt: string
  result: 'granted' | 'denied'
  reason: string
  flags: string[]
  tenantName: string | null
  unitNumber: string | null
  entryMethod: 'pin' | 'mobile_key' | null
}

// ponytail: the excerpt keeps the newest 2,000 events in the window, which is
// days of traffic at one site. A longer window is refused rather than silently
// cut; page the excerpt into its own table if a real incident needs more.
export const GATE_LOG_EXCERPT_MAX = 2000

export type RecordIncidentInput = {
  facilityId: string
  type: IncidentType
  windowStart: Date
  /// Exclusive.
  windowEnd: Date
  description: string
  policeReportNumber?: string | null
  unitIds: readonly string[]
}

export type RecordIncidentResult =
  | { ok: true; id: string; tasks: number; gateEvents: number }
  | { ok: false; reason: 'bad_window' | 'missing_description' | 'no_units' | 'unknown_unit' | 'window_too_busy' }

/// The record holds tenant names and where they physically were, and raises
/// tenant tasks, so it takes both keys.
function requireIncidentAccess(actor: Actor, facilityId: string): asserts actor is Extract<Actor, { kind: 'staff' }> {
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff only', 'tenants:edit', facilityId)
  requirePermission(actor, 'tenants:edit', facilityId)
  requirePermission(actor, 'access:events', facilityId)
}

export async function recordIncident(actor: Actor, input: RecordIncidentInput): Promise<RecordIncidentResult> {
  requireIncidentAccess(actor, input.facilityId)
  const description = input.description.trim()
  if (!description) return { ok: false, reason: 'missing_description' }
  if (!(input.windowEnd.getTime() > input.windowStart.getTime())) return { ok: false, reason: 'bad_window' }
  const unitIds = [...new Set(input.unitIds)]
  if (unitIds.length === 0) return { ok: false, reason: 'no_units' }

  const units = await prisma.unit.findMany({
    where: { id: { in: unitIds }, facilityId: input.facilityId },
    select: {
      id: true,
      number: true,
      leases: {
        where: { status: { in: [...OCCUPYING_LEASE_STATUSES] } },
        select: { id: true, tenantId: true },
        take: 1,
      },
    },
    orderBy: { number: 'asc' },
  })
  if (units.length !== unitIds.length) return { ok: false, reason: 'unknown_unit' }

  // One more than the cap, so "exactly the cap" and "cut off" are told apart.
  const events = await accessEventLog(actor, {
    facilityId: input.facilityId,
    from: input.windowStart,
    to: input.windowEnd,
    limit: GATE_LOG_EXCERPT_MAX + 1,
  })
  if (events.length > GATE_LOG_EXCERPT_MAX) return { ok: false, reason: 'window_too_busy' }
  const gateLogExcerpt: GateLogExcerptRow[] = events
    .map((event) => ({
      occurredAt: event.occurredAt.toISOString(),
      result: event.result,
      reason: event.reason,
      flags: [...event.flags],
      tenantName: event.tenantName,
      unitNumber: event.unitNumber,
      entryMethod: event.entryMethod,
    }))
    .reverse()

  const label = INCIDENT_TYPE_LABEL[input.type]
  // A tenant holding two affected units gets one task naming both.
  const unitsByTenant = new Map<string, string[]>()
  for (const unit of units) {
    const tenantId = unit.leases[0]?.tenantId
    if (tenantId) unitsByTenant.set(tenantId, [...(unitsByTenant.get(tenantId) ?? []), unit.number])
  }

  return prisma.$transaction(async (tx) => {
    const incident = await tx.incident.create({
      data: {
        facilityId: input.facilityId,
        type: input.type,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        description,
        policeReportNumber: input.policeReportNumber?.trim() || null,
        gateLogExcerpt,
        recordedByStaffId: actor.staffUserId,
        units: { create: units.map((unit) => ({ unitId: unit.id, leaseId: unit.leases[0]?.id ?? null })) },
      },
    })

    let tasks = 0
    for (const [tenantId, numbers] of unitsByTenant) {
      // `createTask` keys on (type, tenant, business day): a second incident
      // the same day touching the same tenant adds to the open task's call
      // rather than raising another.
      const task = await createTask({
        facilityId: input.facilityId,
        type: 'incident_follow_up',
        entityType: 'Tenant',
        entityId: tenantId,
        priority: 'high',
        detail: `${label}, ${numbers.length === 1 ? 'unit' : 'units'} ${numbers.join(', ')}. Read the incident record under Incidents before you call, and say what it says.`,
        client: tx,
      })
      if (task.created) tasks += 1
    }

    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: input.facilityId,
        action: 'incident.recorded',
        entityType: 'Incident',
        entityId: incident.id,
        context: {
          type: input.type,
          windowStart: input.windowStart.toISOString(),
          windowEnd: input.windowEnd.toISOString(),
          unitIds: units.map((unit) => unit.id),
          gateEvents: gateLogExcerpt.length,
          tasks,
        },
      },
      tx,
    )

    return { ok: true as const, id: incident.id, tasks, gateEvents: gateLogExcerpt.length }
  })
}

async function incidentForActor(actor: Actor, incidentId: string) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { id: true, facilityId: true, notifiedAt: true, policeReportNumber: true },
  })
  if (!incident) return null
  requireIncidentAccess(actor, incident.facilityId)
  return incident
}

/// The one fact that arrives after the record does.
export async function setPoliceReportNumber(actor: Actor, incidentId: string, value: string): Promise<boolean> {
  const incident = await incidentForActor(actor, incidentId)
  if (!incident) return false
  const policeReportNumber = value.trim() || null
  await prisma.$transaction(async (tx) => {
    await tx.incident.update({ where: { id: incidentId }, data: { policeReportNumber } })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: incident.facilityId,
        action: 'incident.police_report_set',
        entityType: 'Incident',
        entityId: incidentId,
        before: { policeReportNumber: incident.policeReportNumber },
        after: { policeReportNumber },
      },
      tx,
    )
  })
  return true
}

/// A photo or a document on the incident, through the US-16 store. No bytes:
/// see the note at the bottom of `lib/documents/store.ts`.
export async function logIncidentDocument(
  actor: Actor,
  incidentId: string,
  input: { type: 'inspection_photo' | 'other'; title: string; note: string },
): Promise<boolean> {
  const incident = await incidentForActor(actor, incidentId)
  if (!incident) return false
  await logManualDocument({
    facilityId: incident.facilityId,
    type: input.type,
    subjectType: 'Incident',
    subjectId: incidentId,
    title: input.title.trim(),
    note: input.note,
    actor: toAuditActor(actor),
  })
  return true
}

/// Who the notify message would reach: units that had a tenant when the
/// incident was recorded.
async function notifiedUnitNumbers(incidentId: string): Promise<string[]> {
  const rows = await prisma.incidentUnit.findMany({
    where: { incidentId, leaseId: { not: null } },
    select: { unit: { select: { number: true } } },
  })
  return rows.map((row) => row.unit.number)
}

export type NotifyIncidentResult =
  | { ok: true; recipients: number; sent: number; failed: number }
  | { ok: false; reason: 'not_found' | 'already_notified' | 'no_tenants' }
  | { ok: false; reason: 'refused'; problem: Extract<BroadcastResult, { ok: false }>['problem'] }

/// The one message, through CN-21's operational template and send path.
///
/// ponytail: the audience is whoever holds those units NOW (`sendBroadcast`
/// filters by unit number). A unit that turned over between the incident and
/// the send reaches the new tenant; send by lease id if that ever matters.
export async function notifyIncident(
  actor: Actor,
  incidentId: string,
  message: { subject: string; message: string },
): Promise<NotifyIncidentResult> {
  const incident = await incidentForActor(actor, incidentId)
  if (!incident) return { ok: false, reason: 'not_found' }
  requirePermission(actor, 'comms:broadcast', incident.facilityId)
  if (incident.notifiedAt) return { ok: false, reason: 'already_notified' }
  const unitNumbers = await notifiedUnitNumbers(incidentId)
  if (unitNumbers.length === 0) return { ok: false, reason: 'no_tenants' }

  // Claim before sending: two presses cannot both pass the check above.
  const claimed = await prisma.incident.updateMany({
    where: { id: incidentId, notifiedAt: null },
    data: { notifiedAt: new Date() },
  })
  if (claimed.count === 0) return { ok: false, reason: 'already_notified' }

  const result = await sendBroadcast(actor, {
    facilityId: incident.facilityId,
    templateKey: 'broadcast.notice',
    subject: message.subject,
    message: message.message,
    filter: { unitNumbers },
  })
  if (!result.ok) {
    await prisma.incident.update({ where: { id: incidentId }, data: { notifiedAt: null } })
    return { ok: false, reason: 'refused', problem: result.problem }
  }
  return { ok: true, recipients: result.recipients, sent: result.sent, failed: result.failed }
}

export async function incidentNotifyAudience(actor: Actor, incidentId: string): Promise<string[] | null> {
  const incident = await incidentForActor(actor, incidentId)
  return incident ? notifiedUnitNumbers(incidentId) : null
}

export async function incidentsForFacility(actor: Actor, facilityId: string) {
  requireIncidentAccess(actor, facilityId)
  return prisma.incident.findMany({
    where: { facilityId },
    orderBy: { windowStart: 'desc' },
    take: 100,
    select: {
      id: true,
      type: true,
      windowStart: true,
      windowEnd: true,
      description: true,
      policeReportNumber: true,
      units: { select: { unit: { select: { number: true } } }, orderBy: { unit: { number: 'asc' } } },
    },
  })
}

export async function incidentDetail(actor: Actor, incidentId: string) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      facility: { select: { name: true, timezone: true } },
      recordedBy: { select: { firstName: true, lastName: true } },
      units: {
        orderBy: { unit: { number: 'asc' } },
        select: {
          unit: { select: { number: true } },
          lease: { select: { tenantId: true, tenant: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  })
  if (!incident) return null
  requireIncidentAccess(actor, incident.facilityId)
  return {
    ...incident,
    gateLogExcerpt: incident.gateLogExcerpt as GateLogExcerptRow[],
    documents: await documentsFor('Incident', incidentId),
  }
}
