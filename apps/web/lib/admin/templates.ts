import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import {
  availableFieldsFor,
  checkPublishable,
  sampleContextFor,
  type MergeFieldSpec,
} from '@storage/core/comms'
import { COMMS_RULES, type CommsRuleSeed } from '@storage/db/comms-catalog'
import { renderEmail, RenderError } from '@/lib/comms/render'
import { commsEnabled, fromAddress, selectProvider, withPostalFooter } from '@/lib/comms/provider'
import { requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 05 CN-16 (B-053). Editing templates without a deploy.
//
// Templates are append-only like every other versioned thing here (FR-9, and
// the same discipline as tax components and late-fee steps): saving does not
// edit a row, it inserts the next version and deactivates the previous one.
// `Message` records the version it sent, so a message from last Tuesday can
// still be shown exactly as it went out even after three edits — which is what
// makes the send log evidence rather than a guess.

/// The event a template key is wired to, via the notification rules.
///
/// A template with no rule pointing at it has no event, and therefore no field
/// schema — the editor says so rather than offering every field in the system,
/// because guessing here is how a template gets published referencing a field
/// its event never supplies.
export function eventForTemplateKey(key: string): string | null {
  return COMMS_RULES.find((rule: CommsRuleSeed) => rule.templateKey === key)?.event ?? null
}

export type TemplateSummary = {
  key: string
  event: string | null
  classification: string
  version: number
  subject: string | null
  bodyText: string
  requiredMergeFields: string[]
  facilityId: string | null
  /// True when this row is a per-facility override rather than the org default.
  isOverride: boolean
  updatedAt: Date
}

/// Every template a facility effectively uses: its own override where one
/// exists, the org default otherwise.
export async function templatesFor(actor: Actor, facilityId: string): Promise<TemplateSummary[]> {
  requirePermission(actor, 'facility:settings', facilityId)

  const rows = await prisma.messageTemplate.findMany({
    where: { channel: 'email', active: true, OR: [{ facilityId }, { facilityId: null }] },
    orderBy: [{ key: 'asc' }, { version: 'desc' }],
  })

  const byKey = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const current = byKey.get(row.key)
    // A facility override beats the org default; within a scope, the highest
    // active version wins — the same precedence `effectiveTemplate` applies at
    // send time, so the screen shows what would actually go out.
    if (!current || (row.facilityId && !current.facilityId)) byKey.set(row.key, row)
  }

  return [...byKey.values()]
    .map((row) => ({
      key: row.key,
      event: eventForTemplateKey(row.key),
      classification: row.classification,
      version: row.version,
      subject: row.subject,
      bodyText: row.bodyText,
      requiredMergeFields: row.requiredMergeFields,
      facilityId: row.facilityId,
      isOverride: row.facilityId !== null,
      updatedAt: row.createdAt,
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

export function fieldsForTemplate(key: string): MergeFieldSpec[] {
  const event = eventForTemplateKey(key)
  return event ? availableFieldsFor(event) : []
}

export type PreviewResult =
  | { ok: true; subject: string; text: string; from: string; replyTo: string | null }
  | { ok: false; problem: string; missing: string[] }

/// CN-16's "preview with sample data".
///
/// Rendered through the SAME `renderEmail` a real send uses, against the sample
/// context — so anything that would fail at 2am fails here instead, in front of
/// the person who can fix it. A preview that used a lenient renderer would be
/// worse than none: it would say the template is fine when it is not.
export async function previewTemplate(
  actor: Actor,
  facilityId: string,
  draft: { key: string; subject: string; bodyText: string; requiredMergeFields: string[] },
): Promise<PreviewResult> {
  requirePermission(actor, 'facility:settings', facilityId)

  const event = eventForTemplateKey(draft.key)
  if (!event) return { ok: false, problem: 'This template is not wired to any event yet.', missing: [] }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { name: true, emailFromName: true, emailReplyTo: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true },
  })
  const address = [facility.addressLine1, facility.addressLine2, facility.city, `${facility.state} ${facility.postalCode}`]
    .filter(Boolean)
    .join(', ')

  try {
    const rendered = renderEmail(
      { subject: draft.subject, bodyHtml: null, bodyText: draft.bodyText, requiredMergeFields: draft.requiredMergeFields },
      sampleContextFor(event),
    )
    return {
      ok: true,
      subject: rendered.subject,
      // The footer is shown because it is part of what the tenant receives —
      // a preview that omitted it would understate the message.
      text: withPostalFooter(rendered.text, { name: facility.name, address }),
      from: fromAddress(facility.emailFromName ?? facility.name),
      replyTo: facility.emailReplyTo,
    }
  } catch (error) {
    if (error instanceof RenderError) {
      return {
        ok: false,
        problem: 'This template references fields that have no value in the preview.',
        missing: error.missing,
      }
    }
    throw error
  }
}

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; problem: 'unknown_fields' | 'no_event' | 'empty'; unknown?: string[] }

/// Saves a new version. Append-only: the previous version is deactivated, never
/// edited or deleted.
///
/// `facilityId` set writes a per-facility override; null edits the org default.
export async function saveTemplateVersion(
  actor: Actor,
  facilityId: string,
  draft: {
    key: string
    subject: string
    bodyText: string
    requiredMergeFields: string[]
    scope: 'facility' | 'org'
  },
): Promise<SaveResult> {
  requirePermission(actor, 'facility:settings', facilityId)

  if (!draft.bodyText.trim()) return { ok: false, problem: 'empty' }
  const event = eventForTemplateKey(draft.key)
  if (!event) return { ok: false, problem: 'no_event' }

  // CN-16's publish gate. Blocks rather than warns: a template referencing a
  // field its event cannot supply fails at SEND time, inside a job, hours
  // later, with the tenant simply not hearing from us.
  const check = checkPublishable({
    event,
    subject: draft.subject,
    bodyText: draft.bodyText,
    requiredMergeFields: draft.requiredMergeFields,
  })
  if (!check.ok) return { ok: false, problem: 'unknown_fields', unknown: check.unknown }

  const scopeId = draft.scope === 'facility' ? facilityId : null
  const existing = await prisma.messageTemplate.findFirst({
    where: { key: draft.key, channel: 'email', facilityId: scopeId },
    orderBy: { version: 'desc' },
  })
  const base = existing ?? (await prisma.messageTemplate.findFirstOrThrow({
    where: { key: draft.key, channel: 'email', facilityId: null },
    orderBy: { version: 'desc' },
  }))
  const version = (existing?.version ?? 0) + 1

  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.messageTemplate.updateMany({
        where: { key: draft.key, channel: 'email', facilityId: scopeId },
        data: { active: false },
      })
    }
    await tx.messageTemplate.create({
      data: {
        key: draft.key,
        channel: 'email',
        classification: base.classification,
        facilityId: scopeId,
        version,
        active: true,
        subject: draft.subject,
        bodyHtml: null,
        bodyText: draft.bodyText,
        requiredMergeFields: draft.requiredMergeFields,
      },
    })

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'template.published',
        entityType: 'MessageTemplate',
        entityId: draft.key,
        facilityId,
        context: {
          key: draft.key,
          version,
          scope: draft.scope,
          undeclaredFields: check.undeclared,
        },
      },
      tx,
    )
  })

  return { ok: true, version }
}

