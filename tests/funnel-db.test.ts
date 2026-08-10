import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { track } from '../apps/web/lib/analytics/track'
import { funnelReport } from '../apps/web/lib/analytics/funnel'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-069 / PRD 04 US-15 AC4, FR-AN-2, against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''

const RANGE = { from: new Date('2026-05-01T00:00:00Z'), to: new Date('2026-06-01T00:00:00Z') }

function actor(permissions: string[] = ['reports:operational']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function event(
  name: Parameters<typeof track>[0]['event'],
  sessionId: string,
  extras: Partial<Parameters<typeof track>[0]> = {},
  at = new Date('2026-05-15T12:00:00Z'),
) {
  await track({ event: name, sessionId, facilityId, ...extras })
  await prisma.analyticsEvent.updateMany({
    where: { sessionId, name, occurredAt: { gt: new Date(Date.now() - 60_000) } },
    data: { occurredAt: at },
  })
}

describeDb('the funnel', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Funnel ${suffix}`,
        slug: `funnel-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `funnel-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
  })

  beforeEach(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.analyticsEvent.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('counts distinct sessions, not events', async () => {
    // One person reloading six times is one session. Counting events would make
    // the top of the funnel look wide and every rate below it look terrible.
    for (let index = 0; index < 6; index += 1) {
      await event('page_view', `s-${suffix}-1`)
    }
    await event('page_view', `s-${suffix}-2`)

    const report = await funnelReport(actor(), RANGE)
    expect(report.steps[0].count).toBe(2)
  })

  it('walks the whole funnel and computes conversion at each step', async () => {
    await event('page_view', `s-${suffix}-a`)
    await event('page_view', `s-${suffix}-b`)
    await event('page_view', `s-${suffix}-c`)
    await event('page_view', `s-${suffix}-d`)
    await event('quote_form_submit', `s-${suffix}-a`)
    await event('quote_form_submit', `s-${suffix}-b`)
    await event('reservation_started', `s-${suffix}-a`)
    await event('reservation_completed', `s-${suffix}-a`)
    await event('move_in_completed', `s-${suffix}-a`)

    const report = await funnelReport(actor(), RANGE)
    expect(report.steps.map((step) => step.count)).toEqual([4, 2, 1, 1, 1])
    expect(report.steps[1].fromPrevious).toBeCloseTo(0.5)
    expect(report.steps[4].fromTop).toBeCloseTo(0.25)
  })

  it('attributes recovered move-ins from the abandonment sequence (AC4)', async () => {
    await event('move_in_completed', `s-${suffix}-recovered`, {
      properties: { recoveredByAbandonment: true },
    })
    await event('move_in_completed', `s-${suffix}-direct`, {
      properties: { recoveredByAbandonment: false },
    })

    const report = await funnelReport(actor(), RANGE)
    expect(report.abandonmentRecovery).toEqual({ moveIns: 2, recovered: 1 })
  })

  it('filters by channel and offers only channels that exist', async () => {
    await event('page_view', `s-${suffix}-paid`, { channel: 'paid_search' })
    await event('page_view', `s-${suffix}-org`, { channel: 'organic' })
    await event('quote_form_submit', `s-${suffix}-paid`, { channel: 'paid_search' })

    const all = await funnelReport(actor(), RANGE)
    expect(all.steps[0].count).toBe(2)
    expect(all.channels).toEqual(['organic', 'paid_search'])

    const paid = await funnelReport(actor(), { ...RANGE, channel: 'paid_search' })
    expect(paid.steps[0].count).toBe(1)
    expect(paid.steps[1].count).toBe(1)
  })

  it('respects the date range on both ends', async () => {
    await event('page_view', `s-${suffix}-early`, {}, new Date('2026-04-30T23:00:00Z'))
    await event('page_view', `s-${suffix}-inside`, {}, new Date('2026-05-15T12:00:00Z'))
    await event('page_view', `s-${suffix}-late`, {}, new Date('2026-06-01T00:00:00Z'))

    // Half-open: the `to` boundary is exclusive, like every other range here.
    expect((await funnelReport(actor(), RANGE)).steps[0].count).toBe(1)
  })

  it('shows nothing to a staffer without the reports key', async () => {
    await event('page_view', `s-${suffix}-x`)
    const report = await funnelReport(actor(['tenants:view']), RANGE)
    expect(report.steps[0].count).toBe(0)
  })

  describe('track()', () => {
    it('refuses an event outside the catalog rather than inventing a row', async () => {
      await track({ event: 'not_a_real_event' as never, sessionId: `s-${suffix}-bad`, facilityId })
      expect(await prisma.analyticsEvent.count({ where: { facilityId } })).toBe(0)
    })

    it('never throws, whatever it is handed', async () => {
      // Analytics must not be able to break the thing it is measuring.
      await expect(
        track({ event: 'page_view', sessionId: 's', facilityId: 'does-not-exist' }),
      ).resolves.toBeUndefined()
    })

    it('strips anything that looks like a person out of the properties', async () => {
      await event('quote_form_submit', `s-${suffix}-pii`, {
        properties: {
          email: 'ada@example.com',
          note: 'x'.repeat(500),
          size: '10x10',
          count: 3,
          flagged: true,
        },
      })

      const row = await prisma.analyticsEvent.findFirstOrThrow({
        where: { facilityId, sessionId: `s-${suffix}-pii` },
      })
      const properties = row.properties as Record<string, unknown>
      // A property bag is where PII arrives by accident.
      expect(properties.email).toBeUndefined()
      expect(String(properties.note).length).toBeLessThanOrEqual(100)
      expect(properties.size).toBe('10x10')
      expect(properties.count).toBe(3)
      expect(properties.flagged).toBe(true)
    })
  })
})
