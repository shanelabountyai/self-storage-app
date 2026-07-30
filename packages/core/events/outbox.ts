import { prisma } from '@storage/db'
import type { DomainEvent, Prisma } from '@storage/db'
import { isKnownEvent, type EventName } from './catalog'

export type EmitEventInput = {
  name: EventName
  entityType: string
  entityId: string
  facilityId?: string | null
  payload?: Record<string, unknown>
  correlationId?: string | null
  occurredAt?: Date
}

export class UnknownEventError extends Error {
  constructor(readonly name: string) {
    super(`"${name}" is not in the event catalog`)
    this.name = 'UnknownEventError'
  }
}

/// Appends an event to the outbox.
///
/// **Pass the transaction client.** The whole point of an outbox is that the
/// event and the state change it describes commit or roll back together:
///
/// ```ts
/// await prisma.$transaction(async (tx) => {
///   const lease = await tx.lease.update({ ... })
///   await emitEvent({ name: 'lease.moved_out', ... }, tx)
/// })
/// ```
///
/// Emitting outside a transaction is allowed — some events have no
/// accompanying write — but then it is a plain append with no atomicity.
export async function emitEvent(
  input: EmitEventInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<DomainEvent> {
  // Catching a typo at the emit site beats discovering it when a consumer that
  // was supposed to fire never did.
  if (!isKnownEvent(input.name)) throw new UnknownEventError(input.name)

  return client.domainEvent.create({
    data: {
      name: input.name,
      entityType: input.entityType,
      entityId: input.entityId,
      facilityId: input.facilityId ?? null,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      correlationId: input.correlationId ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    },
  })
}
