import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { reissueCheckoutToken, sessionByToken, startCheckout } from '../apps/web/lib/checkout/session'
import { raiseAbandonmentFollowUps, raiseAbandonmentStep } from '../apps/web/lib/checkout/abandonment-job'
import { mintCheckoutResumeToken, verifyCheckoutResumeToken } from '../apps/web/lib/checkout/resume-token'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'

// B-073 / PRD 04 §3.6 US-9, FR-LEAD-4, against real rows and the real seeded
// catalog.
//
// The properties worth a database: the job only raises after the configured
// delay and only with marketing consent, an ordinary lapsed lock is not an
// exit but a completed checkout is, a step never raises twice, the send
// carries the exact unit/quote and a working resume link, step 3 is truly
// conditional on a live promo, and the resume token actually resumes the
// session it names.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const slug = `abandon-${suffix}`

let facilityId = ''
let unitTypeId = ''

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

let tenantCounter = 0
function nextEmail(): string {
  tenantCounter += 1
  return `abandon-${suffix}-${tenantCounter}@example.com`
}

const T0 = new Date('2026-07-01T12:00:00.000Z')
const plusMinutes = (mins: number) => new Date(T0.getTime() + mins * 60_000)

async function startAbandonable(overrides: { consent?: boolean } = {}) {
  const started = await startCheckout({ facilityId, unitTypeId, quotedRateCents: 12_900 })
  if (!started.ok) throw new Error('unreachable')
  const email = nextEmail()
  const tenant = await prisma.tenant.create({ data: { email, firstName: 'Ada', lastName: 'Renter' } })
  await prisma.checkoutSession.update({
    where: { id: started.sessionId },
    data: { tenantId: tenant.id, email, createdAt: T0 },
  })
  if (overrides.consent !== false) {
    await prisma.consent.create({
      data: { tenantId: tenant.id, channel: 'marketing_email', state: 'granted', source: 'checkout_step_1' },
    })
  }
  return { sessionId: started.sessionId, token: started.token, tenantId: tenant.id, email }
}

