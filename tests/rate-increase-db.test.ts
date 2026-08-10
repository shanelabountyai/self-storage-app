import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import {
  applyDueRateIncreases,
  applyRateChange,
  approveRateIncrease,
  cancelRateIncrease,
  pendingRateIncreases,
  previewEligibleIncreases,
  scheduleEligibleBatch,
  scheduleRateIncrease,
  sendDueRateIncreaseNotices,
} from '../apps/web/lib/pricing/tenant-rate-increases'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-076 / PRD 02 §4.3 US-11, PRD 05 CN-9, against real rows and the real
// seeded catalog.
//
// The properties worth a database: the minimum-notice block actually refuses,
// approval is gated on rank and records a reason, a notice cannot go out
// unapproved and a rate cannot move un-noticed, the applied rate lands on the
// lease AND in the history through one write, and a cancelled increase never
// touches the lease at all.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitTypeId = ''
let regionalId = ''
let managerId = ''

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

const PERMISSIONS = ['rates:tenant_increase', 'tenants:view', 'reports:operational']

function actorWith(staffUserId: string, rank: number): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId,
        roleKey: rank >= 30 ? 'regional' : 'manager',
        rank,
        permissions: new Set(PERMISSIONS as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

const regional = () => actorWith(regionalId, 30)
const manager = () => actorWith(managerId, 20)

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/// Far enough out that the 30-day default never makes a test flaky as the
/// real clock moves — every date here is relative to today, not fixed.
function daysFromNow(days: number): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days))
}

