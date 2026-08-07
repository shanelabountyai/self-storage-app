import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { propagateGateHours, setExtendedHours } from '../apps/web/lib/access/time-windows'
import { drainGateCommands } from '../apps/web/lib/access/service'
import { evaluateKeypadEntry } from '../apps/web/lib/access/simulator'
import { accessEventLog, summariseFlags } from '../apps/web/lib/access/event-log'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-064 / PRD 03 US-4, US-5, FR-4, FR-5, against real rows.
//
// The loop this proves end to end: hours saved → command queued → controller
// told → keypad denies out of window → event ingested with flags → the log
// finds it. Every link is somewhere the change could stop silently, and the
// worst of them is the first: a schedule written to a database column changes
// nothing at the fence.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

// Facility on Chicago time; the schedule is 06:00–22:00 weekdays.
const CHICAGO_0300 = new Date('2026-07-15T08:00:00Z')
const OPEN_HOURS = {
  monday: { closed: false, open: '06:00', close: '22:00' },
  tuesday: { closed: false, open: '06:00', close: '22:00' },
  wednesday: { closed: false, open: '06:00', close: '22:00' },
  thursday: { closed: false, open: '06:00', close: '22:00' },
  friday: { closed: false, open: '06:00', close: '22:00' },
  saturday: { closed: false, open: '08:00', close: '20:00' },
  sunday: { closed: true },
}

let facilityId = ''
let grantId = ''
let credentialId = ''
let staffId = ''
const CODE = `${Math.floor(100_000 + Math.random() * 899_999)}`

