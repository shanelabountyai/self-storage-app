import { createHash } from 'node:crypto'
import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { BROADCAST_KEY_PREFIX, isBroadcastTemplateKey } from '@storage/core/comms'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { renderEmail, RenderError } from '@/lib/comms/render'
import { commsEnabled } from '@/lib/comms/provider'
import { sendDirectEmail } from '@/lib/comms/service'
import { inParallel } from '@/lib/jobs/queue'
import { requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 05 CN-21 (B-090 part 4). "Send a one-off manual message (template-based,
// not freeform) to a tenant or a filtered set, respecting consent and quiet
// hours, logged like any automated send."
//
// ── What this file does and does not own ────────────────────────────────────
//
// It owns the AUDIENCE and the ACT. It owns none of the send rules: consent,
// suppression, quiet hours, the marketing daily cap, the postal footer, the
// unsubscribe link and the `Message` log are all `sendDirectEmail`'s, and this
// item moved the marketing half of that list INTO it rather than composing any
// of it here. A broadcast that got its own copy of those rules would be the
// one send path in the product that could drift away from the others, and it
// is the send path with the largest blast radius.
//
// "Template-based, not freeform" is honoured by the two seeded `broadcast.*`
// templates: the greeting, the sign-off and the facility's identity are the
// template's, editable once under CN-16, and the sender supplies two merge
// fields. A subject and a paragraph is the smallest thing that can express
// "power outage today" — PRD 05's own example — and anything smaller would
// make the feature unusable rather than safer.

/// The most tenants one broadcast may reach.
//
// ponytail: sends inline in the request rather than through a job queue,
// bounded by this cap. 2,000 recipients at a concurrency of 8 is roughly a
// minute against `maxDuration = 300`, and PRD 00 sizes this product at 2–10
// facilities, so the cap is headroom rather than a limit an operator meets.
// Upgrade path when a portfolio outgrows it: persist the audience and drain it
// from the hourly job registry, which is where `sendDueReports` already lives.
export const BROADCAST_MAX_RECIPIENTS = 2000

/// How many sends are in flight at once. The local convention caps the
/// connection pool at 10 per project (`~/.claude/CLAUDE.md`) and each send
/// makes several round trips, so 8 leaves room for the page's own queries.
const SEND_CONCURRENCY = 8

export type BroadcastFilter = {
  /// `Unit.building`, exactly as it is stored. Null/empty means every building.
  building?: string | null
  /// Specific unit numbers, which is how CN-21's "to a tenant" is expressed:
  /// staff know the unit, not the tenant id.
  unitNumbers?: readonly string[]
}

export type BroadcastRecipient = {
  tenantId: string
  email: string
  firstName: string
  lastName: string
  /// Every unit this tenant holds that the filter matched. Shown on the review
  /// step so "143 tenants" can be checked against the property.
  unitNumbers: string[]
}

/// Parses the comma/space-separated unit list an operator types.
export function parseUnitNumbers(raw: string): string[] {
  return [...new Set(raw.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean))]
}

/// The buildings this facility actually has, for the picker. `null` buildings
/// (a single-building site) are dropped rather than offered as an option.
export async function broadcastBuildings(actor: Actor, facilityId: string): Promise<string[]> {
  requirePermission(actor, 'comms:broadcast', facilityId)
  const rows = await prisma.unit.findMany({
    where: { facilityId, building: { not: null } },
    distinct: ['building'],
    select: { building: true },
    orderBy: { building: 'asc' },
  })
  return rows.map((row) => row.building).filter((building): building is string => building !== null)
}

