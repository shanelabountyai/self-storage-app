import { type Prisma, prisma } from '@storage/db'
import type { DomainEvent, MessageClassification, SuppressionReason } from '@storage/db'
import {
  commsEnabled,
  effectiveRecipient,
  fromAddress,
  selectProvider,
} from './provider'
import { type MergeContext, messageIdempotencyKey, RenderError, renderEmail } from './render'

// PRD 05 FR-1. The pipeline: event → rule(s) → recipient → suppression/consent
// → render → provider → Message log, idempotent by construction. Producers emit
// events and this is the only thing that sends. B-030 ships the engine; the
// rules and templates that light it up are data seeded by the items that own
// the content (B-031 move-in path, later billing/dunning items).
//
// MVP is email-only (FR-4). SMS — Twilio, quiet hours, STOP/HELP, consent
// gating, the fallback pair — lands with B-032/Phase 2; the schema and the
// classification/consent checks below are already shaped for it.

const CHANNEL = 'email' as const

type RecipientFacility = {
  id: string
  name: string
  phone: string | null
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  postalCode: string
}

type RecipientLease = {
  id: string
  status: string
  unit: { number: string; unitType: { name: string; widthFt: number; lengthFt: number } } | null
}

type Recipient = {
  tenantId: string
  email: string | null
  firstName: string
  lastName: string
  facility: RecipientFacility | null
  lease: RecipientLease | null
}

const FACILITY_SELECT = {
  id: true,
  name: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
} as const

/// Resolves who a message goes to from the event's entity. Keyed by entityType
/// because that is what tells us how to reach the tenant — a lease points at one
/// via `tenantId`, a payment via its own. B-030 ships the two resolvers its own
/// events and B-031's move-in path need; later items (billing, delinquency) add
/// Payment/Invoice resolvers when their rules arrive. An unhandled entity type
/// is a no-op, not a crash — the event simply has no comms mapping yet.
async function resolveRecipient(event: DomainEvent): Promise<Recipient | null> {
  if (event.entityType === 'Lease') {
    const lease = await prisma.lease.findUnique({
      where: { id: event.entityId },
      select: {
        status: true,
        tenant: { select: { id: true, email: true, firstName: true, lastName: true } },
        facility: { select: FACILITY_SELECT },
        unit: { select: { number: true, unitType: { select: { name: true, widthFt: true, lengthFt: true } } } },
      },
    })
    if (!lease) return null
    return {
      tenantId: lease.tenant.id,
      email: lease.tenant.email,
      firstName: lease.tenant.firstName,
      lastName: lease.tenant.lastName,
      facility: lease.facility,
      lease: { id: event.entityId, status: lease.status, unit: lease.unit },
    }
  }

  if (event.entityType === 'Tenant') {
    const tenant = await prisma.tenant.findUnique({
      where: { id: event.entityId },
      select: { id: true, email: true, firstName: true, lastName: true },
    })
    if (!tenant) return null
    const facility = event.facilityId
      ? await prisma.facility.findUnique({ where: { id: event.facilityId }, select: FACILITY_SELECT })
      : null
    return {
      tenantId: tenant.id,
      email: tenant.email,
      firstName: tenant.firstName,
      lastName: tenant.lastName,
      facility,
      lease: null,
    }
  }

  return null
}

function formatFacilityAddress(f: RecipientFacility): string {
  const street = f.addressLine2 ? `${f.addressLine1}, ${f.addressLine2}` : f.addressLine1
  return `${street}, ${f.city}, ${f.state} ${f.postalCode}`
}

