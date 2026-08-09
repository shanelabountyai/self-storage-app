import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { dispatchEvents } from '../packages/core/events'
import { captureLead, type LeadContext } from '../apps/web/lib/marketing/lead-capture'
import { LEAD_CONSUMER } from '../apps/web/lib/jobs/registry'

// B-068 / PRD 04 US-8, FR-LEAD-1..3, against real rows.
//
// The rule with the most to go wrong is dedup: the same person asking twice in
// a fortnight must be one lead with two things to say, because two leads means
// two staff calling them in parallel.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
const email = `prospect-${suffix}@example.com`

const context = (overrides: Partial<LeadContext> = {}): LeadContext => ({
  firstTouch: null,
  lastTouch: null,
  landingPage: '/storage/tx/austin/x',
  referrer: null,
  gclid: null,
  selfHost: 'storage.example.com',
  ip: null,
  ...overrides,
})

async function submit(
  overrides: Partial<Parameters<typeof captureLead>[0]> = {},
  ctx: Partial<LeadContext> = {},
  now?: Date,
) {
  return captureLead(
    {
      facilityId,
      name: 'Ada Prospect',
      email,
      phone: '512-555-0177',
      kind: 'quote',
      ...overrides,
    },
    context(ctx),
    now,
  )
}

describeDb('web lead capture', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Lead ${suffix}`,
        slug: `lead-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        status: 'active',
      },
    })
    facilityId = facility.id
  })

  beforeEach(async () => {
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.leadActivity.deleteMany({ where: { lead: { facilityId } } })
    await prisma.lead.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.leadActivity.deleteMany({ where: { lead: { facilityId } } })
    await prisma.lead.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  describe('the form — US-8 AC1', () => {
    it('creates a lead marked as web', async () => {
      const result = await submit({ note: 'Do you have a 10x10?' })
      expect(result).toMatchObject({ ok: true, deduplicated: false })
      if (!result.ok) return

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId } })
      expect(lead.source).toBe('web')
      expect(lead.status).toBe('new')
      expect(lead.firstName).toBe('Ada')
      expect(lead.lastName).toBe('Prospect')
      expect(lead.message).toContain('Do you have a 10x10?')
    })

    it('takes an email or a phone, but insists on one of them', async () => {
      expect(await submit({ email: '', phone: '' })).toMatchObject({ ok: false, field: 'email' })
      expect(await submit({ phone: '' })).toMatchObject({ ok: true })
    })

    it('requires a phone for a callback — there is nothing to call otherwise', async () => {
      expect(await submit({ kind: 'callback', phone: '' })).toMatchObject({
        ok: false,
        field: 'phone',
      })
      expect(await submit({ kind: 'callback' })).toMatchObject({ ok: true })
    })

    it('catches an obviously wrong email', async () => {
      expect(await submit({ email: 'ada@' })).toMatchObject({ ok: false, field: 'email' })
    })
  })

  describe('spam controls — US-8 AC4', () => {
    it('discards a honeypot submission without writing anything', async () => {
      const result = await submit({ honeypot: 'Acme Corp' })
      expect(result).toMatchObject({ field: 'silent' })
      expect(await prisma.lead.count({ where: { facilityId } })).toBe(0)
    })

    it('rate-limits a burst from one submitter', async () => {
      // Five in ten minutes is well above somebody comparing facilities and
      // well below a script.
      const ip = `203.0.113.${Math.floor(Math.random() * 200)}`
      const results = []
      for (let index = 0; index < 7; index += 1) {
        results.push(
          await submit({ email: `burst-${index}-${suffix}@example.com`, phone: '' }, { ip }),
        )
      }
      expect(results.filter((one) => one.ok)).toHaveLength(5)
      expect(results.at(-1)).toMatchObject({ ok: false })
    })

    it('does not limit when there is no address to key on', async () => {
      // Without an IP the limit is disabled rather than bucketing every visitor
      // under one constant hash, which would lock the form for everybody.
      for (let index = 0; index < 7; index += 1) {
        expect(await submit({ email: `noip-${index}-${suffix}@example.com`, phone: '' })).toMatchObject({
          ok: true,
        })
      }
    })
  })

  describe('dedup — FR-LEAD-1', () => {
    it('folds a repeat ask into one lead with an activity', async () => {
      const first = await submit({ note: 'First ask.' })
      const second = await submit({ note: 'Still thinking.' })

      expect(first).toMatchObject({ ok: true, deduplicated: false })
      expect(second).toMatchObject({ ok: true, deduplicated: true })
      if (!first.ok || !second.ok) return
      expect(second.leadId).toBe(first.leadId)

      expect(await prisma.lead.count({ where: { facilityId } })).toBe(1)
      const activities = await prisma.leadActivity.findMany({ where: { leadId: first.leadId } })
      expect(activities).toHaveLength(1)
      expect(activities[0].body).toContain('Still thinking.')
    })

    it('matches on phone even when the email differs', async () => {
      const first = await submit({ email: `a-${suffix}@example.com` })
      const second = await submit({ email: `b-${suffix}@example.com`, phone: '(512) 555-0177' })
      if (!first.ok || !second.ok) return
      expect(second.leadId).toBe(first.leadId)
    })

    it('does not match somebody whose number merely ends the same way', async () => {
      // The index filter is a coarse `contains`; the exact match is re-checked.
      const first = await submit({ email: `x-${suffix}@example.com`, phone: '512-555-0177' })
      const second = await submit({ email: `y-${suffix}@example.com`, phone: '972-000-0177' })
      if (!first.ok || !second.ok) return
      expect(second.leadId).not.toBe(first.leadId)
    })

    it('creates a fresh lead outside the 30-day window', async () => {
      const first = await submit()
      if (!first.ok) return
      await prisma.lead.update({
        where: { id: first.leadId },
        data: { createdAt: new Date(Date.now() - 45 * 86_400_000) },
      })

      const second = await submit()
      expect(second).toMatchObject({ ok: true, deduplicated: false })
      if (second.ok) expect(second.leadId).not.toBe(first.leadId)
    })

    it('revives a lead somebody had written off', async () => {
      const first = await submit()
      if (!first.ok) return
      await prisma.lead.update({
        where: { id: first.leadId },
        data: { status: 'lost', contactedAt: new Date() },
      })

      await submit({ note: 'Actually, still looking.' })

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: first.leadId } })
      expect(lead.status).toBe('new')
      expect(lead.contactedAt).toBeNull()
    })
  })

  describe('attribution — FR-LEAD-2', () => {
    it('stores first and last touch separately', async () => {
      const firstTouch = {
        source: 'google',
        medium: 'organic',
        campaign: null,
        landingPage: '/storage/search',
        channel: 'organic' as const,
      }
      const lastTouch = {
        source: 'google',
        medium: 'cpc',
        campaign: 'spring',
        landingPage: '/storage/tx/austin/x',
        channel: 'paid_search' as const,
      }

      const result = await submit({}, { firstTouch, lastTouch })
      if (!result.ok) return

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId } })
      expect(lead.firstTouchMedium).toBe('organic')
      expect(lead.lastTouchMedium).toBe('cpc')
      expect(lead.channel).toBe('paid_search')
    })

    it('moves last touch on a repeat but never first', async () => {
      // The ad that closed them and the search that found them are different
      // spend; letting the last claim both is the failure this guards.
      const organic = {
        source: 'google', medium: 'organic', campaign: null,
        landingPage: '/a', channel: 'organic' as const,
      }
      const paid = {
        source: 'google', medium: 'cpc', campaign: 'spring',
        landingPage: '/b', channel: 'paid_search' as const,
      }

      const first = await submit({}, { firstTouch: organic, lastTouch: organic })
      if (!first.ok) return
      await submit({}, { firstTouch: paid, lastTouch: paid })

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: first.leadId } })
      expect(lead.firstTouchMedium).toBe('organic')
      expect(lead.lastTouchMedium).toBe('cpc')
    })

    it('derives a channel for a visitor with no cookie at all', async () => {
      const result = await submit({}, { referrer: 'https://www.google.com/' })
      if (!result.ok) return
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId } })
      expect(lead.channel).toBe('organic')
    })
  })

  describe('hand-off — FR-LEAD-3 / US-8 AC2', () => {
    it('emits lead.created and raises a task for the manager', async () => {
      const result = await submit()
      if (!result.ok) return

      const event = await prisma.domainEvent.findFirstOrThrow({
        where: { name: 'lead.created', entityId: result.leadId },
      })
      expect(event.facilityId).toBe(facilityId)

      await dispatchEvents([LEAD_CONSUMER], { facilityId })

      const task = await prisma.task.findFirstOrThrow({
        where: { facilityId, type: 'lead_follow_up', entityId: result.leadId },
      })
      // Higher than a counter lead's: nobody has spoken to this person at all.
      expect(task.priority).toBe('high')
    })

    it('does not duplicate the task when the same lead asks again', async () => {
      const first = await submit()
      if (!first.ok) return
      await dispatchEvents([LEAD_CONSUMER], { facilityId })
      await submit({ note: 'Again.' })
      await dispatchEvents([LEAD_CONSUMER], { facilityId })

      expect(await prisma.task.count({ where: { facilityId, type: 'lead_follow_up' } })).toBe(1)
    })
  })
})
