import { prisma } from '@storage/db'
import { consequencesOf, nextDeliveryStatus, statusFromResendEvent, type DeliveryStatus } from '@storage/core/comms'
import { suppress } from '@/lib/comms/service'
import { createTask } from '@/lib/admin/tasks'

// PRD 05 FR-14 / FR-15 (B-054). What happens when the provider tells us how a
// message actually went.
//
// Until now `Message.status` stopped at `sent` — meaning "we handed it to
// Resend", which is not the same claim as "the tenant received it". A lien
// notice log that says `sent` for an address that hard-bounced eight months ago
// is worse than no log: it asserts something untrue about service of notice.
//
// The state machine, the event mapping and the consequences all live in
// packages/core/comms/delivery.ts. This file is the database half: find the
// message, move it forward if the event moves it forward, and carry out what
// FR-15 says must follow a bounce.

export type DeliveryEvent = {
  /// Resend's event name, e.g. `email.bounced`.
  type: string
  /// The provider's own id for the message, matched against
  /// `Message.providerMessageId` — which `recordSend` already stores.
  providerMessageId: string
}

export type DeliveryOutcome =
  | { applied: false; reason: 'unknown_message' | 'ignored_event' | 'no_change' }
  | { applied: true; status: DeliveryStatus; suppressed: boolean; taskId: string | null }

/// Applies one provider event. Safe to call twice with the same event.
///
/// Idempotency comes from the status ranking rather than from a table of seen
/// event ids: a redelivered `email.delivered` finds the message already
/// delivered and returns `no_change`. That is the cheaper guarantee, and it
/// also handles the case an id table would not — events arriving out of order,
/// which providers do routinely.
export async function applyDeliveryEvent(event: DeliveryEvent): Promise<DeliveryOutcome> {
  const incoming = statusFromResendEvent(event.type)
  const consequence = consequencesOf(event.type)
  if (!incoming && !consequence.suppress) return { applied: false, reason: 'ignored_event' }

  const message = await prisma.message.findFirst({
    where: { providerMessageId: event.providerMessageId },
    select: {
      id: true,
      status: true,
      channel: true,
      toAddress: true,
      facilityId: true,
      recipientTenantId: true,
    },
  })
  // Not ours, or ours from before we stored provider ids. Acknowledged rather
  // than 404'd: a non-2xx would make Resend retry an event we can never match.
  if (!message) return { applied: false, reason: 'unknown_message' }

  const next = incoming ? nextDeliveryStatus(message.status as DeliveryStatus, incoming) : null

  // A bounce whose status is already recorded still needs its consequences
  // checked — `suppress` is an upsert and `createTask` is idempotent on
  // (type, entityId, businessDate), so a redelivery is a no-op either way, but
  // a first delivery that crashed midway gets finished on the retry.
  if (!next && !consequence.suppress) return { applied: false, reason: 'no_change' }

  const status = next ?? (message.status as DeliveryStatus)

  await prisma.$transaction(async (tx) => {
    if (next) {
      await tx.message.update({
        where: { id: message.id },
        data: {
          status: next,
          error: next === 'bounced' ? `provider: ${event.type}` : undefined,
        },
      })
    }

    if (consequence.suppress) {
      await suppress(
        {
          channel: message.channel as 'email' | 'sms',
          address: message.toAddress,
          reason: consequence.suppress,
          note: `Automatic — ${event.type}`,
        },
        tx,
      )
    }

    if (consequence.flagTenant && message.recipientTenantId) {
      // Only set it, never clear it here: the flag is cleared when somebody
      // enters a new address (lib/portal/contact.ts), not when a later event
      // happens to look better.
      await tx.tenant.updateMany({
        where: { id: message.recipientTenantId, emailUndeliverableAt: null },
        data: { emailUndeliverableAt: new Date() },
      })
    }
  })

  // Outside the transaction: `createTask` reads the facility timezone and does
  // its own idempotent insert, and a task failing to appear must not roll back
  // the suppression that stops us mailing a dead address.
  let taskId: string | null = null
  if (consequence.raiseTask && message.recipientTenantId && message.facilityId) {
    const task = await createTask({
      facilityId: message.facilityId,
      type: 'no_reachable_channel',
      entityType: 'Tenant',
      entityId: message.recipientTenantId,
      priority: 'high',
    })
    taskId = task.id
  }

  return { applied: true, status, suppressed: consequence.suppress !== null, taskId }
}