/// FR-10 standard merge fields, built from current state — read here, at send
/// time, not frozen at event time (FR-18). Fields that need billing
/// (`balance.total`, `invoice.due_date`, `links.pay_now`) are intentionally
/// absent: the items that emit those events extend this builder. A template
/// that references a field not built yet fails loudly at render (FR-9) rather
/// than mailing a blank — which is exactly why those templates are not seeded
/// until their data exists.
function mergeContextFor(recipient: Recipient): MergeContext {
  const base = (process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const context: MergeContext = {
    'tenant.first_name': recipient.firstName,
    'tenant.last_name': recipient.lastName,
    'links.portal': `${base}/login`,
  }
  if (recipient.facility) {
    context['facility.name'] = recipient.facility.name
    context['facility.phone'] = recipient.facility.phone ?? ''
    context['facility.address'] = formatFacilityAddress(recipient.facility)
  }
  if (recipient.lease?.unit) {
    const { widthFt, lengthFt } = recipient.lease.unit.unitType
    context['unit.number'] = recipient.lease.unit.number
    context['unit.size'] = `${widthFt}x${lengthFt}`
  }
  return context
}

type ResolvedRule = {
  id: string
  templateKey: string
  classification: MessageClassification
  skipConditions: string[]
}

/// FR-2. The active rules for this event, with the per-facility override winning
/// over the org default for a given template key.
async function applicableRules(event: DomainEvent): Promise<ResolvedRule[]> {
  const rows = await prisma.notificationRule.findMany({
    where: {
      event: event.name,
      active: true,
      channel: CHANNEL,
      OR: [{ facilityId: event.facilityId ?? undefined }, { facilityId: null }],
    },
  })

  const byKey = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const current = byKey.get(row.templateKey)
    // A facility-scoped rule beats a null (org-default) one for the same key.
    if (!current || (row.facilityId && !current.facilityId)) byKey.set(row.templateKey, row)
  }
  return [...byKey.values()].map((r) => ({
    id: r.id,
    templateKey: r.templateKey,
    classification: r.classification,
    skipConditions: r.skipConditions,
  }))
}

/// The effective template for a key: facility override beats org default, and
/// the highest active version wins (versioned per FR-21).
async function effectiveTemplate(templateKey: string, facilityId: string | null) {
  const rows = await prisma.messageTemplate.findMany({
    where: {
      key: templateKey,
      channel: CHANNEL,
      active: true,
      OR: [{ facilityId: facilityId ?? undefined }, { facilityId: null }],
    },
  })
  if (rows.length === 0) return null
  const scoped = rows.filter((r) => r.facilityId === facilityId)
  const pool = scoped.length > 0 ? scoped : rows.filter((r) => r.facilityId === null)
  return pool.reduce((best, r) => (r.version > best.version ? r : best))
}

/// PRD 05 §6.1 suppression matrix. A hard bounce or spam complaint blocks every
/// channel — the address is unusable or the recipient reported us. STOP blocks
/// SMS only. Unsubscribe / manual block marketing only; transactional and
/// operational mail still goes, which is what CAN-SPAM's transactional carve-out
/// permits. Returns the reason so the send record can prove why it was withheld.
async function suppressionFor(
  address: string,
  classification: MessageClassification,
): Promise<SuppressionReason | null> {
  const entry = await prisma.suppression.findUnique({
    where: { channel_address: { channel: CHANNEL, address: address.toLowerCase() } },
  })
  if (!entry) return null
  switch (entry.reason) {
    case 'hard_bounce':
    case 'complaint':
      return entry.reason
    case 'unsubscribe':
    case 'manual':
      return classification === 'marketing' ? entry.reason : null
    case 'stop': // SMS-only; never blocks email
    case 'kill_switch':
      return null
  }
}

/// FR-18 staleness. Predicates re-evaluated at send time; if any holds the
/// message's premise is gone and it is cancelled rather than sent. B-030 ships
/// the one predicate provable against what exists today; billing/dunning items
/// register `invoice_paid`, `payment_processing`, `autopay_enabled`, etc. as
/// their events arrive.
const SKIP_PREDICATES: Record<string, (recipient: Recipient) => boolean> = {
  // Don't welcome or chase a tenant whose lease has already ended.
  tenant_moved_out: (recipient) => recipient.lease?.status === 'ended',
}

function firstFiringSkip(rule: ResolvedRule, recipient: Recipient): string | null {
  for (const key of rule.skipConditions) {
    const predicate = SKIP_PREDICATES[key]
    if (predicate && predicate(recipient)) return key
  }
  return null
}