/// Who the filter reaches, deduplicated by tenant.
///
/// Scoped to `OCCUPYING_LEASE_STATUSES` — a current tenant, including one whose
/// lease is `pending` (signed, not yet moved in: they still need to know the
/// gate is being replaced on Thursday) and one in the lien pipeline. A former
/// tenant is not a recipient: D-30 already took the position that a lease that
/// has ended stops being a channel.
///
/// One tenant with three units is ONE recipient. The dedupe is the point of
/// returning tenants rather than leases: a multi-unit renter getting three
/// copies of the same outage notice is how a broadcast teaches people to
/// filter the sender.
export async function broadcastAudience(
  actor: Actor,
  facilityId: string,
  filter: BroadcastFilter,
): Promise<BroadcastRecipient[]> {
  requirePermission(actor, 'comms:broadcast', facilityId)

  const unitNumbers = [...(filter.unitNumbers ?? [])]
  const building = filter.building?.trim() || null
  // One `unit` key, not two — a second would overwrite the first silently and
  // the building filter would simply stop applying.
  const unit = {
    ...(building ? { building } : {}),
    ...(unitNumbers.length > 0 ? { number: { in: unitNumbers } } : {}),
  }

  const leases = await prisma.lease.findMany({
    where: {
      facilityId,
      status: { in: [...OCCUPYING_LEASE_STATUSES] },
      ...(Object.keys(unit).length > 0 ? { unit } : {}),
    },
    select: {
      unit: { select: { number: true } },
      tenant: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
    orderBy: { unit: { number: 'asc' } },
  })

  const byTenant = new Map<string, BroadcastRecipient>()
  for (const lease of leases) {
    const existing = byTenant.get(lease.tenant.id)
    if (existing) {
      existing.unitNumbers.push(lease.unit.number)
      continue
    }
    byTenant.set(lease.tenant.id, {
      tenantId: lease.tenant.id,
      email: lease.tenant.email,
      firstName: lease.tenant.firstName,
      lastName: lease.tenant.lastName,
      unitNumbers: [lease.unit.number],
    })
  }
  return [...byTenant.values()]
}

export type BroadcastInput = {
  facilityId: string
  templateKey: string
  subject: string
  message: string
  filter: BroadcastFilter
}

export type BroadcastResult =
  | { ok: false; problem: 'no_template' | 'not_broadcast' | 'empty' | 'too_many' | 'no_audience' | 'comms_off'; detail?: string }
  | { ok: false; problem: 'render'; detail: string; missing: string[] }
  | {
      ok: true
      broadcastId: string
      recipients: number
      /// Counted from the `Message` rows this broadcast wrote, not from what
      /// the send loop believed it did — the log is the evidence, so the
      /// summary an operator reads had better be the same thing.
      sent: number
      suppressed: number
      cancelled: number
      failed: number
    }

/// The identity of one broadcast, and therefore its de-duplication.
///
/// Derived rather than random so a double-submitted form — the reflex when a
/// send takes twenty seconds and the page has not moved — is the SAME
/// broadcast, and `sendDirectEmail`'s unique idempotency key refuses every
/// recipient a second time. Scoped to the UTC day, so re-sending identical
/// wording to the same audience tomorrow is allowed and doing it twice within
/// the hour is not; wording it differently is always allowed, because the text
/// is part of the key.
function broadcastIdFor(actor: Actor, input: BroadcastInput): string {
  const parts = [
    actor.kind === 'staff' ? actor.staffUserId : actor.kind,
    input.facilityId,
    input.templateKey,
    input.filter.building ?? '',
    [...(input.filter.unitNumbers ?? [])].sort().join(','),
    input.subject,
    input.message,
    new Date().toISOString().slice(0, 10),
  ]
  return createHash('sha256').update(parts.join(' ')).digest('hex').slice(0, 32)
}

function contextFor(
  recipient: BroadcastRecipient,
  facility: { name: string; phone: string | null; addressLine1: string; addressLine2: string | null; city: string; state: string; postalCode: string },
  input: { subject: string; message: string },
  portalUrl: string,
): Record<string, string> {
  const street = facility.addressLine2
    ? `${facility.addressLine1}, ${facility.addressLine2}`
    : facility.addressLine1
  return {
    'tenant.first_name': recipient.firstName,
    'tenant.last_name': recipient.lastName,
    'facility.name': facility.name,
    'facility.phone': facility.phone ?? '',
    'facility.address': `${street}, ${facility.city}, ${facility.state} ${facility.postalCode}`,
    'links.portal': portalUrl,
    'broadcast.subject': input.subject,
    'broadcast.message': input.message,
  }
}

const FACILITY_FIELDS = {
  name: true,
  emailFromName: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
} as const

/// Same origin the comms service's own `links.portal` uses. Duplicated as one
/// line rather than exported from there: two callers, one env var, and the
/// alternative widens a module that is already the largest in the app.
function portalUrl(): string {
  return `${(process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/login`
}

/// Renders what ONE named recipient would receive. The review step's preview.
///
/// Deliberately a real recipient rather than `sampleContextFor` — the template
/// editor's preview answers "does this template work", and this one answers
/// "does this send work", which is a different question with a different way
/// of failing: a facility with no phone number and a template an operator has
/// edited to reference `{{facility.phone}}` renders here and only here.
export async function previewBroadcast(
  actor: Actor,
  input: BroadcastInput,
  recipient: BroadcastRecipient,
): Promise<
  { ok: true; subject: string; text: string } | { ok: false; problem: string; missing: string[] }
> {
  requirePermission(actor, 'comms:broadcast', input.facilityId)

  const template = await effectiveBroadcastTemplate(input.templateKey, input.facilityId)
  if (!template) return { ok: false, problem: 'That announcement template is not published.', missing: [] }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: input.facilityId },
    select: FACILITY_FIELDS,
  })

  try {
    const rendered = renderEmail(template, contextFor(recipient, facility, input, portalUrl()))
    return { ok: true, subject: rendered.subject, text: rendered.text }
  } catch (error) {
    if (error instanceof RenderError) {
      return {
        ok: false,
        problem: 'This announcement template references fields that have no value for this facility.',
        missing: error.missing,
      }
    }
    throw error
  }
}

