import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  dispatchEvents,
  emitEvent,
  RETRY,
  UnknownEventError,
  type Consumer,
} from '../packages/core/events'
import { lastSuccessfulRun, runJob } from '../packages/core/jobs'

// Outbox atomicity, claim exclusivity and retry behaviour are all concurrency
// properties — a mock would prove nothing about them.
const hasDatabase = Boolean(process.env.DATABASE_URL)

const correlationId = randomUUID()
let facilityId = ''

beforeAll(async () => {
  if (!hasDatabase) return
  const facility = await prisma.facility.create({
    data: {
      name: 'Events Test',
      slug: `events-test-${correlationId.slice(0, 8)}`,
      addressLine1: '1 Queue St',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      timezone: 'America/Chicago',
        status: 'inactive' as const,
    },
  })
  facilityId = facility.id
})

beforeEach(async () => {
  if (!hasDatabase) return
  await prisma.eventDelivery.deleteMany({ where: { event: { facilityId } } })
  await prisma.domainEvent.deleteMany({ where: { facilityId } })
  await prisma.jobRun.deleteMany({ where: { facilityId } })
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.eventDelivery.deleteMany({ where: { event: { facilityId } } })
  await prisma.domainEvent.deleteMany({ where: { facilityId } })
  await prisma.jobRun.deleteMany({ where: { facilityId } })
  await prisma.facility.deleteMany({ where: { id: facilityId } })
  await prisma.$disconnect()
})

const emit = (name: Parameters<typeof emitEvent>[0]['name'] = 'lease.moved_in') =>
  emitEvent({
    name,
    entityType: 'Lease',
    entityId: `lease-${randomUUID().slice(0, 8)}`,
    facilityId,
    correlationId,
    payload: { unitId: 'u1' },
  })

function recordingConsumer(name: string, behaviour: () => Promise<void> = async () => {}) {
  const calls: string[] = []
  const consumer: Consumer = {
    name,
    events: ['lease.moved_in'],
    handle: async ({ event }) => {
      calls.push(event.id)
      await behaviour()
    },
  }
  return { consumer, calls }
}

describe.skipIf(!hasDatabase)('transactional outbox', () => {
  it('rolls the event back with the write that caused it', async () => {
    const unitId = `unit-${randomUUID().slice(0, 8)}`

    await expect(
      prisma.$transaction(async (tx) => {
        await emitEvent(
          { name: 'unit.status_changed', entityType: 'Unit', entityId: unitId, facilityId },
          tx,
        )
        throw new Error('state change failed')
      }),
    ).rejects.toThrow('state change failed')

    // No event may describe a change that never happened.
    expect(await prisma.domainEvent.findMany({ where: { entityId: unitId } })).toEqual([])
  })

  it('commits the event with the write', async () => {
    const unitId = `unit-${randomUUID().slice(0, 8)}`
    await prisma.$transaction(async (tx) => {
      await emitEvent(
        { name: 'unit.status_changed', entityType: 'Unit', entityId: unitId, facilityId },
        tx,
      )
    })
    expect(await prisma.domainEvent.findMany({ where: { entityId: unitId } })).toHaveLength(1)
  })

  it('rejects an event name that is not in the catalog', async () => {
    await expect(
      // @ts-expect-error deliberately outside the catalog
      emitEvent({ name: 'lease.movedIn', entityType: 'Lease', entityId: 'x', facilityId }),
    ).rejects.toBeInstanceOf(UnknownEventError)
  })
})