export type TestSendResult =
  | { ok: true; to: string }
  | { ok: false; problem: string; missing?: string[] }

/// CN-16's "test-send to self".
///
/// Deliberately **to self only** — the actor's own signed-in address, never a
/// field on the form. A test-send that took an arbitrary address is an open
/// relay wearing an admin screen: anyone with settings access could mail
/// anyone, from the facility's authenticated domain, with content they wrote.
///
/// Goes through the real provider selection, so the sandbox rules and the kill
/// switch apply exactly as they do to a tenant send. With no Resend key it
/// lands in the log-only provider, which is the honest local behaviour.
export async function testSendTemplate(
  actor: Actor,
  facilityId: string,
  draft: { key: string; subject: string; bodyText: string; requiredMergeFields: string[] },
): Promise<TestSendResult> {
  requirePermission(actor, 'facility:settings', facilityId)
  if (actor.kind !== 'staff') return { ok: false, problem: 'Staff only.' }

  const staff = await prisma.staffUser.findUnique({
    where: { id: actor.staffUserId },
    select: { email: true },
  })
  if (!staff?.email) return { ok: false, problem: 'Your account has no email address to send to.' }

  const preview = await previewTemplate(actor, facilityId, draft)
  if (!preview.ok) return { ok: false, problem: preview.problem, missing: preview.missing }

  if (!commsEnabled()) {
    return { ok: false, problem: 'Outbound mail is paused by the kill switch.' }
  }

  const provider = selectProvider()
  const result = await provider.sendEmail({
    to: staff.email,
    from: preview.from,
    replyTo: preview.replyTo,
    subject: `[TEST] ${preview.subject}`,
    html: `<p>${preview.text.replace(/\n/g, '<br>')}</p>`,
    text: preview.text,
    // Distinct per attempt: a test-send is meant to be repeatable, so it must
    // not be deduplicated by the provider the way a tenant send is.
    idempotencyKey: `test:${draft.key}:${actor.staffUserId}:${Date.now()}`,
  })

  return result.ok
    ? { ok: true, to: staff.email }
    : { ok: false, problem: result.message ?? 'The provider refused the test send.' }
}
