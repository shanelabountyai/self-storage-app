import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import {
  EXAMPLE_TIMELINE_LABEL,
  EXAMPLE_TIMELINE_STEPS,
  orderedSteps,
  validateTimeline,
  type QualifyingAmount,
  type TimelineProblem,
  type TimelineStep,
} from '@storage/core/delinquency'
import { requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.6 US-25/US-29 (B-056). Configuring a facility's delinquency
// timeline.
//
// The engine that runs it is B-057. This is the part an owner and their
// attorney look at, and it is versioned for one reason: a lease records which
// version governed it, so the configuration that was in force when a notice
// went out has to remain readable after somebody changes it.

export type TimelineVersion = {
  id: string
  version: number
  active: boolean
  label: string
  qualifyingAmount: QualifyingAmount
  steps: TimelineStep[]
  createdAt: Date
  createdByName: string | null
  /// How many leases were governed by this version. A version with leases
  /// against it is evidence, not history — it can never be deleted.
  leaseCount: number
}

export async function timelinesFor(actor: Actor, facilityId: string): Promise<TimelineVersion[]> {
  requirePermission(actor, 'facility:settings', facilityId)

  const rows = await prisma.delinquencyTimeline.findMany({
    where: { facilityId },
    orderBy: { version: 'desc' },
    include: {
      createdByStaff: { select: { firstName: true, lastName: true } },
      _count: { select: { leases: true } },
    },
  })

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    active: row.active,
    label: row.label,
    qualifyingAmount: row.qualifyingAmount as QualifyingAmount,
    steps: orderedSteps((row.steps ?? []) as unknown as TimelineStep[]),
    createdAt: row.createdAt,
    createdByName: row.createdByStaff
      ? `${row.createdByStaff.firstName} ${row.createdByStaff.lastName}`
      : null,
    leaseCount: row._count.leases,
  }))
}

/// The version in force. Null when a facility has never configured one — which
/// is the honest state, and is why B-057 must treat "no timeline" as "do
/// nothing" rather than falling back to the example.
///
/// Falling back would be the worst possible default: it would run a lien
/// pipeline nobody configured, from a table in a PRD, against a real tenant.
export async function activeTimeline(facilityId: string): Promise<TimelineVersion | null> {
  const row = await prisma.delinquencyTimeline.findFirst({
    where: { facilityId, active: true },
    orderBy: { version: 'desc' },
    include: {
      createdByStaff: { select: { firstName: true, lastName: true } },
      _count: { select: { leases: true } },
    },
  })
  if (!row) return null

  return {
    id: row.id,
    version: row.version,
    active: row.active,
    label: row.label,
    qualifyingAmount: row.qualifyingAmount as QualifyingAmount,
    steps: orderedSteps((row.steps ?? []) as unknown as TimelineStep[]),
    createdAt: row.createdAt,
    createdByName: row.createdByStaff
      ? `${row.createdByStaff.firstName} ${row.createdByStaff.lastName}`
      : null,
    leaseCount: row._count.leases,
  }
}

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; problems: TimelineProblem[] }

/// Saves a new version and makes it the active one.
///
/// Append-only. The previous version is deactivated, never edited: leases point
/// at the version that governed them, and rewriting one would change what a
/// lien file says happened.
export async function saveTimeline(
  actor: Actor,
  facilityId: string,
  input: { label: string; qualifyingAmount: QualifyingAmount; steps: TimelineStep[] },
): Promise<SaveResult> {
  requirePermission(actor, 'facility:settings', facilityId)

  const steps = orderedSteps(input.steps)
  // Validated against the templates that ACTUALLY exist for this facility, not
  // against a typed string. A step naming a template nobody has written reads
  // as "sends a notice" on every screen and sends nothing.
  const problems = validateTimeline(steps, await noticeTemplateKeys(facilityId))
  if (problems.length > 0) return { ok: false, problems }

  const latest = await prisma.delinquencyTimeline.findFirst({
    where: { facilityId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const version = (latest?.version ?? 0) + 1

  await prisma.$transaction(async (tx) => {
    await tx.delinquencyTimeline.updateMany({ where: { facilityId }, data: { active: false } })
    await tx.delinquencyTimeline.create({
      data: {
        facilityId,
        version,
        active: true,
        label: input.label.trim() || `Version ${version}`,
        qualifyingAmount: input.qualifyingAmount,
        steps: steps as unknown as object,
        createdByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
      },
    })

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'delinquency.timeline_changed',
        entityType: 'Facility',
        entityId: facilityId,
        facilityId,
        context: {
          version,
          label: input.label.trim(),
          qualifyingAmount: input.qualifyingAmount,
          stepDays: steps.map((step) => step.dayOffset),
        },
      },
      tx,
    )
  })

  return { ok: true, version }
}

/// US-29: "defaults are labeled 'example configuration'."
///
/// Offered as a STARTING POINT that an operator must save deliberately — never
/// seeded, never auto-activated. A facility with no timeline runs no pipeline,
/// which is the correct behaviour for a system that has not been told what the
/// law of its state requires.
export function exampleTimeline(): { label: string; steps: TimelineStep[] } {
  return { label: EXAMPLE_TIMELINE_LABEL, steps: [...EXAMPLE_TIMELINE_STEPS] }
}

/// Template keys this facility could actually send, for the step picker and for
/// validation. Org defaults plus the facility's own overrides — the same
/// precedence `effectiveTemplate` applies at send time, so the list offered
/// here is the list that would resolve.
export async function noticeTemplateKeys(facilityId: string): Promise<string[]> {
  const rows = await prisma.messageTemplate.findMany({
    where: { channel: 'email', active: true, OR: [{ facilityId }, { facilityId: null }] },
    select: { key: true },
    distinct: ['key'],
    orderBy: { key: 'asc' },
  })
  return rows.map((row) => row.key)
}