type DeliveryOutcome = 'sent' | 'suppressed' | 'cancelled' | 'failed' | 'skipped'

/// Upserts the append-only Message row for one (event, rule, recipient, channel)
/// to a terminal state. Keyed by the idempotency key, so a redelivery lands on
/// the same row instead of a duplicate.
async function writeMessage(
  idempotencyKey: string,
  data: {
    event: DomainEvent
    ruleId: string
    templateKey: string
    templateVersion: number
    classification: MessageClassification
    recipient: Recipient
    toAddress: string
    subject: string | null
    body: string
    status: 'queued' | 'sent' | 'failed' | 'suppressed' | 'cancelled'
    suppressionReason?: SuppressionReason | null
    providerMessageId?: string | null
    error?: string | null
    sentAt?: Date | null
  },
) {
  const common = {
    templateKey: data.templateKey,
    templateVersion: data.templateVersion,
    classification: data.classification,
    channel: CHANNEL,
    recipientTenantId: data.recipient.tenantId,
    facilityId: data.recipient.facility?.id ?? data.event.facilityId ?? null,
    toAddress: data.toAddress,
    subjectSnapshot: data.subject,
    bodySnapshot: data.body,
    status: data.status,
    suppressionReason: data.suppressionReason ?? null,
    providerMessageId: data.providerMessageId ?? null,
    error: data.error ?? null,
    sentAt: data.sentAt ?? null,
  }
  return prisma.message.upsert({
    where: { idempotencyKey },
    create: {
      idempotencyKey,
      eventId: data.event.id,
      ruleId: data.ruleId,
      ...common,
    },
    update: common,
  })
}

async function deliverForRule(event: DomainEvent, rule: ResolvedRule, recipient: Recipient): Promise<DeliveryOutcome> {
  const idempotencyKey = messageIdempotencyKey(event.id, rule.id, recipient.tenantId, CHANNEL)

  // Idempotent hit: a redelivery of an already-settled send does nothing. Only
  // queued/failed rows are re-attempted below.
  const existing = await prisma.message.findUnique({ where: { idempotencyKey }, select: { status: true } })
  if (existing && ['sent', 'delivered', 'suppressed', 'cancelled'].includes(existing.status)) {
    return 'skipped'
  }

  const base = {
    event,
    ruleId: rule.id,
    templateKey: rule.templateKey,
    classification: rule.classification,
    recipient,
  }

  // FR-18: premise still valid?
  const skip = firstFiringSkip(rule, recipient)
  if (skip) {
    await writeMessage(idempotencyKey, {
      ...base,
      templateVersion: 0,
      toAddress: recipient.email ?? '',
      subject: null,
      body: '',
      status: 'cancelled',
      error: `skipped: ${skip}`,
    })
    return 'cancelled'
  }

  // No reachable email is a real dead-end (CN-19 will make this a staff task);
  // recorded as a failure so it is visible rather than silently dropped.
  if (!recipient.email) {
    await writeMessage(idempotencyKey, {
      ...base,
      templateVersion: 0,
      toAddress: '',
      subject: null,
      body: '',
      status: 'failed',
      error: 'no reachable email address',
    })
    return 'failed'
  }
  const address = recipient.email.toLowerCase()

  const suppression = await suppressionFor(address, rule.classification)
  if (suppression) {
    await writeMessage(idempotencyKey, {
      ...base,
      templateVersion: 0,
      toAddress: address,
      subject: null,
      body: '',
      status: 'suppressed',
      suppressionReason: suppression,
      error: `suppressed: ${suppression}`,
    })
    return 'suppressed'
  }

  const template = await effectiveTemplate(rule.templateKey, recipient.facility?.id ?? null)
  if (!template) {
    await writeMessage(idempotencyKey, {
      ...base,
      templateVersion: 0,
      toAddress: address,
      subject: null,
      body: '',
      status: 'failed',
      error: `no active template for "${rule.templateKey}"`,
    })
    return 'failed'
  }

  const context = mergeContextFor(recipient)
  let rendered
  try {
    rendered = renderEmail(template, context)
  } catch (error) {
    // FR-9: a missing merge field blocks the send loudly. Recorded as failed
    // (the evidence a future delivery dashboard surfaces) rather than thrown,
    // so a sibling rule's message on the same event still goes out.
    if (error instanceof RenderError) {
      await writeMessage(idempotencyKey, {
        ...base,
        templateVersion: template.version,
        toAddress: address,
        subject: null,
        body: '',
        status: 'failed',
        error: error.message,
      })
      return 'failed'
    }
    throw error
  }

  // Reserve the slot before the network call so a crash mid-send leaves a
  // queued row a retry re-attempts, and the provider's own idempotency key
  // (passed below) is the backstop against a double-send in that window.
  await writeMessage(idempotencyKey, {
    ...base,
    templateVersion: template.version,
    toAddress: effectiveRecipient(address),
    subject: rendered.subject,
    body: rendered.text,
    status: 'queued',
  })

  const provider = selectProvider()
  const result = await provider.sendEmail({
    to: effectiveRecipient(address),
    from: fromAddress(recipient.facility?.name ?? 'Storage'),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey,
  })

  if (result.ok) {
    await writeMessage(idempotencyKey, {
      ...base,
      templateVersion: template.version,
      toAddress: effectiveRecipient(address),
      subject: rendered.subject,
      body: rendered.text,
      status: 'sent',
      providerMessageId: result.providerMessageId,
      sentAt: new Date(),
    })
    return 'sent'
  }

  await writeMessage(idempotencyKey, {
    ...base,
    templateVersion: template.version,
    toAddress: effectiveRecipient(address),
    subject: rendered.subject,
    body: rendered.text,
    status: 'failed',
    error: result.message,
  })
  // A transient provider error re-runs the whole event on the next dispatch;
  // already-sent siblings skip on their idempotency key, only this one retries.
  if (result.retryable) throw new Error(`comms provider send failed: ${result.message}`)
  return 'failed'
}