let leaseCounter = 0
async function makeLease(overrides: { monthlyRateCents?: number; lastChangeMonthsAgo?: number } = {}) {
  leaseCounter += 1
  const tenant = await prisma.tenant.create({
    data: { email: `ri-${suffix}-${leaseCounter}@example.com`, firstName: 'Ada', lastName: 'Renter' },
  })
  const unit = await prisma.unit.create({
    data: { facilityId, unitTypeId, number: `R-${suffix.slice(0, 4)}-${leaseCounter}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: tenant.id,
      unitId: unit.id,
      status: 'active',
      startDate: day('2024-01-01'),
      billingDay: 1,
      monthlyRateCents: overrides.monthlyRateCents ?? 12_900,
    },
  })

  const months = overrides.lastChangeMonthsAgo ?? 24
  const lastChange = new Date()
  lastChange.setUTCMonth(lastChange.getUTCMonth() - months)
  await prisma.leaseRateChange.create({
    data: {
      leaseId: lease.id,
      previousRateCents: null,
      newRateCents: lease.monthlyRateCents,
      effectiveFrom: lastChange,
      reason: 'move_in',
    },
  })

  return { leaseId: lease.id, tenantId: tenant.id, unitId: unit.id, email: tenant.email }
}

describeDb('tenant rate increases (US-11 / CN-9)', () => {
  beforeAll(async () => {
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => fakeProvider())
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    const facility = await prisma.facility.create({
      data: {
        name: `Rate Increase ${suffix}`,
        slug: `rate-increase-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id

    const [reg, mgr] = await Promise.all([
      prisma.staffUser.create({
        data: { email: `ri-reg-${suffix}@example.com`, firstName: 'Rhea', lastName: 'Regional' },
      }),
      prisma.staffUser.create({
        data: { email: `ri-mgr-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
      }),
    ])
    regionalId = reg.id
    managerId = mgr.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    await prisma.unitTypeRate.create({
      data: {
        facilityId,
        unitTypeId,
        streetRateCents: 14_900,
        webRateCents: 14_900,
        effectiveFrom: day('2024-01-01'),
      },
    })
  })

  afterEach(async () => {
    sends.length = 0
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    // `auditLog` is deliberately NOT cleaned — it is append-only, with a
    // database trigger that rejects DELETE outright (B-002). Every audit
    // assertion below is scoped to its own `entityId` for that reason.
    await prisma.tenantRateIncrease.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { email: { contains: suffix } } })
    await prisma.facility.update({ where: { id: facilityId }, data: { rateIncreaseNoticeDays: 30 } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    vi.restoreAllMocks()
    // The facility, its staff and its audit entries are deliberately left
    // behind — `audit_log` is append-only (a trigger rejects DELETE) and
    // `facility` is RESTRICT-referenced from it, so a facility that has been
    // audited is permanent by design. Same teardown the auction suite uses,
    // for the same reason. Everything scoped to this run's own `facilityId`
    // is cleaned, so nothing leaks into another suite's counts.
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.tenantRateIncrease.deleteMany({ where: { facilityId } })
    await prisma.leaseRateChange.deleteMany({ where: { lease: { facilityId } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { email: { contains: suffix } } })
    await prisma.$disconnect()
  })

  describe('scheduling', () => {
    it('schedules a one-off with the notice date derived from the facility setting', async () => {
      const { leaseId } = await makeLease()
      const result = await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      expect(result.ok).toBe(true)

      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      expect(row.status).toBe('pending_approval')
      expect(row.currentRateCents).toBe(12_900)
      expect(row.noticeDays).toBe(30)
      // notice date = effective − 30
      expect(row.noticeDate).toEqual(daysFromNow(15))
    })

    it('blocks an effective date inside the notice period (US-11’s hard block)', async () => {
      const { leaseId } = await makeLease()
      const result = await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(10),
      })
      expect(result).toMatchObject({ ok: false })
      if (!result.ok) expect(result.reason).toContain('notice period')
      expect(await prisma.tenantRateIncrease.count({ where: { leaseId } })).toBe(0)
    })

    it('refuses a decrease', async () => {
      const { leaseId } = await makeLease()
      const result = await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 10_000,
        effectiveDate: daysFromNow(45),
      })
      expect(result).toMatchObject({ ok: false })
    })

    it('refuses a second live increase on the same lease', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      const second = await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 15_900,
        effectiveDate: daysFromNow(60),
      })
      expect(second).toMatchObject({ ok: false })
      if (!second.ok) expect(second.reason).toContain('already has a scheduled increase')
    })

    it('honours a longer configured notice period', async () => {
      await prisma.facility.update({ where: { id: facilityId }, data: { rateIncreaseNoticeDays: 60 } })
      const { leaseId } = await makeLease()
      const result = await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      expect(result).toMatchObject({ ok: false })
    })
  })

  describe('the rule-based worklist', () => {
    it('picks a long-untouched lease well below street', async () => {
      await makeLease({ monthlyRateCents: 12_900, lastChangeMonthsAgo: 24 })
      const rows = await previewEligibleIncreases(manager(), facilityId)
      expect(rows).toHaveLength(1)
      expect(rows[0].newRateCents).toBe(14_900)
      expect(rows[0].gapCents).toBe(2_000)
    })

    it('skips a recently-raised lease', async () => {
      await makeLease({ monthlyRateCents: 12_900, lastChangeMonthsAgo: 2 })
      expect(await previewEligibleIncreases(manager(), facilityId)).toEqual([])
    })

    it('skips a lease already at street', async () => {
      await makeLease({ monthlyRateCents: 14_900, lastChangeMonthsAgo: 24 })
      expect(await previewEligibleIncreases(manager(), facilityId)).toEqual([])
    })

    it('skips a lease that already has a live increase', async () => {
      const { leaseId } = await makeLease({ lastChangeMonthsAgo: 24 })
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      expect(await previewEligibleIncreases(manager(), facilityId)).toEqual([])
    })

    it('schedules the whole batch under one batchId', async () => {
      await makeLease({ lastChangeMonthsAgo: 24 })
      await makeLease({ lastChangeMonthsAgo: 24 })

      const result = await scheduleEligibleBatch(manager(), facilityId, daysFromNow(45))
      expect(result).toMatchObject({ ok: true, scheduled: 2 })

      const rows = await prisma.tenantRateIncrease.findMany({ where: { facilityId } })
      expect(rows).toHaveLength(2)
      expect(new Set(rows.map((row) => row.batchId)).size).toBe(1)
    })
  })

  describe('approval (US-11: regional/owner before notices go out)', () => {
    async function scheduled() {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      return prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
    }

    it('refuses a site manager', async () => {
      const row = await scheduled()
      const result = await approveRateIncrease(manager(), row.id, 'below street')
      expect(result).toMatchObject({ ok: false })
      if (!result.ok) expect(result.reason).toContain('regional manager or an owner')
    })

    it('refuses an approval with no reason', async () => {
      const row = await scheduled()
      const result = await approveRateIncrease(regional(), row.id, '   ')
      expect(result).toMatchObject({ ok: false })
    })

    it('approves for a regional and audits it with the reason', async () => {
      const row = await scheduled()
      expect(await approveRateIncrease(regional(), row.id, 'below street for 2 years')).toEqual({ ok: true })

      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.status).toBe('approved')
      expect(after.approvedByStaffId).toBe(regionalId)

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'rate.tenant_increased', entityId: row.id },
      })
      expect(audit.reasonCode).toBe('below street for 2 years')
    })

    it('refuses to approve twice', async () => {
      const row = await scheduled()
      await approveRateIncrease(regional(), row.id, 'reason')
      const second = await approveRateIncrease(regional(), row.id, 'reason')
      expect(second).toMatchObject({ ok: false })
    })
  })

  describe('notice (CN-9)', () => {
    async function approved(effectiveInDays = 45) {
      const { leaseId, email } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(effectiveInDays),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      await approveRateIncrease(regional(), row.id, 'reason')
      return { row, leaseId, email }
    }

    it('sends nothing before the notice date', async () => {
      await approved()
      const result = await sendDueRateIncreaseNotices(facilityId, new Date(), () => {})
      expect(result.sent).toBe(0)
    })

    it('never sends for an unapproved increase', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      const result = await sendDueRateIncreaseNotices(facilityId, daysFromNow(40), () => {})
      expect(result.sent).toBe(0)
    })

    it('sends on the notice date and stamps the row', async () => {
      const { row } = await approved()
      const result = await sendDueRateIncreaseNotices(facilityId, daysFromNow(15), () => {})
      expect(result.sent).toBe(1)

      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.status).toBe('notice_sent')
      expect(after.noticeSentAt).not.toBeNull()
    })

    it('never sends twice — a catch-up run is a no-op', async () => {
      await approved()
      await sendDueRateIncreaseNotices(facilityId, daysFromNow(15), () => {})
      const second = await sendDueRateIncreaseNotices(facilityId, daysFromNow(20), () => {})
      expect(second.sent).toBe(0)
    })

    it('the email quotes all four of CN-9’s merge fields', async () => {
      const { email } = await approved()
      await sendDueRateIncreaseNotices(facilityId, daysFromNow(15), () => {})

      const event = await prisma.domainEvent.findFirstOrThrow({
        where: { name: 'lease.rate_increase_scheduled', facilityId },
      })
      await processCommsEvent(event)

      expect(sends).toHaveLength(1)
      expect(sends[0].to).toBe(email)
      expect(sends[0].body).toContain('$129.00') // old rate
      expect(sends[0].body).toContain('$149.00') // new rate
      expect(sends[0].body).toContain('30 days') // notice period
    })
  })

  describe('applying (US-11: first invoice on/after the effective date)', () => {
    async function noticed(effectiveInDays = 45) {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(effectiveInDays),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      await approveRateIncrease(regional(), row.id, 'reason')
      await sendDueRateIncreaseNotices(facilityId, daysFromNow(effectiveInDays - 30), () => {})
      return { row, leaseId }
    }

    it('does not apply before the effective date', async () => {
      const { leaseId } = await noticed()
      const result = await applyDueRateIncreases(facilityId, daysFromNow(44), () => {})
      expect(result.applied).toBe(0)
      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.monthlyRateCents).toBe(12_900)
    })

    it('moves the rate AND writes the history row through one write', async () => {
      const { row, leaseId } = await noticed()
      const result = await applyDueRateIncreases(facilityId, daysFromNow(45), () => {})
      expect(result.applied).toBe(1)

      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.monthlyRateCents).toBe(14_900)

      const history = await prisma.leaseRateChange.findFirstOrThrow({
        where: { leaseId, reason: 'ecri' },
      })
      expect(history.previousRateCents).toBe(12_900)
      expect(history.newRateCents).toBe(14_900)
      expect(history.noticeDays).toBe(30)
      expect(history.rateIncreaseId).toBe(row.id)

      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.status).toBe('applied')
    })

    it('never applies an increase whose notice never went out', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      await approveRateIncrease(regional(), row.id, 'reason')

      const result = await applyDueRateIncreases(facilityId, daysFromNow(60), () => {})
      expect(result.applied).toBe(0)
      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.monthlyRateCents).toBe(12_900)
    })

    it('never applies twice', async () => {
      await noticed()
      await applyDueRateIncreases(facilityId, daysFromNow(45), () => {})
      const second = await applyDueRateIncreases(facilityId, daysFromNow(46), () => {})
      expect(second.applied).toBe(0)
    })

    it('refuses when the rate moved out from under an approved increase', async () => {
      const { leaseId } = await noticed()
      // Something else raised the rate after approval — the approver signed
      // off on a delta from $129, not from this.
      await applyRateChange({
        leaseId,
        newRateCents: 13_500,
        effectiveFrom: new Date(),
        reason: 'manual',
      })

      const result = await applyDueRateIncreases(facilityId, daysFromNow(45), () => {})
      expect(result.applied).toBe(0)
      expect(result.skipped).toBe(1)
      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.monthlyRateCents).toBe(13_500)
    })

    it('skips a lease that ended before the effective date', async () => {
      const { leaseId } = await noticed()
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })

      const result = await applyDueRateIncreases(facilityId, daysFromNow(45), () => {})
      expect(result.applied).toBe(0)
      expect(result.skipped).toBe(1)
    })
  })

  describe('cancellation (US-11: cancellable up to the effective date)', () => {
    it('cancels an approved increase and audits it', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      await approveRateIncrease(regional(), row.id, 'reason')

      expect(await cancelRateIncrease(manager(), row.id, 'tenant called to complain')).toEqual({ ok: true })

      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.status).toBe('cancelled')

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'rate.increase_cancelled', entityId: row.id },
      })
      expect(audit.reasonCode).toBe('tenant called to complain')
    })

    it('a cancelled increase never moves the rate', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      await approveRateIncrease(regional(), row.id, 'reason')
      await sendDueRateIncreaseNotices(facilityId, daysFromNow(15), () => {})
      await cancelRateIncrease(manager(), row.id, 'changed our mind')

      const result = await applyDueRateIncreases(facilityId, daysFromNow(60), () => {})
      expect(result.applied).toBe(0)
      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.monthlyRateCents).toBe(12_900)
    })

    it('refuses a cancellation with no reason', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      expect(await cancelRateIncrease(manager(), row.id, '  ')).toMatchObject({ ok: false })
    })
  })

  describe('the review screen', () => {
    it('reports the projected monthly delta across everything live', async () => {
      const a = await makeLease({ monthlyRateCents: 12_900 })
      const b = await makeLease({ monthlyRateCents: 10_000 })
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId: a.leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId: b.leaseId,
        newRateCents: 11_000,
        effectiveDate: daysFromNow(45),
      })

      const review = await pendingRateIncreases(manager(), facilityId)
      expect(review.rows).toHaveLength(2)
      expect(review.projectedMonthlyDeltaCents).toBe(2_000 + 1_000)
    })

    it('drops a cancelled increase from the worklist', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      await cancelRateIncrease(manager(), row.id, 'reason')

      const review = await pendingRateIncreases(manager(), facilityId)
      expect(review.rows).toEqual([])
      expect(review.projectedMonthlyDeltaCents).toBe(0)
    })
  })
})
