import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { raiseReviewRequests } from '../apps/web/lib/reviews/request-job'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'

// B-071 / PRD 04 US-7 AC1/AC2, against real rows.
//
// The properties worth a database: the delay is measured in the FACILITY's
// timezone, "once per tenancy" survives a catch-up run, a facility with no
// review link never sends but catches up the moment one is set, and the
// suppress-marketing hold actually blocks delivery.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let unitId = ''
let unitTypeId = ''
let staffId = ''
let leaseCounter = 0

const sends: { to: string; subject: string; body: string }[] = []

function fakeProvider(): provider.MessageProvider {
  return {
    name: 'test',
    async sendEmail(email) {
      sends.push({ to: email.to, subject: email.subject ?? '', body: email.text ?? '' })
      return { ok: true, providerMessageId: `test_${sends.length}` }
    },
  }
}

async function makeLease(startDate: Date): Promise<string> {
  leaseCounter += 1
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `R${leaseCounter}-${suffix.slice(0, 4)}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status: 'active',
      startDate,
      billingDay: 1,
      monthlyRateCents: 12_900,
    },
  })
  return lease.id
}

async function processLatestReviewRequest(): Promise<void> {
  const event = await prisma.domainEvent.findFirstOrThrow({
    where: { name: 'review.requested', facilityId },
    orderBy: { occurredAt: 'desc' },
  })
  await processCommsEvent(event)
}

// B-080 found this: every test below sends a MARKETING message, and
// `deliverForRule` refuses those during quiet hours (FR-MSG-5 — before 8am or
// from 9pm, facility-local) against the REAL wall clock. So this suite passed
// between 8am and 9pm Central and failed outside it, which is why a full run at
// 22:00 reported four "expected [] to have a length of 1" failures that had
// nothing to do with the code under test. The clock is pinned to the middle of
// a working day so the suite means the same thing at every hour.
//
// Only `Date` is faked. Faking timers wholesale would hang the Prisma round
// trips these tests are made of.
const CLOCK = new Date('2026-07-01T17:00:00.000Z') // 12:00 in America/Chicago

describeDb('the review-request job', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(CLOCK)

    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Review Requests ${suffix}`,
        slug: `review-req-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
        reviewRequestDelayDays: 7,
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `review-req-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    unitId = (await prisma.unit.create({ data: { facilityId, unitTypeId, number: `U-${suffix.slice(0, 4)}` } })).id

    const staff = await prisma.staffUser.create({
      data: { email: `review-req-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
  })

  afterEach(async () => {
    sends.length = 0
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.leaseHold.deleteMany({ where: { lease: { facilityId } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId, id: { not: unitId } } })
    await prisma.facility.update({ where: { id: facilityId }, data: { googleReviewUrl: null, reviewRequestDelayDays: 7 } })
  })

  afterAll(async () => {
    vi.useRealTimers()

    if (!hasDatabase) return
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('skips the whole facility with no Google review link — nothing raised, nothing stamped', async () => {
    const leaseId = await makeLease(new Date('2026-06-01T12:00:00Z'))

    const result = await raiseReviewRequests(facilityId, new Date('2026-06-08T00:00:00Z'))
    expect(result).toEqual({ raised: 0, skippedNoLink: true })

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
    expect(lease.reviewRequestSentAt).toBeNull()
  })

  it('is not due before the delay has elapsed', async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { googleReviewUrl: 'https://g.page/r/test/review' } })
    await makeLease(new Date('2026-06-01T12:00:00Z'))

    const result = await raiseReviewRequests(facilityId, new Date('2026-06-05T00:00:00Z'))
    expect(result.raised).toBe(0)
  })

  it('raises the request once the delay has elapsed, in the facility’s own timezone', async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { googleReviewUrl: 'https://g.page/r/test/review' } })
    // 2026-06-01 18:00 UTC is 13:00 in America/Chicago (CDT) — same local day.
    const leaseId = await makeLease(new Date('2026-06-01T18:00:00Z'))

    const result = await raiseReviewRequests(facilityId, new Date('2026-06-08T18:00:00Z'))
    expect(result.raised).toBe(1)

    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
    expect(lease.reviewRequestSentAt).not.toBeNull()
    expect(await prisma.domainEvent.count({ where: { name: 'review.requested', entityId: leaseId } })).toBe(1)
  })

  it('never raises a second request for the same tenancy — a catch-up run is a no-op', async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { googleReviewUrl: 'https://g.page/r/test/review' } })
    await makeLease(new Date('2026-06-01T18:00:00Z'))

    await raiseReviewRequests(facilityId, new Date('2026-06-08T18:00:00Z'))
    const second = await raiseReviewRequests(facilityId, new Date('2026-06-09T18:00:00Z'))

    expect(second.raised).toBe(0)
    expect(await prisma.domainEvent.count({ where: { name: 'review.requested', facilityId } })).toBe(1)
  })

  it('catches up a tenancy that already cleared the delay once the link is finally set', async () => {
    // No link at day 7 — nothing raised, nothing stamped (the first test's
    // scenario). Weeks later an operator adds the link.
    const leaseId = await makeLease(new Date('2026-06-01T18:00:00Z'))
    await raiseReviewRequests(facilityId, new Date('2026-06-08T18:00:00Z'))
    expect(await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })).toMatchObject({
      reviewRequestSentAt: null,
    })

    await prisma.facility.update({ where: { id: facilityId }, data: { googleReviewUrl: 'https://g.page/r/test/review' } })
    const result = await raiseReviewRequests(facilityId, new Date('2026-06-20T18:00:00Z'))

    expect(result.raised).toBe(1)
  })

  it('sends the actual email with the review link, once dispatched', async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { googleReviewUrl: 'https://g.page/r/test/review' } })
    await makeLease(new Date('2026-06-01T18:00:00Z'))
    await raiseReviewRequests(facilityId, new Date('2026-06-08T18:00:00Z'))
    await processLatestReviewRequest()

    expect(sends).toHaveLength(1)
    expect(sends[0].to).toBe(`review-req-${suffix}@example.com`)
    expect(sends[0].body).toContain('https://g.page/r/test/review')
  })

  it('is suppressed by a marketing hold, and does not retry later', async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { googleReviewUrl: 'https://g.page/r/test/review' } })
    const leaseId = await makeLease(new Date('2026-06-01T18:00:00Z'))
    await prisma.leaseHold.create({
      data: {
        leaseId,
        type: 'do_not_contact',
        reason: 'Asked us not to contact them.',
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
        placedByStaffId: staffId,
      },
    })

    await raiseReviewRequests(facilityId, new Date('2026-06-08T18:00:00Z'))
    await processLatestReviewRequest()

    expect(sends).toEqual([])
    // Still stamped — AC2's "max 1 per tenancy" is used up by the suppressed
    // attempt, not retried once the hold is lifted.
    const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
    expect(lease.reviewRequestSentAt).not.toBeNull()
  })

  it('sends nothing to a tenant who has already moved out', async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { googleReviewUrl: 'https://g.page/r/test/review' } })
    const leaseId = await makeLease(new Date('2026-06-01T18:00:00Z'))
    await raiseReviewRequests(facilityId, new Date('2026-06-08T18:00:00Z'))
    await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })

    await processLatestReviewRequest()
    expect(sends).toEqual([])
  })

  it('respects a facility’s own configured delay, not the default', async () => {
    await prisma.facility.update({
      where: { id: facilityId },
      data: { googleReviewUrl: 'https://g.page/r/test/review', reviewRequestDelayDays: 14 },
    })
    await makeLease(new Date('2026-06-01T18:00:00Z'))

    const early = await raiseReviewRequests(facilityId, new Date('2026-06-08T18:00:00Z'))
    expect(early.raised).toBe(0)

    const onTime = await raiseReviewRequests(facilityId, new Date('2026-06-15T18:00:00Z'))
    expect(onTime.raised).toBe(1)
  })
})
