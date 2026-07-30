import { prisma } from '@storage/db'
import type { DomainEvent } from '@storage/db'
import type { EventName } from './catalog'

export type EventHandlerContext = {
  event: DomainEvent
  /// Present so a handler can make its own writes idempotent by keying on the
  /// delivery, rather than trusting that it will only ever be called once.
  deliveryId: string
  attempt: number
}

export type Consumer = {
  /// Stable across deploys. Renaming replays every past event to the new name.
  name: string
  events: readonly EventName[]
  handle: (context: EventHandlerContext) => Promise<void>
}

export const RETRY = {
  maxAttempts: 5,
  /// Exponential with a ceiling: 1m, 5m, 25m, 60m, 60m.
  backoffMs: (attempt: number) => Math.min(60_000 * 5 ** (attempt - 1), 60 * 60_000),
}

export type DispatchResult = {
  claimed: number
  succeeded: number
  failed: number
  deadLettered: number
}

/// Finds events this consumer has not settled yet. A delivery row exists only
/// once the consumer has claimed the event, so "no row" means "never seen".
async function pendingEventsFor(consumer: Consumer, limit: number): Promise<DomainEvent[]> {
  return prisma.domainEvent.findMany({
    where: {
      name: { in: [...consumer.events] },
      OR: [
        { deliveries: { none: { consumer: consumer.name } } },
        {
          deliveries: {
            some: {
              consumer: consumer.name,
              status: 'failed',
              nextAttemptAt: { lte: new Date() },
            },
          },
        },
      ],
    },
    orderBy: { occurredAt: 'asc' },
    take: limit,
  })
}

/// Claims a delivery for this worker. Returns null when another worker already
/// holds it — the unique index on (eventId, consumer) is what makes the claim
/// exclusive, so no advisory locks or SELECT ... FOR UPDATE are needed.
async function claim(
  consumer: Consumer,
  event: DomainEvent,
): Promise<{ id: string; attempt: number } | null> {
  const existing = await prisma.eventDelivery.findUnique({
    where: { eventId_consumer: { eventId: event.id, consumer: consumer.name } },
  })

  if (!existing) {
    try {
      const created = await prisma.eventDelivery.create({
        data: { eventId: event.id, consumer: consumer.name, status: 'processing', attempts: 1 },
      })
      return { id: created.id, attempt: 1 }
    } catch {
      // Lost the race to another worker.
      return null
    }
  }

  if (existing.status !== 'failed') return null

  // Re-claim a failed delivery, conditioned on it still being failed so two
  // workers cannot both pick up the same retry.
  const reclaimed = await prisma.eventDelivery.updateMany({
    where: { id: existing.id, status: 'failed' },
    data: { status: 'processing', attempts: existing.attempts + 1, nextAttemptAt: null },
  })
  return reclaimed.count === 1
    ? { id: existing.id, attempt: existing.attempts + 1 }
    : null
}

/// Runs every pending event through the given consumers.
///
/// Delivery is **at-least-once**: a handler that succeeds and then crashes
/// before its row is marked will be called again on the next dispatch. Handlers
/// must be idempotent — see the note on EventDelivery in the schema.
export async function dispatchEvents(
  consumers: readonly Consumer[],
  options: { limitPerConsumer?: number } = {},
): Promise<DispatchResult> {
  const limit = options.limitPerConsumer ?? 100
  const result: DispatchResult = { claimed: 0, succeeded: 0, failed: 0, deadLettered: 0 }

  for (const consumer of consumers) {
    const events = await pendingEventsFor(consumer, limit)

    for (const event of events) {
      const claimed = await claim(consumer, event)
      if (!claimed) continue
      result.claimed++

      try {
        await consumer.handle({ event, deliveryId: claimed.id, attempt: claimed.attempt })
        await prisma.eventDelivery.update({
          where: { id: claimed.id },
          data: { status: 'succeeded', completedAt: new Date(), nextAttemptAt: null, lastError: null },
        })
        result.succeeded++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const exhausted = claimed.attempt >= RETRY.maxAttempts

        await prisma.eventDelivery.update({
          where: { id: claimed.id },
          data: exhausted
            ? {
                // Dead-lettered rather than retried forever. Surfacing these is
                // the failure queue in B-054.
                status: 'dead_letter',
                completedAt: new Date(),
                nextAttemptAt: null,
                lastError: message.slice(0, 1000),
              }
            : {
                status: 'failed',
                nextAttemptAt: new Date(Date.now() + RETRY.backoffMs(claimed.attempt)),
                lastError: message.slice(0, 1000),
              },
        })

        if (exhausted) result.deadLettered++
        else result.failed++
        // One bad event must not stop the rest of the batch.
      }
    }
  }

  return result
}

/// Deliveries that exhausted their retries and need a human. B-054 turns these
/// into staff tasks; until then this is how you find them.
export async function deadLetters(limit = 100) {
  return prisma.eventDelivery.findMany({
    where: { status: 'dead_letter' },
    include: { event: true },
    orderBy: { completedAt: 'desc' },
    take: limit,
  })
}