describe.skipIf(!hasDatabase)('dispatch', () => {
  it('delivers each event to each consumer once', async () => {
    await emit()
    const a = recordingConsumer('consumer-a')
    const b = recordingConsumer('consumer-b')

    const first = await dispatchEvents([a.consumer, b.consumer])
    expect(first).toMatchObject({ claimed: 2, succeeded: 2, failed: 0 })

    // A second pass must not redeliver settled events.
    const second = await dispatchEvents([a.consumer, b.consumer])
    expect(second.claimed).toBe(0)
    expect(a.calls).toHaveLength(1)
    expect(b.calls).toHaveLength(1)
  })

  it('gives an event to only one worker when two dispatch at once', async () => {
    await emit()
    const { consumer, calls } = recordingConsumer('race-consumer')

    // The unique index on (eventId, consumer) is the claim.
    const results = await Promise.all([
      dispatchEvents([consumer]),
      dispatchEvents([consumer]),
    ])

    expect(results.reduce((sum, r) => sum + r.claimed, 0)).toBe(1)
    expect(calls).toHaveLength(1)
  })

  it('ignores events the consumer did not subscribe to', async () => {
    await emit('rates.updated')
    const { consumer, calls } = recordingConsumer('narrow-consumer')
    expect((await dispatchEvents([consumer])).claimed).toBe(0)
    expect(calls).toEqual([])
  })

  it('schedules a retry after a failure instead of losing the event', async () => {
    await emit()
    const failing: Consumer = {
      name: 'flaky-consumer',
      events: ['lease.moved_in'],
      handle: async () => {
        throw new Error('downstream unavailable')
      },
    }

    const result = await dispatchEvents([failing])
    expect(result).toMatchObject({ claimed: 1, failed: 1, succeeded: 0 })

    const delivery = await prisma.eventDelivery.findFirstOrThrow({
      where: { consumer: 'flaky-consumer' },
    })
    expect(delivery.status).toBe('failed')
    expect(delivery.attempts).toBe(1)
    expect(delivery.lastError).toContain('downstream unavailable')
    expect(delivery.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it('does not retry before the backoff has elapsed', async () => {
    await emit()
    const failing: Consumer = {
      name: 'backoff-consumer',
      events: ['lease.moved_in'],
      handle: async () => {
        throw new Error('nope')
      },
    }

    await dispatchEvents([failing])
    expect((await dispatchEvents([failing])).claimed).toBe(0)
  })

  it('dead-letters after the retry limit rather than looping forever', async () => {
    await emit()
    const failing: Consumer = {
      name: 'doomed-consumer',
      events: ['lease.moved_in'],
      handle: async () => {
        throw new Error('permanently broken')
      },
    }

    for (let attempt = 0; attempt < RETRY.maxAttempts; attempt++) {
      await dispatchEvents([failing])
      // Fast-forward past the backoff window.
      await prisma.eventDelivery.updateMany({
        where: { consumer: 'doomed-consumer', status: 'failed' },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      })
    }

    const delivery = await prisma.eventDelivery.findFirstOrThrow({
      where: { consumer: 'doomed-consumer' },
    })
    expect(delivery.status).toBe('dead_letter')
    expect(delivery.attempts).toBe(RETRY.maxAttempts)
    expect(delivery.completedAt).not.toBeNull()
    expect(delivery.nextAttemptAt).toBeNull()

    // A dead letter is never picked up again.
    expect((await dispatchEvents([failing])).claimed).toBe(0)
  })

  it('recovers when a failing handler starts working', async () => {
    await emit()
    let shouldFail = true
    const consumer: Consumer = {
      name: 'recovering-consumer',
      events: ['lease.moved_in'],
      handle: async () => {
        if (shouldFail) throw new Error('temporary')
      },
    }

    await dispatchEvents([consumer])
    shouldFail = false
    await prisma.eventDelivery.updateMany({
      where: { consumer: 'recovering-consumer' },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    })

    expect((await dispatchEvents([consumer])).succeeded).toBe(1)
    const delivery = await prisma.eventDelivery.findFirstOrThrow({
      where: { consumer: 'recovering-consumer' },
    })
    expect(delivery.status).toBe('succeeded')
    expect(delivery.attempts).toBe(2)
  })

  it('lets one bad event through without stopping the batch', async () => {
    const good = await emit()
    const bad = await emit()

    const consumer: Consumer = {
      name: 'partial-consumer',
      events: ['lease.moved_in'],
      handle: async ({ event }) => {
        if (event.id === bad.id) throw new Error('this one is broken')
      },
    }

    const result = await dispatchEvents([consumer])
    expect(result).toMatchObject({ claimed: 2, succeeded: 1, failed: 1 })

    const settled = await prisma.eventDelivery.findFirstOrThrow({
      where: { consumer: 'partial-consumer', eventId: good.id },
    })
    expect(settled.status).toBe('succeeded')
  })
})

describe.skipIf(!hasDatabase)('job runner', () => {
  const businessDate = new Date(Date.UTC(2026, 6, 30))

  it('runs once and skips a duplicate for the same business date', async () => {
    let runs = 0
    const handler = async () => {
      runs++
    }

    const first = await runJob({ jobName: 'nightly-test', facilityId, businessDate }, handler)
    expect(first.status).toBe('completed')
    expect(first.run.status).toBe('succeeded')

    const second = await runJob({ jobName: 'nightly-test', facilityId, businessDate }, handler)
    expect(second).toMatchObject({ status: 'skipped', reason: 'already_ran' })
    expect(runs).toBe(1)
  })

  it('runs again for the next business date', async () => {
    let runs = 0
    const handler = async () => {
      runs++
    }
    await runJob({ jobName: 'nightly-test', facilityId, businessDate }, handler)
    await runJob(
      { jobName: 'nightly-test', facilityId, businessDate: new Date(Date.UTC(2026, 6, 31)) },
      handler,
    )
    expect(runs).toBe(2)
  })

  it('lets exactly one of two simultaneous starts through', async () => {
    let runs = 0
    const handler = async () => {
      runs++
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    await Promise.all([
      runJob({ jobName: 'race-job', facilityId, businessDate }, handler),
      runJob({ jobName: 'race-job', facilityId, businessDate }, handler),
    ])
    expect(runs).toBe(1)
  })

  it('re-runs when forced, without creating a second row', async () => {
    let runs = 0
    const handler = async () => {
      runs++
    }
    await runJob({ jobName: 'forced-job', facilityId, businessDate }, handler)
    const forced = await runJob(
      { jobName: 'forced-job', facilityId, businessDate, force: true },
      handler,
    )

    expect(runs).toBe(2)
    expect(forced.status).toBe('completed')
    expect(
      await prisma.jobRun.count({ where: { jobName: 'forced-job', facilityId } }),
    ).toBe(1)
  })

  it('finishes partial when an item fails, rather than failing the run', async () => {
    const result = await runJob(
      { jobName: 'partial-job', facilityId, businessDate },
      async ({ recordItem }) => {
        recordItem({ itemId: 'lease-1', ok: true })
        recordItem({ itemId: 'lease-2', ok: false, message: 'card expired' })
      },
    )

    expect(result.run.status).toBe('partial')
    expect(result.run.itemsOk).toBe(1)
    expect(result.run.itemsFailed).toBe(1)
    expect(result.run.details).toMatchObject({
      items: [
        { itemId: 'lease-1', ok: true },
        { itemId: 'lease-2', ok: false, message: 'card expired' },
      ],
    })
  })

  it('records a thrown handler as failed with the message', async () => {
    const result = await runJob(
      { jobName: 'throwing-job', facilityId, businessDate },
      async () => {
        throw new Error('database unreachable')
      },
    )

    expect(result.run.status).toBe('failed')
    expect(result.run.lastError).toContain('database unreachable')
    expect(result.run.finishedAt).not.toBeNull()
  })

  it('reports the latest completed run for catch-up', async () => {
    await runJob({ jobName: 'catchup-job', facilityId, businessDate }, async () => {})
    const last = await lastSuccessfulRun('catchup-job', facilityId)
    expect(last?.businessDate.toISOString().slice(0, 10)).toBe('2026-07-30')
  })
})