/// The facility's own copy of a broadcast template where one exists, the org
/// default otherwise — the same precedence `effectiveTemplate` applies inside
/// the comms service, restated here rather than exported from there because it
/// is four lines and exporting it would widen that module's surface.
async function effectiveBroadcastTemplate(key: string, facilityId: string) {
  const rows = await prisma.messageTemplate.findMany({
    where: { key, channel: 'email', active: true, OR: [{ facilityId }, { facilityId: null }] },
  })
  if (rows.length === 0) return null
  const scoped = rows.filter((row) => row.facilityId === facilityId)
  const pool = scoped.length > 0 ? scoped : rows
  return pool.reduce((best, row) => (row.version > best.version ? row : best))
}

export type BroadcastTemplateOption = {
  key: string
  classification: string
  subject: string
  bodyText: string
  isOverride: boolean
}

/// The announcement templates this facility would actually send, for the
/// picker and for showing an operator where their words land.
///
/// Read here rather than through `templatesFor`, which gates on
/// `facility:settings` — a manager may send announcements without being able
/// to edit facility configuration, which is the whole reason `comms:broadcast`
/// is its own permission.
export async function broadcastTemplateOptions(
  actor: Actor,
  facilityId: string,
): Promise<BroadcastTemplateOption[]> {
  requirePermission(actor, 'comms:broadcast', facilityId)

  const rows = await prisma.messageTemplate.findMany({
    where: {
      channel: 'email',
      active: true,
      key: { startsWith: BROADCAST_KEY_PREFIX },
      OR: [{ facilityId }, { facilityId: null }],
    },
    orderBy: [{ key: 'asc' }, { version: 'desc' }],
  })

  const byKey = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const current = byKey.get(row.key)
    if (!current || (row.facilityId && !current.facilityId)) byKey.set(row.key, row)
  }
  return [...byKey.values()].map((row) => ({
    key: row.key,
    classification: row.classification,
    subject: row.subject ?? '',
    bodyText: row.bodyText,
    isOverride: row.facilityId !== null,
  }))
}

