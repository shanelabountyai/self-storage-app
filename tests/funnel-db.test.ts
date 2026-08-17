import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { track } from '../apps/web/lib/analytics/track'
import { funnelReport } from '../apps/web/lib/analytics/funnel'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-069 / PRD 04 US-15 AC4, FR-AN-2, against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''

const RANGE = { from: new Date('2026-05-01T00:00:00Z'), to: new Date('2026-06-01T00:00:00Z') }

function actor(permissions: PermissionKey[] = ['reports:operational']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(permissions),
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
    // B-082 part 4 widened this from one sequence to a catalog. The shape
    // changed; the fact it asserts did not.
    expect(report.sequenceMoveIns).toBe(2)
    expect(report.sequences.find((sequence) => sequence.key === 'abandonment')?.moveIns).toBe(1)
  })

  // ── B-082 part 4 ───────────────────────────────────────────────────────

  it('credits the lead drip separately from the abandonment sequence', async () => {
    await event('move_in_completed', `s-${suffix}-both`, {
      properties: { recoveredByAbandonment: true, fromLeadDrip: true },
    })
    await event('move_in_completed', `s-${suffix}-drip`, {
      properties: { recoveredByAbandonment: false, fromLeadDrip: true },
    })
    await event('move_in_completed', `s-${suffix}-neither`, { properties: {} })

    const report = await funnelReport(actor(), RANGE)
    const by = new Map(report.sequences.map((sequence) => [sequence.key, sequence.moveIns]))
    // Deliberately NOT exclusive: one renter is in both rows, so the rows sum
    // to more than the move-in count and the report says so in words.
    expect(by.get('abandonment')).toBe(1)
    expect(by.get('lead_drip')).toBe(2)
    expect(report.sequenceMoveIns).toBe(3)
  })

  it('names every sequence even when none of them brought anybody back', async () => {
    // A missing row reads as "we do not measure that"; a zero reads as "it did
    // not work", which is the true statement.
    const report = await funnelReport(actor(), RANGE)
    expect(report.sequences.map((sequence) => sequence.key)).toEqual(['abandonment', 'lead_drip'])
  })

  it('splits the funnel by source and medium, and the rows foot to the total', async () => {
    await event('page_view', `s-${suffix}-cpc-1`, { utmSource: 'google', utmMedium: 'cpc' })
    await event('page_view', `s-${suffix}-cpc-2`, { utmSource: 'google', utmMedium: 'cpc' })
    await event('page_view', `s-${suffix}-social`, { utmSource: 'facebook', utmMedium: 'social' })
    await event('page_view', `s-${suffix}-bare`)
    await event('move_in_completed', `s-${suffix}-cpc-1`, { utmSource: 'google', utmMedium: 'cpc' })

    const report = await funnelReport(actor(), RANGE)

    // The property that makes a breakdown worth reading: every session is in
    // exactly one row, so the columns add up to the funnel above them. A
    // breakdown that does not foot is two sets of numbers to reconcile.
    const sessions = report.bySourceMedium.reduce((sum, row) => sum + row.counts.sessions, 0)
    expect(sessions).toBe(report.steps[0].count)
    const moveIns = report.bySourceMedium.reduce((sum, row) => sum + row.counts.move_ins, 0)
    expect(moveIns).toBe(report.steps[4].count)

    const cpc = report.bySourceMedium.find(
      (row) => row.source === 'google' && row.medium === 'cpc',
    )
    expect(cpc?.counts.sessions).toBe(2)
    expect(cpc?.counts.move_ins).toBe(1)
  })

  it('keeps untagged traffic as its own row rather than dropping it', async () => {
    await event('page_view', `s-${suffix}-untagged`)

    const report = await funnelReport(actor(), RANGE)
    const untagged = report.bySourceMedium.find((row) => row.source === null && row.medium === null)
    // Normally the biggest row on the whole report. Dropping it would make
    // every percentage in the table wrong and none of them obviously so.
    expect(untagged?.counts.sessions).toBeGreaterThan(0)
  })

  it('attributes a session by its FIRST event in the range, not its last', async () => {
    // D-61. A session that arrives on an ad and later fires an untagged event
    // belongs to the ad — and, more importantly, belongs to exactly one row
    // whichever way it is decided.
    const session = `s-${suffix}-firsttouch`
    await event('page_view', session, { utmSource: 'bing', utmMedium: 'cpc' }, new Date('2026-05-10T09:00:00Z'))
    await event('quote_form_submit', session, {}, new Date('2026-05-11T09:00:00Z'))

    const report = await funnelReport(actor(), RANGE)
    const bing = report.bySourceMedium.find((row) => row.source === 'bing')
    expect(bing?.counts.sessions).toBe(1)
    expect(bing?.counts.leads).toBe(1)
  })

  it('offers only the sources and mediums that exist in the range', async () => {
    await event('page_view', `s-${suffix}-listed`, { utmSource: 'yelp', utmMedium: 'referral' })

    const report = await funnelReport(actor(), RANGE)
    // Same rule the channel dropdown already follows: a control cannot offer a
    // value that produces an empty report.
    expect(report.sources).toContain('yelp')
    expect(report.mediums).toContain('referral')
    expect(report.sources).not.toContain('nextdoor')
  })

  it('filters by source and medium, which nothing could set until part 4', async () => {
    await event('page_view', `s-${suffix}-f-a`, { utmSource: 'google', utmMedium: 'cpc' })
    await event('page_view', `s-${suffix}-f-b`, { utmSource: 'google', utmMedium: 'organic' })

    const cpcOnly = await funnelReport(actor(), { ...RANGE, utmSource: 'google', utmMedium: 'cpc' })
    expect(cpcOnly.steps[0].count).toBe(1)
    expect(cpcOnly.bySourceMedium).toHaveLength(1)
    expect(cpcOnly.bySourceMedium[0].medium).toBe('cpc')
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