export type CommsResult = {
  paused: boolean
  sent: number
  suppressed: number
  cancelled: number
  failed: number
  skipped: number
}

/// Processes one domain event through every rule that maps to it. Called by the
/// comms consumer (jobs/registry) on each dispatch; idempotent, so an
/// at-least-once redelivery is safe.
export async function processCommsEvent(event: DomainEvent): Promise<CommsResult> {
  const result: CommsResult = { paused: false, sent: 0, suppressed: 0, cancelled: 0, failed: 0, skipped: 0 }

  // FR-20 kill switch: nothing goes out, and the event is settled without a
  // Message row (see provider.ts on the emergency-stop, no-replay semantics).
  if (!commsEnabled()) {
    result.paused = true
    return result
  }

  const rules = await applicableRules(event)
  if (rules.length === 0) return result

  const recipient = await resolveRecipient(event)
  // No recipient resolver for this entity type yet, or the entity is gone.
  if (!recipient) return result

  for (const rule of rules) {
    const outcome = await deliverForRule(event, rule, recipient)
    result[outcome] += 1
  }
  return result
}

// -- staff-facing helpers (thin; the management UIs are later items) ----------

/// CN-20 add-a-suppression. The management surface (search/remove) is a later
/// admin item; this is the write path other code (webhook bounce handling,
/// STOP processing) will call. Normalises the address so lookups match.
export async function suppress(
  input: { channel: 'email' | 'sms'; address: string; reason: SuppressionReason; note?: string; createdByStaffId?: string },
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const address = input.channel === 'email' ? input.address.toLowerCase() : input.address
  return client.suppression.upsert({
    where: { channel_address: { channel: input.channel, address } },
    create: {
      channel: input.channel,
      address,
      reason: input.reason,
      note: input.note ?? null,
      createdByStaffId: input.createdByStaffId ?? null,
    },
    // First reason wins — a manual entry must not quietly overwrite a STOP or a
    // complaint (those are the non-removable ones, CN-20).
    update: {},
  })
}
