import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { MOVE_SOURCES, STAFF_LEAD_SOURCES } from '../packages/core/metrics'
import {
  createInquiry,
  facilityLeads,
  holdForLead,
  joinWaitlistForLead,
  quoteForFacility,
  setLeadStatus,
} from '../apps/web/lib/admin/inquiries'
import { raiseLeadFollowUps } from '../apps/web/lib/admin/lead-follow-up'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-097 / PRD 02 §4.8 US-43, against real rows.
//
// The AC that matters most is the last one: "source and channel carry through
// reservation → move-in, so the move-in/move-out report can split walk-in vs
// phone vs web. Web-only attribution is the classic way software talks an owner
// into defunding the phone."

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitTypeId = ''
let staffId = ''

function actor(permissions: PermissionKey[] = ['tenants:view', 'tenants:edit']): Actor {
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

async function inquiry(overrides: Partial<Parameters<typeof createInquiry>[1]> = {}) {
  return createInquiry(actor(), {
    facilityId,
    firstName: 'Ada',
    lastName: `Caller ${suffix}`,
    phone: '512-555-0142',
    source: 'phone',
    ...overrides,
  })
}

describeDb('inquiry capture', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Inquiry ${suffix}`,
        slug: `inquiry-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        status: 'active',
        leadFollowUpHours: 4,
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `inquiry-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

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
    for (let index = 0; index < 2; index += 1) {
      await prisma.unit.create({
        data: { facilityId, unitTypeId, number: `Q-${suffix.slice(0, 3)}-${index}`, status: 'available' },
      })
    }
  })

  beforeEach(async () => {
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.lead.deleteMany({ where: { facilityId } })
    // Deleting the reservation rows does NOT release the units — a hold sets
    // `Unit.status = 'held'`, and availability derives from that rather than
    // from the reservation. Without this reset the second hold test finds two
    // units still claimed by the first and every later hold reports sold out.
    await prisma.unit.updateMany({ where: { facilityId }, data: { status: 'available' } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.reservation.deleteMany({ where: { facilityId } })
    await prisma.waitlistEntry.deleteMany({ where: { facilityId } })
    await prisma.lead.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  describe('capture', () => {
    it('records a phone inquiry with who took it', async () => {
      const result = await inquiry({ message: 'Wants a 10x10 for a garage clear-out.' })
      expect(result).toMatchObject({ ok: true })
      if (!result.ok) return

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId } })
      expect(lead.source).toBe('phone')
      expect(lead.status).toBe('new')
      expect(lead.createdByStaffId).toBe(staffId)
      expect(lead.contactedAt).toBeNull()
    })

    it('requires a phone number, not an email', async () => {
      // The inverse of the web form, deliberately: somebody on the phone gives
      // a number without hesitating and spells an email badly, and a lead with
      // a wrong email is worse than one with none because follow-up looks sent.
      expect(await inquiry({ phone: '555' })).toMatchObject({ ok: false, field: 'phone' })
      expect(await inquiry({ email: null })).toMatchObject({ ok: true })
    })

    it('requires a name and a real source', async () => {
      expect(await inquiry({ firstName: '', lastName: '' })).toMatchObject({
        ok: false,
        field: 'firstName',
      })
      // `web` is not offerable to a staffer — a person at the counter is by
      // construction not the website.
      expect(await inquiry({ source: 'web' })).toMatchObject({ ok: false, field: 'source' })
    })

    it('refuses a staffer who cannot edit at this facility', async () => {
      await expect(
        createInquiry(actor(['tenants:view']), {
          facilityId,
          firstName: 'Ada',
          lastName: 'Caller',
          phone: '512-555-0142',
          source: 'phone',
        }),
      ).rejects.toThrow()
    })
  })

  describe('quote — both prices', () => {
    it('shows web and street side by side, plus what today costs', async () => {
      const quote = await quoteForFacility(actor(), facilityId)
      const line = quote.lines.find((row) => row.unitTypeId === unitTypeId)!

      expect(line.webRateCents).toBe(12_900)
      expect(line.streetRateCents).toBe(14_900)
      // Through the same calculator the public page uses, so the number read
      // down the phone matches what the caller sees online.
      expect(line.moveInTotalCents).toBeGreaterThanOrEqual(12_900)
      expect(line.availableCount).toBe(2)
    })

    it('reports no promotion when none is running', async () => {
      const quote = await quoteForFacility(actor(), facilityId)
      expect(quote.promotionsAvailable).toBe(false)
      expect(quote.lines.every((line) => line.promo === null)).toBe(true)
    })

    // B-109. This assertion used to read "says plainly that it knows nothing
    // about promotions" and pinned `promotionsAvailable` to a hardcoded
    // `false` — which stayed green through B-070 shipping the whole engine.
    // The screen went on telling the counter agent "No promotions engine yet"
    // while the website advertised a discount on the same unit, so a phone
    // quote and a web quote disagreed and the caller found out at the counter.
    // A test that asserts a placeholder is a test that defends the placeholder.
    it('prices the live promotion the website is advertising', async () => {
      const promotion = await prisma.promotion.create({
        data: {
          name: `Quote promo ${suffix}`,
          type: 'percent_off',
          value: 50,
          durationPeriods: 1,
          status: 'active',
          displayMode: 'auto',
          facilityIds: [facilityId],
        },
      })

      try {
        const quote = await quoteForFacility(actor(), facilityId)
        const line = quote.lines.find((row) => row.unitTypeId === unitTypeId)!

        expect(quote.promotionsAvailable).toBe(true)
        expect(line.promo).not.toBeNull()
        // Half off the online rate, through the same `offerFor` the public
        // facility page calls — so the two agree by construction.
        expect(line.promo!.firstPeriodCents).toBe(Math.round(line.webRateCents / 2))
        expect(line.promo!.terms).toBeTruthy()
      } finally {
        await prisma.promotion.delete({ where: { id: promotion.id } })
      }
    })
  })

  describe('hold — through the same reservation service', () => {
    it('places a free hold carrying the lead’s source', async () => {
      const created = await inquiry()
      if (!created.ok) throw new Error('unreachable')

      const held = await holdForLead(actor(), created.leadId, unitTypeId)
      expect(held).toMatchObject({ ok: true })
      if (!held.ok) return

      const reservation = await prisma.reservation.findUniqueOrThrow({
        where: { id: held.reservationId },
      })
      // US-43's own words: "with source = phone".
      expect(reservation.source).toBe('phone')
      expect(reservation.leadId).toBe(created.leadId)
      expect(reservation.status).toBe('held')
      // Free: no card, no account, no tenant.
      expect(reservation.tenantId).toBeNull()
    })

    it('marks the lead reserved and contacted, so it stops ageing', async () => {
      const created = await inquiry()
      if (!created.ok) throw new Error('unreachable')
      await holdForLead(actor(), created.leadId, unitTypeId)

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: created.leadId } })
      expect(lead.status).toBe('reserved')
      expect(lead.contactedAt).not.toBeNull()
    })

    it('reports sold out rather than failing', async () => {
      const first = await inquiry()
      const second = await inquiry()
      const third = await inquiry()
      if (!first.ok || !second.ok || !third.ok) throw new Error('unreachable')

      expect(await holdForLead(actor(), first.leadId, unitTypeId)).toMatchObject({ ok: true })
      expect(await holdForLead(actor(), second.leadId, unitTypeId)).toMatchObject({ ok: true })

      // Two units, three callers.
      const result = await holdForLead(actor(), third.leadId, unitTypeId)
      expect(result).toMatchObject({ ok: false })
      if (!result.ok) expect(result.problem).toContain('another size')
    })
  })

  describe('waitlist — the counter/phone half of notify-me (B-154)', () => {
    it('adds the caller with their phone carried over from the lead', async () => {
      const created = await inquiry({ phone: '512-555-0177' })
      if (!created.ok) throw new Error('unreachable')

      const email = `caller-${suffix}@example.com`
      const result = await joinWaitlistForLead(actor(), created.leadId, unitTypeId, email)
      expect(result).toMatchObject({ ok: true, alreadyOn: false })

      // B-180. The size and the address the confirmation names come from what
      // was RECORDED, not from what was typed — the success sentence on the
      // lead screen is built out of these two.
      const unitType = await prisma.unitType.findUniqueOrThrow({ where: { id: unitTypeId } })
      if (!result.ok) throw new Error('unreachable')
      expect(result.unitTypeName).toBe(unitType.name)
      expect(result.email).toBe(email)

      const entry = await prisma.waitlistEntry.findFirstOrThrow({ where: { unitTypeId, email } })
      expect(entry.phone).toBe('512-555-0177')
    })

    it('marks a new lead contacted, the same disposition a hold gets', async () => {
      const created = await inquiry()
      if (!created.ok) throw new Error('unreachable')
      await joinWaitlistForLead(actor(), created.leadId, unitTypeId, `contacted-${suffix}@example.com`)

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: created.leadId } })
      expect(lead.status).toBe('contacted')
      expect(lead.contactedAt).not.toBeNull()
    })

    it('is idempotent by address, same as the public form', async () => {
      const created = await inquiry()
      if (!created.ok) throw new Error('unreachable')
      const email = `twice-${suffix}@example.com`
      await joinWaitlistForLead(actor(), created.leadId, unitTypeId, email)
      const second = await joinWaitlistForLead(actor(), created.leadId, unitTypeId, email)
      expect(second).toMatchObject({ ok: true, alreadyOn: true })
    })

    it('refuses a staffer who cannot edit at this facility', async () => {
      const created = await inquiry()
      if (!created.ok) throw new Error('unreachable')
      await expect(
        joinWaitlistForLead(actor([]), created.leadId, unitTypeId, `refused-${suffix}@example.com`),
      ).rejects.toThrow()
    })
  })

  describe('follow-up — US-43’s "never silently ageing"', () => {
    it('raises nothing for a lead taken minutes ago', async () => {
      await inquiry()
      expect(await raiseLeadFollowUps(facilityId)).toEqual({ raised: 1 - 1 })
    })

    it('raises a task once the window has passed', async () => {
      const created = await inquiry()
      if (!created.ok) throw new Error('unreachable')
      await prisma.lead.update({
        where: { id: created.leadId },
        data: { createdAt: new Date(Date.now() - 6 * 3_600_000) },
      })

      expect(await raiseLeadFollowUps(facilityId)).toEqual({ raised: 1 })

      const task = await prisma.task.findFirstOrThrow({
        where: { facilityId, type: 'lead_follow_up', entityId: created.leadId },
      })
      expect(task.status).toBe('open')
      // Normal, not high: putting a four-hour-old prospect level with a gate
      // that will not open for a paying tenant is how a queue stops sorting.
      expect(task.priority).toBe('normal')
    })

    it('is idempotent across two sweeps on the same day', async () => {
      const created = await inquiry()
      if (!created.ok) throw new Error('unreachable')
      await prisma.lead.update({
        where: { id: created.leadId },
        data: { createdAt: new Date(Date.now() - 6 * 3_600_000) },
      })

      await raiseLeadFollowUps(facilityId)
      expect(await raiseLeadFollowUps(facilityId)).toEqual({ raised: 0 })
      expect(await prisma.task.count({ where: { facilityId, type: 'lead_follow_up' } })).toBe(1)
    })

    it('leaves an already-contacted lead alone', async () => {
      const created = await inquiry()
      if (!created.ok) throw new Error('unreachable')
      await prisma.lead.update({
        where: { id: created.leadId },
        data: { createdAt: new Date(Date.now() - 6 * 3_600_000) },
      })
      await setLeadStatus(actor(), created.leadId, 'contacted')

      expect(await raiseLeadFollowUps(facilityId)).toEqual({ raised: 0 })
    })

    it('shows the overdue one on the list', async () => {
      const created = await inquiry()
      if (!created.ok) throw new Error('unreachable')
      await prisma.lead.update({
        where: { id: created.leadId },
        data: { createdAt: new Date(Date.now() - 6 * 3_600_000) },
      })

      const rows = await facilityLeads(actor(), facilityId)
      expect(rows.find((row) => row.id === created.leadId)!.overdue).toBe(true)
    })
  })

  describe('disposition', () => {
    it('stamps contactedAt once and never moves it', async () => {
      const created = await inquiry()
      if (!created.ok) throw new Error('unreachable')

      await setLeadStatus(actor(), created.leadId, 'contacted')
      const first = await prisma.lead.findUniqueOrThrow({ where: { id: created.leadId } })

      await setLeadStatus(actor(), created.leadId, 'lost')
      const second = await prisma.lead.findUniqueOrThrow({ where: { id: created.leadId } })

      // Re-stamping would let a lead be nudged out of overdue without anyone
      // calling.
      expect(second.contactedAt?.getTime()).toBe(first.contactedAt?.getTime())
      expect(second.status).toBe('lost')
    })
  })

  describe('the vocabulary the report splits on', () => {
    it('keeps staff sources and move sources in step', async () => {
      // A source a staffer can pick but the report cannot name reports as
      // `unknown`, and nobody notices until the channel split is being used to
      // decide whether to keep answering the phone.
      for (const source of STAFF_LEAD_SOURCES) {
        expect(MOVE_SOURCES).toContain(source)
      }
    })

    it('never offers web or unknown to a staffer', async () => {
      expect(STAFF_LEAD_SOURCES).not.toContain('web' as never)
      expect(STAFF_LEAD_SOURCES).not.toContain('unknown' as never)
    })
  })
})
