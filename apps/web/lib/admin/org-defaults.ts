import { prisma, type OrgDefaultScope, type Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { effectiveByGroup } from '@storage/core/facility-settings'
import {
  compareFeeSchedule,
  compareLateFeeLadder,
  compareTimeline,
  type FeeDefault,
  type LateFeeDefault,
  type OverrideReport,
  type TimelineDefault,
} from '@storage/core/org'
import { can, requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import { saveTimeline } from './delinquency-timeline'

// PRD 02 US-4 (B-079). Org-level defaults, the push, and the override flags.
//
// Two different permission questions, asked separately and on purpose:
//
//   EDITING a default is portfolio-wide, so `org:defaults` is checked with a
//   null facilityId — which `can()` only satisfies from an all-facilities
//   assignment.
//
//   PUSHING to a facility is a facility settings change, so it is checked
//   against `facility:settings` AT that facility. A regional manager can
//   therefore push the agreed default down to their own sites and to no
//   others, which is the behaviour an operator expects and the one a single
//   org-wide check would have got wrong.

export type OrgDefaultRecord = {
  scope: OrgDefaultScope
  label: string
  payload: unknown
  updatedAt: Date
  updatedByName: string | null
}

export async function getOrgDefault(scope: OrgDefaultScope): Promise<OrgDefaultRecord | null> {
  const row = await prisma.orgDefault.findUnique({
    where: { scope },
    include: { updatedByStaff: { select: { firstName: true, lastName: true } } },
  })
  if (!row) return null

  return {
    scope: row.scope,
    label: row.label,
    payload: row.payload,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByStaff
      ? `${row.updatedByStaff.firstName} ${row.updatedByStaff.lastName}`.trim()
      : null,
  }
}

export async function saveOrgDefault(
  actor: Actor,
  input: { scope: OrgDefaultScope; label: string; payload: object },
): Promise<void> {
  requirePermission(actor, 'org:defaults', null)

  const staffId = actor.kind === 'staff' ? actor.staffUserId : null
  const before = await prisma.orgDefault.findUnique({ where: { scope: input.scope } })

  await prisma.orgDefault.upsert({
    where: { scope: input.scope },
    create: {
      scope: input.scope,
      label: input.label.trim() || input.scope,
      payload: input.payload as Prisma.InputJsonValue,
      updatedByStaffId: staffId,
    },
    update: {
      label: input.label.trim() || input.scope,
      payload: input.payload as Prisma.InputJsonValue,
      updatedByStaffId: staffId,
    },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'org_default.updated',
    entityType: 'OrgDefault',
    entityId: input.scope,
    // Saving the default changes nothing at any facility until it is pushed,
    // so the log has to carry the payload itself — otherwise "what did the
    // default say when we pushed it in March" has no answer anywhere.
    before: before ? { label: before.label, payload: before.payload } : undefined,
    after: { label: input.label, payload: input.payload },
  })
}

// --------------------------------------------------------------- comparing --

export type FacilityComparison = {
  facilityId: string
  facilityName: string
  report: OverrideReport
  /// False when the actor may look at this facility but not push to it.
  canPush: boolean
}

/// One row per facility the actor can see, saying whether it matches the
/// default and — when it does not — exactly what diverges.
export async function compareFacilities(
  actor: Actor,
  scope: OrgDefaultScope,
): Promise<FacilityComparison[]> {
  const record = await getOrgDefault(scope)
  if (!record) return []

  const facilities = await prisma.facility.findMany({
    where: facilityFilter(actor),
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  return Promise.all(
    facilities.map(async (facility) => ({
      facilityId: facility.id,
      facilityName: facility.name,
      report: await reportFor(scope, record.payload, facility.id),
      canPush: can(actor, 'facility:settings', facility.id),
    })),
  )
}

async function reportFor(
  scope: OrgDefaultScope,
  payload: unknown,
  facilityId: string,
): Promise<OverrideReport> {
  const now = new Date()

  if (scope === 'fee_schedule') {
    const rows = await prisma.feeSchedule.findMany({
      where: { facilityId },
      orderBy: { effectiveFrom: 'desc' },
    })
    // The same `effectiveByGroup` the facility settings screen uses, so the
    // comparison is against the values in force TODAY — not against a
    // future-dated row an operator has already queued, which would flag a
    // facility as overridden for a change nobody has felt yet.
    const current = [...effectiveByGroup(rows, now, (row) => row.feeType).values()]
    return compareFeeSchedule(feesOf(payload), current)
  }

  if (scope === 'late_fee_ladder') {
    const rows = await prisma.lateFeeRule.findMany({
      where: { facilityId },
      orderBy: { effectiveFrom: 'desc' },
    })
    const current = [...effectiveByGroup(rows, now, (row) => String(row.step)).values()]
    return compareLateFeeLadder(ladderOf(payload), current)
  }

  const active = await prisma.delinquencyTimeline.findFirst({
    where: { facilityId, active: true },
    select: { qualifyingAmount: true, steps: true },
  })
  return compareTimeline(timelineOf(payload), active ? {
    qualifyingAmount: active.qualifyingAmount,
    steps: (active.steps ?? []) as unknown[],
  } : null)
}

// ---------------------------------------------------------------- pushing ---

export type PushResult = {
  facilityId: string
  facilityName: string
  outcome: 'pushed' | 'already_matched' | 'forbidden' | 'invalid'
  detail?: string
}

/// Writes the default into each named facility's own tables.
///
/// Nothing here is a runtime fallback: after a push the facility owns ordinary
/// effective-dated rows, and every reader downstream — invoicing, the late-fee
/// job, the delinquency engine — keeps reading exactly one place and needs no
/// knowledge that org defaults exist.
///
/// A facility that already matches is skipped rather than written. An
/// effective-dated table is append-only, so pushing unconditionally would file
/// a fresh identical row at every facility every time somebody pressed the
/// button, and the fee history an auditor reads would fill with changes that
/// changed nothing.
export async function pushOrgDefault(
  actor: Actor,
  input: { scope: OrgDefaultScope; facilityIds: string[]; effectiveFrom: Date },
): Promise<PushResult[]> {
  requirePermission(actor, 'org:defaults', null)

  const record = await getOrgDefault(input.scope)
  if (!record) return []

  const facilities = await prisma.facility.findMany({
    where: { id: { in: input.facilityIds } },
    select: { id: true, name: true },
  })

  const results: PushResult[] = []

  for (const facility of facilities) {
    const base = { facilityId: facility.id, facilityName: facility.name }

    // Checked per facility, not once for the batch: the set of ids arrives from
    // a form, and a regional manager must not be able to reach a facility they
    // hold no assignment for by adding its id to the POST.
    if (!can(actor, 'facility:settings', facility.id)) {
      results.push({ ...base, outcome: 'forbidden' })
      continue
    }

    const report = await reportFor(input.scope, record.payload, facility.id)
    if (report.matches) {
      results.push({ ...base, outcome: 'already_matched' })
      continue
    }

    const outcome = await pushOne(actor, input.scope, record, facility.id, input.effectiveFrom)
    results.push({ ...base, ...outcome })
  }

  return results
}

async function pushOne(
  actor: Actor,
  scope: OrgDefaultScope,
  record: OrgDefaultRecord,
  facilityId: string,
  effectiveFrom: Date,
): Promise<{ outcome: PushResult['outcome']; detail?: string }> {
  if (scope === 'delinquency_timeline') {
    const timeline = timelineOf(record.payload)
    // Reuses the existing writer rather than inserting a row directly: it
    // validates every step against the notice templates that actually exist at
    // THIS facility, and a timeline naming a template nobody has written there
    // reads as "sends a notice" on every screen and sends nothing.
    const saved = await saveTimeline(actor, facilityId, {
      label: `${record.label} (org default)`,
      qualifyingAmount: timeline.qualifyingAmount as never,
      steps: timeline.steps as never,
    })
    if (!saved.ok) {
      return { outcome: 'invalid', detail: saved.problems.map((p) => p.problem).join('; ') }
    }
  } else if (scope === 'fee_schedule') {
    await prisma.feeSchedule.createMany({
      data: feesOf(record.payload).map((fee) => ({
        facilityId,
        feeType: fee.feeType as never,
        amountCents: fee.amountCents,
        effectiveFrom,
      })),
      // The table is uniquely keyed on (facility, feeType, effectiveFrom), so a
      // second push on the same day is a no-op rather than a duplicate-key
      // crash that abandons the rest of the batch half-applied.
      skipDuplicates: true,
    })
  } else {
    await prisma.lateFeeRule.createMany({
      data: ladderOf(record.payload).map((rule) => ({
        facilityId,
        step: rule.step,
        daysPastDue: rule.daysPastDue,
        amountCents: rule.amountCents,
        percentBasisPoints: rule.percentBasisPoints,
        basis: rule.basis as never,
        capCents: rule.capCents,
        effectiveFrom,
      })),
      skipDuplicates: true,
    })
  }

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'org_default.pushed',
    entityType: 'Facility',
    entityId: facilityId,
    facilityId,
    // Per facility, not one org-level row listing twelve ids: "what changed
    // here and who did it" is the question this log gets asked.
    context: { scope, label: record.label, effectiveFrom: effectiveFrom.toISOString() },
  })

  return { outcome: 'pushed' }
}

// ------------------------------------------------------ template overrides --

export type TemplateOverride = {
  facilityId: string
  facilityName: string
  /// Template keys this facility has its own version of.
  keys: string[]
}

/// Notice templates are the one scope with no push, and deliberately so.
/// `MessageTemplate` already resolves org-level (facilityId null) → facility
/// override at render time, so the org default is ALREADY live everywhere that
/// has not overridden it. Pushing would mean writing a per-facility copy of a
/// template the facility is already using, turning every site into an override
/// of the thing it was inheriting — the exact opposite of what US-4 wants.
///
/// What is genuinely missing for templates is the visibility half of US-4:
/// which facilities have diverged. That is this.
export async function templateOverrides(actor: Actor): Promise<TemplateOverride[]> {
  const facilities = await prisma.facility.findMany({
    where: facilityFilter(actor),
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  const overrides = await prisma.messageTemplate.findMany({
    where: { facilityId: { in: facilities.map((f) => f.id) }, active: true },
    select: { facilityId: true, key: true },
    distinct: ['facilityId', 'key'],
    orderBy: { key: 'asc' },
  })

  const byFacility = new Map<string, string[]>()
  for (const row of overrides) {
    if (!row.facilityId) continue
    byFacility.set(row.facilityId, [...(byFacility.get(row.facilityId) ?? []), row.key])
  }

  return facilities.map((facility) => ({
    facilityId: facility.id,
    facilityName: facility.name,
    keys: byFacility.get(facility.id) ?? [],
  }))
}

// ------------------------------------------------------------------ shapes --

// The payload is Json in the database, so it arrives as `unknown`. These narrow
// it once, here, rather than at each of the four call sites — and default to an
// empty set rather than throwing, so a malformed row renders a screen saying
// "nothing configured" instead of a 500 on the settings page.

function feesOf(payload: unknown): FeeDefault[] {
  const fees = (payload as { fees?: unknown })?.fees
  return Array.isArray(fees) ? (fees as FeeDefault[]) : []
}

function ladderOf(payload: unknown): LateFeeDefault[] {
  const ladder = (payload as { ladder?: unknown })?.ladder
  return Array.isArray(ladder) ? (ladder as LateFeeDefault[]) : []
}

function timelineOf(payload: unknown): TimelineDefault {
  const timeline = (payload as { timeline?: TimelineDefault })?.timeline
  return {
    qualifyingAmount: timeline?.qualifyingAmount ?? 'full_balance',
    steps: Array.isArray(timeline?.steps) ? timeline.steps : [],
  }
}

function facilityFilter(actor: Actor): { id?: { in: string[] } } {
  if (actor.kind !== 'staff') return { id: { in: [] } }
  // An all-facilities assignment carries a null facilityId; anything else
  // restricts to the ids it names.
  if (actor.assignments.some((a) => a.facilityId === null)) return {}
  return { id: { in: actor.assignments.map((a) => a.facilityId).filter((id): id is string => id !== null) } }
}
