import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { captureLead } from '../apps/web/lib/marketing/lead-capture'
import { raiseLeadDripSteps } from '../apps/web/lib/leads/drip-job'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'

// B-072 / PRD 04 §3.7 US-13/US-14, against real rows and the real seeded
// catalog.
//
// The properties worth a database: step 1 fires immediately from capture and
// only with consent, steps 2/3 respect the facility-local delay and "no
// consent, no sequence", step 3 is truly conditional on a live promo, an exit
// (reserved/lost) stops the drip, and unsubscribing actually suppresses the
// address for every future marketing send — including a different lead
// drip sequence entirely.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

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

let leadCounter = 0
function nextEmail(): string {
  leadCounter += 1
  return `lead-${suffix}-${leadCounter}@example.com`
}

async function submitLead(overrides: { marketingConsent?: boolean; unitTypeId?: string | null } = {}) {
  const result = await captureLead(
    {
      facilityId,
      name: 'Ada Renter',
      email: nextEmail(),
      phone: '',
      unitTypeId: overrides.unitTypeId === undefined ? unitTypeId : overrides.unitTypeId,
      kind: 'quote',
      marketingConsent: overrides.marketingConsent ?? true,
    },
    {
      firstTouch: null,
      lastTouch: null,
      landingPage: null,
      referrer: null,
      gclid: null,
      selfHost: null,
      ip: null,
    },
  )
  if (!result.ok) throw new Error('capture failed: ' + JSON.stringify(result))
  return result.leadId
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function processLatestDripEvent(): Promise<void> {
  const event = await prisma.domainEvent.findFirstOrThrow({
    where: { name: 'lead.drip_step', facilityId },
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

describeDb('the lead drip', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(CLOCK)

    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Lead Drip ${suffix}`,
        slug: `lead-drip-${suffix}`,
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

  afterEach(async () => {
    sends.length = 0
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.consent.deleteMany({ where: { lead: { facilityId } } })
    await prisma.leadActivity.deleteMany({ where: { lead: { facilityId } } })
    await prisma.lead.deleteMany({ where: { facilityId } })
    await prisma.suppression.deleteMany({ where: { address: { contains: suffix } } })
    await prisma.promotion.deleteMany({ where: { name: { contains: suffix } } })
  })

  afterAll(async () => {
    vi.useRealTimers()

    if (!hasDatabase) return
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.consent.deleteMany({ where: { lead: { facilityId } } })
    await prisma.leadActivity.deleteMany({ where: { lead: { facilityId } } })
    await prisma.lead.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  describe('step 1 — immediate, consent-gated (US-13/US-14)', () => {
    it('fires immediately on capture when consent is given', async () => {
      const leadId = await submitLead({ marketingConsent: true })

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })
      expect(lead.dripStep).toBe(1)
      expect(await prisma.domainEvent.count({ where: { name: 'lead.drip_step', entityId: leadId } })).toBe(1)
    })

    it('never enters the drip without consent — "no consent, no sequence"', async () => {
      const leadId = await submitLead({ marketingConsent: false })

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })
      expect(lead.dripStep).toBe(0)
    })

    it('never enters for a lead with no quoted size', async () => {
      const leadId = await submitLead({ marketingConsent: true, unitTypeId: null })
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })
      expect(lead.dripStep).toBe(0)
    })

    it('records the consent, disclosure version and source', async () => {
      const leadId = await submitLead({ marketingConsent: true })
      const consent = await prisma.consent.findFirstOrThrow({ where: { leadId, channel: 'marketing_email' } })
      expect(consent.state).toBe('granted')
      expect(consent.source).toBe('lead_form')
      expect(consent.disclosureVersion).toBeTruthy()
    })

    it('sends the quote-recap email, with the current price', async () => {
      const leadId = await submitLead({ marketingConsent: true })
      await processLatestDripEvent()

      expect(sends).toHaveLength(1)
      expect(sends[0].body).toContain('$129.00')
      // US-13 AC2: every marketing email carries a working unsubscribe link.
      expect(sends[0].body).toMatch(/\/unsubscribe\//)
    })
  })

  describe('steps 2 & 3 — the day-counted job', () => {
    it('does not raise step 2 before 2 days have passed', async () => {
      const leadId = await submitLead()
      await prisma.lead.update({ where: { id: leadId }, data: { createdAt: new Date('2026-07-01T18:00:00Z') } })

      const result = await raiseLeadDripSteps(facilityId, d('2026-07-02'))
      expect(result.raised).toBe(0)
    })

    it('raises step 2 once 2 days have passed', async () => {
      const leadId = await submitLead()
      await prisma.lead.update({ where: { id: leadId }, data: { createdAt: new Date('2026-07-01T18:00:00Z') } })

      const result = await raiseLeadDripSteps(facilityId, d('2026-07-03'))
      expect(result.raised).toBe(1)

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })
      expect(lead.dripStep).toBe(2)
    })

    it('does not raise step 3 with no live promo — "only if an eligible promo is live"', async () => {
      const leadId = await submitLead()
      await prisma.lead.update({
        where: { id: leadId },
        data: { createdAt: new Date('2026-07-01T18:00:00Z'), dripStep: 2 },
      })

      const result = await raiseLeadDripSteps(facilityId, d('2026-07-06'))
      expect(result.raised).toBe(0)

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })
      expect(lead.dripStep).toBe(2)
    })

    it('raises step 3 when a promo is live, and it sends with the promo terms', async () => {
      await prisma.promotion.create({
        data: {
          name: `Drip promo ${suffix}`,
          type: 'percent_off',
          value: 50,
          durationPeriods: 1,
          status: 'active',
          displayMode: 'auto',
          facilityIds: [facilityId],
        },
      })
      const leadId = await submitLead()
      await prisma.lead.update({
        where: { id: leadId },
        data: { createdAt: new Date('2026-07-01T18:00:00Z'), dripStep: 2 },
      })

      const result = await raiseLeadDripSteps(facilityId, d('2026-07-06'))
      expect(result.raised).toBe(1)

      await processLatestDripEvent()
      expect(sends).toHaveLength(1)
      expect(sends[0].body.toLowerCase()).toContain('50%')
    })

    it('never raises the same step twice — a catch-up run is a no-op', async () => {
      const leadId = await submitLead()
      await prisma.lead.update({ where: { id: leadId }, data: { createdAt: new Date('2026-07-01T18:00:00Z') } })

      await raiseLeadDripSteps(facilityId, d('2026-07-03'))
      const second = await raiseLeadDripSteps(facilityId, d('2026-07-04'))

      expect(second.raised).toBe(0)
      expect(await prisma.domainEvent.count({ where: { name: 'lead.drip_step', entityId: leadId } })).toBe(2) // step 1 + step 2
    })

    it('stops for a lead that reserved — US-14 AC1’s exit', async () => {
      const leadId = await submitLead()
      await prisma.lead.update({
        where: { id: leadId },
        data: { createdAt: new Date('2026-07-01T18:00:00Z'), status: 'reserved' },
      })

      const result = await raiseLeadDripSteps(facilityId, d('2026-07-03'))
      expect(result.raised).toBe(0)
    })

    it('stops for a lead marked lost', async () => {
      const leadId = await submitLead()
      await prisma.lead.update({
        where: { id: leadId },
        data: { createdAt: new Date('2026-07-01T18:00:00Z'), status: 'lost' },
      })

      const result = await raiseLeadDripSteps(facilityId, d('2026-07-03'))
      expect(result.raised).toBe(0)
    })

    it('stops once consent is withdrawn, even mid-sequence', async () => {
      const leadId = await submitLead()
      await prisma.lead.update({ where: { id: leadId }, data: { createdAt: new Date('2026-07-01T18:00:00Z') } })
      await prisma.consent.create({
        data: { leadId, channel: 'marketing_email', state: 'revoked', source: 'unsubscribe_link' },
      })

      const result = await raiseLeadDripSteps(facilityId, d('2026-07-03'))
      expect(result.raised).toBe(0)
    })
  })

  describe('unsubscribing', () => {
    it('suppresses the address for every future marketing send, not just this sequence', async () => {
      // Suppressed BEFORE any send — isolates the suppression check from
      // FR-MSG-5's own daily cap, which would otherwise also explain a
      // second send not going out.
      const leadId = await submitLead()
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })
      const address = lead.email!.toLowerCase()

      await prisma.suppression.create({ data: { channel: 'email', address, reason: 'unsubscribe' } })
      await prisma.lead.update({ where: { id: leadId }, data: { createdAt: new Date('2026-07-01T18:00:00Z') } })

      await raiseLeadDripSteps(facilityId, d('2026-07-03'))
      await processLatestDripEvent()

      expect(sends).toEqual([])
      const message = await prisma.message.findFirst({
        where: { facilityId, toAddress: address, templateKey: 'lead_drip_value' },
      })
      expect(message?.status).toBe('suppressed')
    })
  })
})