function actor(permissions: string[] = ['access:events', 'access:manage_grants']): Actor {
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

describeDb('gate hours and the event log', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Gate Hours ${suffix}`,
        slug: `gate-hours-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        gateHours: OPEN_HOURS,
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `gate-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const tenant = await prisma.tenant.create({
      data: { email: `gate-${suffix}@example.com`, firstName: 'Ada', lastName: `Renter ${suffix}` },
    })
    const grant = await prisma.accessGrant.create({
      data: { facilityId, tenantId: tenant.id, state: 'active', stateCause: 'test' },
    })
    grantId = grant.id
    const credential = await prisma.accessCredential.create({
      data: { facilityId, grantId, valueRef: 'unrevealable:test', state: 'active' },
    })
    credentialId = credential.id
    // The controller's own copy of the code — what a real vendor would hold.
    await prisma.simulatedGateCode.create({
      data: { facilityId, credentialId, code: CODE, active: true },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.$disconnect()
  })

  describe('propagation — US-4 AC1', () => {
    it('queues a command rather than writing the window directly', async () => {
      // The whole point: the controller enforces what it was last told, and it
      // may be offline. A direct write would "succeed" while the fence kept
      // running last week's schedule.
      const { enqueued } = await propagateGateHours(facilityId)
      expect(enqueued).toBe(1)

      const before = await prisma.simulatedGateCode.findUniqueOrThrow({ where: { credentialId } })
      expect(before.windowSchedule).toBeNull()

      const pending = await prisma.gateCommand.findMany({
        where: { facilityId, type: 'set_time_window', status: 'pending' },
      })
      expect(pending).toHaveLength(1)
    })

    it('reaches the controller when the queue drains', async () => {
      await drainGateCommands(new Date(), facilityId)

      const after = await prisma.simulatedGateCode.findUniqueOrThrow({ where: { credentialId } })
      expect(after.windowSchedule).toMatchObject({ sunday: { closed: true } })
      expect(after.windowExempt).toBe(false)
    })

    it('does not re-queue an identical schedule', async () => {
      // Versioned by the schedule itself: re-saving the same hours is one
      // command, not a fresh one per click.
      await propagateGateHours(facilityId)
      const all = await prisma.gateCommand.findMany({
        where: { facilityId, type: 'set_time_window' },
      })
      expect(all).toHaveLength(1)
    })
  })

  describe('enforcement — US-4 AC2', () => {
    it('denies a valid code at 3am as outside_hours', async () => {
      const outcome = await evaluateKeypadEntry(facilityId, CODE, CHICAGO_0300)

      expect(outcome.result).toBe('denied')
      expect(outcome.reason).toBe('outside_hours')

      // The credential is named even on the denial: a known tenant at the wrong
      // hour is a different fact from a stranger trying numbers.
      const event = await prisma.accessEvent.findUniqueOrThrow({
        where: { vendorEventId: outcome.vendorEventId },
      })
      expect(event.credentialId).toBe(credentialId)
      expect(event.flags).toContain('after_hours_attempt')
      expect(event.flags).not.toContain('unknown_code')
    })

    it('opens the same code during published hours', async () => {
      // 15:00Z = 10:00 Chicago on a Wednesday.
      const outcome = await evaluateKeypadEntry(facilityId, CODE, new Date('2026-07-15T15:00:00Z'))
      expect(outcome.result).toBe('granted')
      expect(outcome.reason).toBe('ok')
    })

    it('lets a 24-hour tenant through at 3am — AC3', async () => {
      await setExtendedHours(grantId, true)
      await drainGateCommands(new Date(), facilityId)

      const controller = await prisma.simulatedGateCode.findUniqueOrThrow({ where: { credentialId } })
      expect(controller.windowExempt).toBe(true)

      const outcome = await evaluateKeypadEntry(facilityId, CODE, CHICAGO_0300)
      expect(outcome.result).toBe('granted')

      await setExtendedHours(grantId, false)
      await drainGateCommands(new Date(), facilityId)
    })
  })

  describe('the event log — US-5', () => {
    it('retains an unknown code and flags it', async () => {
      const outcome = await evaluateKeypadEntry(facilityId, '000000', new Date('2026-07-15T15:05:00Z'))
      expect(outcome.reason).toBe('unknown_code')

      const event = await prisma.accessEvent.findUniqueOrThrow({
        where: { vendorEventId: outcome.vendorEventId },
      })
      expect(event.credentialId).toBeNull()
      expect(event.flags).toContain('unknown_code')
    })

    it('flags the fifth denial inside fifteen minutes', async () => {
      const start = new Date('2026-09-01T15:00:00Z')
      const outcomes = []
      for (let index = 0; index < 6; index += 1) {
        outcomes.push(
          await evaluateKeypadEntry(
            facilityId,
            '999999',
            new Date(start.getTime() + index * 60_000),
          ),
        )
      }

      const events = await prisma.accessEvent.findMany({
        where: { vendorEventId: { in: outcomes.map((one) => one.vendorEventId) } },
        orderBy: { occurredAt: 'asc' },
      })
      // Facility-wide count, so the run is scoped to a clean window an hour
      // clear of everything above.
      expect(events[3].flags).not.toContain('denied_repeated')
      expect(events[4].flags).toContain('denied_repeated')
      expect(events[5].flags).toContain('denied_repeated')
    })

    it('filters by result, by flag, and by tenant', async () => {
      const all = await accessEventLog(actor(), { facilityId })
      expect(all.length).toBeGreaterThan(0)

      const denied = await accessEventLog(actor(), { facilityId, result: 'denied' })
      expect(denied.every((row) => row.result === 'denied')).toBe(true)

      const unknown = await accessEventLog(actor(), { facilityId, flag: 'unknown_code' })
      expect(unknown.length).toBeGreaterThan(0)
      expect(unknown.every((row) => row.flags.includes('unknown_code'))).toBe(true)
      // An unknown code has nobody behind it — that is the point of keeping it.
      expect(unknown.every((row) => row.tenantId === null)).toBe(true)
    })

    it('counts flags off the same rows the list shows', async () => {
      const rows = await accessEventLog(actor(), { facilityId })
      const counts = summariseFlags(rows)
      for (const entry of counts) {
        const filtered = await accessEventLog(actor(), { facilityId, flag: entry.flag })
        expect(filtered.length).toBe(entry.count)
      }
    })

    it('refuses a staffer without the gate-activity key', async () => {
      // Separate from tenants:view on purpose: a gate log says where a named
      // person physically was and at what hour.
      await expect(
        accessEventLog(actor(['tenants:view']), { facilityId }),
      ).rejects.toThrow()
    })
  })
})
