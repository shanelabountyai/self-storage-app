import { prisma } from '@storage/db'
import { normalizePhoneE164 } from '@storage/core/comms'
import { emitEvent } from '@storage/core/events'
import { createTask } from '@/lib/admin/tasks'

// PRD 05 §8 Phase 3 / PRD 02 US-41 (B-135, D-78). An inbound text that is not
// STOP, HELP, START or YES.
//
// Until now the webhook answered one with `<Response/>` — no reply, no record,
// nobody told. A tenant writing "I paid yesterday" or "the gate won't open"
// got silence from a number we had texted them from first. That is the whole
// argument for a two-way inbox, and D-78's evaluation was that at 2–10
// facilities the volume does not justify one: no threading, no `direction`
// column on `Message`, no second queue for a part-timer to remember to open.
// It routes to the queue they already work.
//
// ── Where the words are kept ────────────────────────────────────────────────
//
// Not on `Message`, which is outbound by construction — `eventId`, `ruleId`,
// `templateKey` and an idempotency key over all three are required columns,
// and an inbound text has none of them. Not on `Task`, which has no field for
// context (`proof` is completion evidence, and putting the body there would
// satisfy its own note requirement and let staff close the task without
// reading it).
//
// It goes in the domain event, and the task points at that event. `Task` has
// carried `sourceEventId` since B-095 for exactly this relationship, and
// `gate_manual_action` already establishes the shape this borrows: the task
// names an entity, and a subject resolver reads the detail off it.
//
// One task per inbound message, deliberately, rather than one per tenant per
// day — which is what keying the task on the tenant would have given. Two
// questions from the same person on the same afternoon are two things to
// answer, and the second one's words would have been nowhere at all.

export type InboundSmsResult =
  | { ok: true; taskId: string; facilityName: string; facilityPhone: string | null }
  | { ok: false; reason: 'unmatched' | 'empty' }

/// The tenant this number belongs to, with the facility to raise the task at.
///
/// Best-effort on the same terms as `facilityContactForPhone`: the FROM number
/// is the only identity an inbound text carries, matched on the last 10 digits
/// because phone input is not normalised at capture. A household number shared
/// by two tenants resolves to one of them, which is better than nobody — the
/// task carries the message, and a person reads it.
async function senderOf(
  e164: string,
): Promise<{ tenantId: string; facilityId: string; facilityName: string; facilityPhone: string | null } | null> {
  const tenant = await prisma.tenant.findFirst({
    where: { phone: { endsWith: e164.slice(-10) } },
    select: { id: true },
  })
  if (!tenant) return null

  const lease = await prisma.lease.findFirst({
    where: { tenantId: tenant.id, status: { not: 'ended' } },
    orderBy: { startDate: 'desc' },
    select: { facilityId: true, facility: { select: { name: true, phone: true } } },
  })
  if (!lease) return null

  return {
    tenantId: tenant.id,
    facilityId: lease.facilityId,
    facilityName: lease.facility.name,
    facilityPhone: lease.facility.phone,
  }
}

/// Records an inbound message and puts it in front of somebody.
///
/// A number that matches no current tenant raises no task, because `Task`
/// requires a facility and there is no honest one to pick — this SMS number is
/// site-wide, not per-site, so `To` cannot supply it either. The event is
/// still written, so the message is never simply gone, and the caller answers
/// with the office number rather than silence.
export async function routeInboundSms(input: {
  rawPhone: string
  body: string
}): Promise<InboundSmsResult> {
  const body = input.body.trim()
  if (body === '') return { ok: false, reason: 'empty' }

  const phone = normalizePhoneE164(input.rawPhone) ?? input.rawPhone
  const sender = await senderOf(phone)

  const event = await emitEvent({
    name: 'sms.inbound_received',
    entityType: 'Tenant',
    entityId: sender?.tenantId ?? 'unmatched',
    facilityId: sender?.facilityId,
    payload: {
      // Stored whole, like `Message.toAddress`: the log is the evidence, and
      // masking happens at display (CN-18), never at write.
      phone,
      body,
      tenantId: sender?.tenantId ?? null,
    },
  })

  if (!sender) return { ok: false, reason: 'unmatched' }

  const task = await createTask({
    facilityId: sender.facilityId,
    type: 'inbound_sms_review',
    // The EVENT, not the tenant: one task per message (see the note above),
    // and the subject resolver reads the words off it.
    entityType: 'DomainEvent',
    entityId: event.id,
    sourceEventId: event.id,
    priority: 'high',
    // `high` because the sender is standing somewhere with a question and has
    // no idea whether anyone received it. Everything else in this queue is
    // work the business found for itself; this is the only type where a person
    // is waiting on the other end of it.
  })

  return {
    ok: true,
    taskId: task.id,
    facilityName: sender.facilityName,
    facilityPhone: sender.facilityPhone,
  }
}