async function processLatestAbandonmentEvent(): Promise<void> {
  const event = await prisma.domainEvent.findFirstOrThrow({
    where: { name: 'checkout.abandonment_step', facilityId },
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

describeDb('the abandoned-checkout follow-up', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(CLOCK)

    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Abandon ${suffix}`,
        slug,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    await prisma.unitTypeRate.create({
      data: {
        facilityId,
        unitTypeId,
        streetRateCents: 14_900,
        webRateCents: 12_900,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      },
    })
  })

  beforeAll(async () => {
    for (let i = 0; i < 10; i += 1) {
      await prisma.unit.create({ data: { facilityId, unitTypeId, number: `U-${i}-${suffix}`, status: 'available' } })
    }
  })

  afterEach(async () => {
    sends.length = 0
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.consent.deleteMany({ where: { tenant: { email: { contains: suffix } } } })
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { email: { contains: suffix } } })
    await prisma.promotion.deleteMany({ where: { name: { contains: suffix } } })
    await prisma.unit.updateMany({ where: { facilityId }, data: { status: 'available' } })
    await prisma.facility.update({ where: { id: facilityId }, data: { abandonmentFollowUpHours: [1, 24, 72] } })
  })

  afterAll(async () => {
    vi.useRealTimers()

    if (!hasDatabase) return
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { email: { contains: suffix } } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  describe('raising (AC1/AC2/AC3)', () => {
    it('does not raise before the configured delay', async () => {
      const { sessionId } = await startAbandonable()
      const result = await raiseAbandonmentFollowUps(plusMinutes(30), facilityId)
      expect(result.raised).toBe(0)
      const session = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } })
      expect(session.abandonmentSequenceStep).toBe(0)
    })

    it('raises step 1 once the default 1-hour delay has passed', async () => {
      const { sessionId, tenantId } = await startAbandonable()
      const result = await raiseAbandonmentFollowUps(plusMinutes(65), facilityId)
      expect(result.raised).toBe(1)

      const session = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } })
      expect(session.abandonmentSequenceStep).toBe(1)
      expect(
        await prisma.domainEvent.count({ where: { name: 'checkout.abandonment_step', entityId: tenantId } }),
      ).toBe(1)
    })

    it('never enters without marketing consent — "no consent, no sequence"', async () => {
      const { sessionId } = await startAbandonable({ consent: false })
      const result = await raiseAbandonmentFollowUps(plusMinutes(65), facilityId)
      expect(result.raised).toBe(0)
      const session = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } })
      expect(session.abandonmentSequenceStep).toBe(0)
    })

    it('stops once the checkout completes', async () => {
      const { sessionId } = await startAbandonable()
      await prisma.checkoutSession.update({ where: { id: sessionId }, data: { status: 'completed' } })
      const result = await raiseAbandonmentFollowUps(plusMinutes(65), facilityId)
      expect(result.raised).toBe(0)
    })

    it('still raises once the 30-minute lock has lapsed — that is the ordinary case by the time an hour has passed, not an exit', async () => {
      const { sessionId } = await startAbandonable()
      await prisma.checkoutSession.update({ where: { id: sessionId }, data: { status: 'expired' } })
      const result = await raiseAbandonmentFollowUps(plusMinutes(65), facilityId)
      expect(result.raised).toBe(1)
    })

    it('never raises the same step twice — a catch-up run is a no-op', async () => {
      const { sessionId } = await startAbandonable()
      await raiseAbandonmentFollowUps(plusMinutes(65), facilityId)
      const second = await raiseAbandonmentFollowUps(plusMinutes(70), facilityId)

      expect(second.raised).toBe(0)
      expect(await prisma.domainEvent.count({ where: { name: 'checkout.abandonment_step', facilityId } })).toBe(1)
      const session = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } })
      expect(session.abandonmentSequenceStep).toBe(1)
    })

    it('follows a per-facility schedule, one step per configured offset', async () => {
      await prisma.facility.update({ where: { id: facilityId }, data: { abandonmentFollowUpHours: [1, 2, 3] } })
      const { sessionId } = await startAbandonable()

      await raiseAbandonmentFollowUps(plusMinutes(65), facilityId)
      expect((await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } })).abandonmentSequenceStep).toBe(1)

      // Not yet 2 hours — no change.
      await raiseAbandonmentFollowUps(plusMinutes(90), facilityId)
      expect((await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } })).abandonmentSequenceStep).toBe(1)

      await raiseAbandonmentFollowUps(plusMinutes(125), facilityId)
      expect((await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } })).abandonmentSequenceStep).toBe(2)

      await raiseAbandonmentFollowUps(plusMinutes(185), facilityId)
      expect((await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } })).abandonmentSequenceStep).toBe(3)
    })
  })

  describe('sending (AC1)', () => {
    it('sends step 1 with the exact unit size, quoted price and a working resume link', async () => {
      await startAbandonable()
      await raiseAbandonmentFollowUps(plusMinutes(65), facilityId)
      await processLatestAbandonmentEvent()

      expect(sends).toHaveLength(1)
      expect(sends[0].body).toContain('10x10')
      expect(sends[0].body).toContain('$129.00')
      expect(sends[0].body).toMatch(/\/checkout\/resume\//)
    })

    it('the resume link actually resumes the session it was minted for', async () => {
      const { sessionId } = await startAbandonable()
      await raiseAbandonmentFollowUps(plusMinutes(65), facilityId)
      await processLatestAbandonmentEvent()

      const match = sends[0].body.match(/\/checkout\/resume\/(\S+)/)
      expect(match).toBeTruthy()
      const verdict = verifyCheckoutResumeToken(match![1])
      expect(verdict).toMatchObject({ valid: true, sessionId })
    })

    it('step 3 does not send with no live promo — it renders as a no-op, not a promo-less repeat', async () => {
      const { sessionId, tenantId } = await startAbandonable()
      await prisma.checkoutSession.update({ where: { id: sessionId }, data: { abandonmentSequenceStep: 2 } })
      await raiseAbandonmentStep(sessionId, facilityId, tenantId, 3)
      await processLatestAbandonmentEvent()

      expect(sends).toEqual([])
      const message = await prisma.message.findFirst({
        where: { facilityId, templateKey: 'checkout_abandonment_3' },
      })
      expect(message?.status).toBe('failed')
    })

    it('step 3 sends with the promo terms when a promo is live', async () => {
      await prisma.promotion.create({
        data: {
          name: `Abandon promo ${suffix}`,
          type: 'percent_off',
          value: 50,
          durationPeriods: 1,
          status: 'active',
          displayMode: 'auto',
          facilityIds: [facilityId],
        },
      })
      const { sessionId, tenantId } = await startAbandonable()
      await prisma.checkoutSession.update({ where: { id: sessionId }, data: { abandonmentSequenceStep: 2 } })
      await raiseAbandonmentStep(sessionId, facilityId, tenantId, 3)
      await processLatestAbandonmentEvent()

      expect(sends).toHaveLength(1)
      expect(sends[0].body.toLowerCase()).toContain('50%')
    })

    it('stops sending once consent is withdrawn, even mid-sequence', async () => {
      const { tenantId } = await startAbandonable()
      await raiseAbandonmentFollowUps(plusMinutes(65), facilityId)
      await prisma.consent.create({
        data: { tenantId, channel: 'marketing_email', state: 'revoked', source: 'unsubscribe_link' },
      })

      await processLatestAbandonmentEvent()
      expect(sends).toEqual([])
    })

    it('stops sending once the checkout has completed in the gap between raise and send', async () => {
      const { sessionId } = await startAbandonable()
      await raiseAbandonmentFollowUps(plusMinutes(65), facilityId)
      await prisma.checkoutSession.update({ where: { id: sessionId }, data: { status: 'completed' } })

      await processLatestAbandonmentEvent()
      expect(sends).toEqual([])
    })
  })

  describe('the resume token', () => {
    it('reissues a working session token and retires the old one', async () => {
      const { sessionId, token } = await startAbandonable()

      const fresh = await reissueCheckoutToken(sessionId)
      expect(fresh).toBeTruthy()
      expect(fresh).not.toBe(token)

      expect(await sessionByToken(fresh!)).toMatchObject({ id: sessionId })
      expect(await sessionByToken(token)).toBeNull()
    })

    it('refuses to reissue for an already-completed checkout', async () => {
      const { sessionId } = await startAbandonable()
      await prisma.checkoutSession.update({ where: { id: sessionId }, data: { status: 'completed' } })

      expect(await reissueCheckoutToken(sessionId)).toBeNull()
    })

    it('rejects a malformed token', () => {
      expect(verifyCheckoutResumeToken('not-a-real-token').valid).toBe(false)
    })

    it('round-trips a minted token back to its session id', async () => {
      const { sessionId } = await startAbandonable()
      const token = mintCheckoutResumeToken(sessionId)
      expect(verifyCheckoutResumeToken(token)).toMatchObject({ valid: true, sessionId })
    })
  })
})
