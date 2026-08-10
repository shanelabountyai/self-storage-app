import { prisma, type NoticeType } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import {
  EXAMPLE_TEMPLATE_LABEL,
  EXAMPLE_TEMPLATES,
  validateNoticeTemplate,
  type LienNoticeType,
  type NoticeTemplateProblem,
} from '@storage/core/notices'
import { requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.6 US-27 (B-061). The per-facility notice templates an operator (and
// their attorney) edits.
//
// A control in the same item as the column that configures behaviour — the rule
// this codebase learned the hard way. A notice template reachable only from a
// database client would mean every facility mails whatever draft text shipped,
// which for a legal notice is the worst version of that mistake.
//
// Versioned, never edited in place: a generated `Notice` records which version
// rendered it, and rewriting v1 would change what a lien file says was sent.

export type NoticeTemplateVersion = {
  id: string
  type: NoticeType
  version: number
  active: boolean
  title: string
  body: string
  /// null = the org-wide default, inherited by every facility without its own.
  facilityId: string | null
  createdAt: Date
  createdByName: string | null
  /// How many notices this version generated. A version with notices against it
  /// is evidence and can never be deleted.
  noticeCount: number
}

export async function noticeTemplatesFor(
  actor: Actor,
  facilityId: string,
): Promise<NoticeTemplateVersion[]> {
  requirePermission(actor, 'facility:settings', facilityId)

  const rows = await prisma.noticeTemplate.findMany({
    where: { OR: [{ facilityId }, { facilityId: null }] },
    orderBy: [{ type: 'asc' }, { version: 'desc' }],
    include: { _count: { select: { notices: true } } },
  })

  const staffIds = [...new Set(rows.map((row) => row.createdByStaffId).filter((id): id is string => !!id))]
  const staff = staffIds.length
    ? await prisma.staffUser.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : []
  const nameById = new Map(staff.map((one) => [one.id, `${one.firstName} ${one.lastName}`]))

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    version: row.version,
    active: row.active,
    title: row.title,
    body: row.body,
    facilityId: row.facilityId,
    createdAt: row.createdAt,
    createdByName: row.createdByStaffId ? (nameById.get(row.createdByStaffId) ?? null) : null,
    noticeCount: row._count.notices,
  }))
}

export type SaveTemplateResult =
  | { ok: true; version: number }
  | { ok: false; problems: NoticeTemplateProblem[] }

/// Saves a new facility-scoped version and makes it the active one.
///
/// Always facility-scoped: an operator editing their own notice text must never
/// be able to rewrite the org default that every other facility inherits.
export async function saveNoticeTemplate(
  actor: Actor,
  facilityId: string,
  input: { type: LienNoticeType; title: string; body: string },
): Promise<SaveTemplateResult> {
  requirePermission(actor, 'facility:settings', facilityId)

  const problems = validateNoticeTemplate(input.body)
  if (!input.title.trim()) {
    problems.push({ field: 'title', problem: 'A notice needs a title — it appears on the document.' })
  }
  if (problems.length > 0) return { ok: false, problems }

  const latest = await prisma.noticeTemplate.findFirst({
    where: { type: input.type, facilityId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const version = (latest?.version ?? 0) + 1

  await prisma.$transaction(async (tx) => {
    await tx.noticeTemplate.updateMany({
      where: { type: input.type, facilityId },
      data: { active: false },
    })
    await tx.noticeTemplate.create({
      data: {
        type: input.type,
        facilityId,
        version,
        active: true,
        title: input.title.trim(),
        body: input.body,
        createdByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
      },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId,
        action: 'notice_template.published',
        entityType: 'NoticeTemplate',
        entityId: facilityId,
        context: { noticeType: input.type, version, title: input.title.trim() },
      },
      tx,
    )
  })

  return { ok: true, version }
}

/// The draft starting point, for the "start from the example" button.
///
/// Offered, never seeded and never auto-activated — the same posture B-056 took
/// for the timeline, and for a stronger reason: this is the document itself.
/// A facility with no template generates no notice, which is the correct
/// behaviour for a system that has not been told what its state requires.
export function exampleNoticeTemplate(type: LienNoticeType): { title: string; body: string } {
  const example = EXAMPLE_TEMPLATES[type]
  return { title: `${example.title} — ${EXAMPLE_TEMPLATE_LABEL}`, body: example.body }
}