export async function sendBroadcast(actor: Actor, input: BroadcastInput): Promise<BroadcastResult> {
  requirePermission(actor, 'comms:broadcast', input.facilityId)

  if (!isBroadcastTemplateKey(input.templateKey)) return { ok: false, problem: 'not_broadcast' }
  if (!input.subject.trim() || !input.message.trim()) return { ok: false, problem: 'empty' }

  // Checked before anything is written. `sendDirectEmail` returns silently on
  // the kill switch and writes no `Message` row, so a broadcast sent with mail
  // paused would report "0 sent, 0 failed" out of 143 and look like a bug in
  // the audience filter rather than a switch somebody threw.
  if (!commsEnabled()) return { ok: false, problem: 'comms_off' }

  const template = await effectiveBroadcastTemplate(input.templateKey, input.facilityId)
  if (!template) return { ok: false, problem: 'no_template' }

  const recipients = await broadcastAudience(actor, input.facilityId, input.filter)
  if (recipients.length === 0) return { ok: false, problem: 'no_audience' }
  if (recipients.length > BROADCAST_MAX_RECIPIENTS) {
    return { ok: false, problem: 'too_many', detail: String(recipients.length) }
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: input.facilityId },
    select: FACILITY_FIELDS,
  })
  const origin = portalUrl()

  // Rendered once against the first recipient BEFORE any mail goes out. A
  // template that cannot render fails for every recipient identically, and
  // finding that out on recipient 1 of 143 — with 142 `failed` rows already
  // written — is the shape of failure this refuses.
  try {
    renderEmail(template, contextFor(recipients[0], facility, input, origin))
  } catch (error) {
    if (error instanceof RenderError) {
      return {
        ok: false,
        problem: 'render',
        detail: 'This announcement template references fields that have no value for this facility.',
        missing: error.missing,
      }
    }
    throw error
  }

  const broadcastId = broadcastIdFor(actor, input)
  const eventId = `broadcast:${broadcastId}`

  // CN-13 (B-074). An operational broadcast is one the tenant may switch off
  // in the preference center; a marketing one is governed by the unsubscribe
  // list instead and carries no category, exactly as the rule-driven path
  // decides it.
  const category = template.classification === 'operational' ? 'operational_notices' : null

  // A recipient whose own row cannot render — the one variable field is
  // `tenant.first_name`, so in practice a tenant saved with a blank one. Held
  // rather than thrown: an exception inside `inParallel` abandons every send
  // still queued behind it, which turns one bad row into a half-delivered
  // outage notice and no record of where it stopped.
  const unrenderable: string[] = []

  await inParallel(recipients, SEND_CONCURRENCY, async (recipient) => {
    let rendered
    try {
      rendered = renderEmail(template, contextFor(recipient, facility, input, origin))
    } catch (error) {
      if (!(error instanceof RenderError)) throw error
      unrenderable.push(recipient.email)
      return
    }
    await sendDirectEmail({
      idempotencyKey: `${eventId}:${recipient.tenantId}`,
      eventId,
      templateKey: input.templateKey,
      classification: template.classification,
      category,
      to: recipient.email,
      fromName: facility.emailFromName ?? facility.name,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      facilityId: input.facilityId,
      recipientTenantId: recipient.tenantId,
    })
  })

  const counts = await prisma.message.groupBy({
    by: ['status'],
    where: { eventId },
    _count: { _all: true },
  })
  const total = (...statuses: string[]) =>
    counts
      .filter((row) => statuses.includes(row.status))
      .reduce((sum, row) => sum + row._count._all, 0)

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'comms.broadcast_sent',
    entityType: 'Message',
    entityId: broadcastId,
    facilityId: input.facilityId,
    context: {
      templateKey: input.templateKey,
      classification: template.classification,
      templateVersion: template.version,
      building: input.filter.building ?? null,
      unitNumbers: [...(input.filter.unitNumbers ?? [])],
      recipients: recipients.length,
      unrenderable: unrenderable.length,
      subject: input.subject,
      // The wording, not just the count. "What exactly did you tell them" is
      // the question a complaint asks, and the `Message` bodies answer it only
      // for as long as nobody needs the one the send never reached.
      message: input.message,
    },
  })

  return {
    ok: true,
    broadcastId,
    recipients: recipients.length,
    sent: total('sent', 'delivered'),
    suppressed: total('suppressed'),
    cancelled: total('cancelled'),
    // The unrenderable rows are failures and are counted as such, so the four
    // numbers plus nothing else always add up to `recipients`.
    failed: total('failed') + unrenderable.length,
  }
}
