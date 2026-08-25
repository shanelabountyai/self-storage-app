import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { businessDateFor } from '../packages/core/jobs'
import {
  activeLeaseOptions,
  applyDueRateIncreases,
  applyRateChange,
  reconcileRateIncreaseNotices,
  scheduleRateDecrease,
  approveRateIncrease,
  cancelRateIncrease,
  pendingRateIncreases,
  previewEligibleIncreases,
  renoticeHeldIncreases,
  renoticeRateIncrease,
  scheduleEligibleBatch,
  scheduleRateIncrease,
  sendDueRateIncreaseNotices,
} from '../apps/web/lib/pricing/tenant-rate-increases'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

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
        permissions: new Set<PermissionKey>(PERMISSIONS as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

const regional = () => actorWith(regionalId, 30)
const manager = () => actorWith(managerId, 20)

/// B-153. A retention save is gated on the EXISTING monetary limits rather
/// than on `rates:tenant_increase`, so these actors carry `credits:manual`
/// with a real limit — the seeded manager's is $50 a month, and the point of
/// the reuse is that no new threshold was invented.
function saver(staffUserId: string, rank: number, maxCreditCents: number | null): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId,
        roleKey: rank >= 30 ? 'regional' : 'manager',
        rank,
        permissions: new Set<PermissionKey>(['tenants:view', 'credits:manual'] as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents },
      },
    ],
  }
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/// Far enough out that the 30-day default never makes a test flaky as the
/// real clock moves — every date here is relative to today, not fixed.
/// Days from the FACILITY's business date, not from UTC's.
///
/// Found failing at 23:41 CDT while running B-172, and latent since the file
/// was written. `renoticeRateIncrease` and every other date in this module read
/// `businessDateFor(new Date(), facility.timezone)`, and this fixture read
/// `now.getUTCDate()` — the two agree only while the UTC date and the Chicago
/// date are the same day, which stops being true at 19:00 CDT. After that the
/// helper is one day ahead of the code it is asserting against and the suite
/// fails as "expected 1790121600000 to be 1790208000000", which reads like
/// broken arithmetic rather than a fixture reading a different clock. Exactly
/// the trap CLAUDE.md records for quiet-hours messaging, one module over.
function daysFromNow(days: number): Date {
  const today = businessDateFor(new Date(), 'America/Chicago')
  return new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days),
  )
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
    // The facility outlives every test in this file, so anything a test
    // changes about it has to be put back — B-165's step-rule tests set four
    // of these, and a leaked 0% step drops every later test's candidate rows
    // silently (they read as "no lease is eligible", not as a stale setting).
    await prisma.facility.update({
      where: { id: facilityId },
      data: {
        rateIncreaseNoticeDays: 30,
        ecriPercentBasisPoints: 1_000,
        ecriMinStepCents: 500,
        ecriMaxStepCents: 3_000,
        ecriCapAtStreet: true,
        ecriMinMonthsSinceChange: 9,
        ecriMinGapCents: 1_500,
      },
    })
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
      // B-165 / D-94. $129 × 10% = $12.90 → $141.90 → $142, well short of the
      // $149 street rate. Before this row the answer was $149 in one letter.
      expect(rows[0].newRateCents).toBe(14_200)
      expect(rows[0].gapCents).toBe(2_000)
    })

    it('B-165: uses the facility\'s configured step, not a module constant', async () => {
      await makeLease({ monthlyRateCents: 12_900, lastChangeMonthsAgo: 24 })
      await prisma.facility.update({
        where: { id: facilityId },
        data: { ecriPercentBasisPoints: 500, ecriMaxStepCents: 10_000 },
      })
      const rows = await previewEligibleIncreases(manager(), facilityId)
      // 5% of $129 is $6.45 → $135.45 → $135.
      expect(rows[0].newRateCents).toBe(13_500)
    })

    it('B-165: the street cap is the last word, and the setting turns it off', async () => {
      // 10% of $145 is $14.50, which would overshoot the $149 street rate.
      await makeLease({ monthlyRateCents: 14_500, lastChangeMonthsAgo: 24 })
      await prisma.facility.update({
        where: { id: facilityId },
        data: { ecriMinGapCents: 100 },
      })
      expect((await previewEligibleIncreases(manager(), facilityId))[0].newRateCents).toBe(14_900)

      await prisma.facility.update({ where: { id: facilityId }, data: { ecriCapAtStreet: false } })
      expect((await previewEligibleIncreases(manager(), facilityId))[0].newRateCents).toBe(16_000)
    })

    it('B-165: drops a lease the policy cannot actually raise', async () => {
      // Eligible by gap and tenure, but a zero step means the "increase" would
      // be to the rate they already pay — a notice saying nothing changed.
      await makeLease({ monthlyRateCents: 12_900, lastChangeMonthsAgo: 24 })
      await prisma.facility.update({
        where: { id: facilityId },
        data: { ecriPercentBasisPoints: 0, ecriMinStepCents: 0 },
      })
      expect(await previewEligibleIncreases(manager(), facilityId)).toEqual([])
    })

    it('skips a recently-raised lease', async () => {
      await makeLease({ monthlyRateCents: 12_900, lastChangeMonthsAgo: 2 })
      expect(await previewEligibleIncreases(manager(), facilityId)).toEqual([])
    })

    it('skips a lease already at street', async () => {
      await makeLease({ monthlyRateCents: 14_900, lastChangeMonthsAgo: 24 })
      expect(await previewEligibleIncreases(manager(), facilityId)).toEqual([])
    })

    // B-162. The ECRI clock used to reset on a unit swap, twice over: the
    // transfer wrote a `LeaseRateChange` dated today, and `lease.startDate` on
    // the new lease is the transfer date — so months-since-last-change read as
    // zero either way and the tenant was exempt for another cycle. Asking to
    // move units was a way to opt out of every increase.
    it('still raises a tenant who transferred, counting from when their tenancy began', async () => {
      const { leaseId, tenantId } = await makeLease({ monthlyRateCents: 12_900, lastChangeMonthsAgo: 24 })
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId, number: `RX-${suffix.slice(0, 4)}` },
      })
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })
      const moved = await prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: unit.id,
          status: 'active',
          // The transfer date, which is what made the fallback lie.
          startDate: new Date(),
          billingDay: 1,
          monthlyRateCents: 12_900,
          transferredFromLeaseId: leaseId,
        },
      })
      await prisma.leaseRateChange.create({
        data: {
          leaseId: moved.id,
          previousRateCents: 12_900,
          newRateCents: 12_900,
          effectiveFrom: new Date(),
          reason: 'transfer',
        },
      })

      const rows = await previewEligibleIncreases(manager(), facilityId)
      expect(rows.map((row) => row.leaseId)).toEqual([moved.id])
      expect(rows[0].newRateCents).toBe(14_200)
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

  // B-152 / D-88. `notice_sent` used to mean "we emitted an event", and an
  // increase whose notice hard-bounced applied thirty days later regardless.
  // D-88 (Option A): a bounce, a suppression hit or no send record blocks the
  // increase and raises a task.
  describe('notice delivery reconciliation (D-88)', () => {
    async function noticedAndDelivered(effectiveInDays = 45) {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(effectiveInDays),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      await approveRateIncrease(regional(), row.id, 'reason')
      await sendDueRateIncreaseNotices(facilityId, daysFromNow(effectiveInDays - 30), () => {})

      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      const event = await prisma.domainEvent.findUniqueOrThrow({
        where: { id: after.noticeEventId! },
      })
      await processCommsEvent(event)
      return { row, leaseId, eventId: after.noticeEventId! }
    }

    it('records the event the notice was sent as, in the same breath as the status', async () => {
      const { row } = await noticedAndDelivered()
      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.noticeEventId).not.toBeNull()
      const messages = await prisma.message.findMany({ where: { eventId: after.noticeEventId! } })
      expect(messages).toHaveLength(1)
    })

    it('leaves a delivered notice alone and applies the increase', async () => {
      const { leaseId } = await noticedAndDelivered()
      const result = await applyDueRateIncreases(facilityId, daysFromNow(45), () => {})
      expect(result.applied).toBe(1)
      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.monthlyRateCents).toBe(14_900)
    })

    it('holds the increase and raises a high-priority task when the notice bounced', async () => {
      const { row, leaseId, eventId } = await noticedAndDelivered()
      await prisma.message.updateMany({ where: { eventId }, data: { status: 'bounced' } })

      const result = await applyDueRateIncreases(facilityId, daysFromNow(45), () => {})
      expect(result.applied).toBe(0)

      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.status).toBe('notice_failed')
      expect(after.noticeFailureReason).toBe('undeliverable')

      // The rate is the one fact that must not have moved.
      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.monthlyRateCents).toBe(12_900)

      const task = await prisma.task.findFirstOrThrow({
        where: { type: 'rate_increase_notice_undelivered', entityId: leaseId },
      })
      expect(task.priority).toBe('high')
    })

    it('holds it for a suppression hit too — a notice we chose not to send is not notice', async () => {
      const { row, eventId } = await noticedAndDelivered()
      await prisma.message.updateMany({ where: { eventId }, data: { status: 'suppressed' } })

      await applyDueRateIncreases(facilityId, daysFromNow(45), () => {})
      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.status).toBe('notice_failed')
    })

    it('holds it when the pipeline produced no message at all, once the grace window has passed', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      await approveRateIncrease(regional(), row.id, 'reason')
      await sendDueRateIncreaseNotices(facilityId, daysFromNow(15), () => {})
      // The event was never dispatched. Backdated past the two-hour window
      // that separates "the dispatcher has not got to it" from "there is
      // nothing to get to".
      await prisma.tenantRateIncrease.update({
        where: { id: row.id },
        data: { noticeSentAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
      })

      const result = await reconcileRateIncreaseNotices(facilityId, () => {})
      expect(result.blocked).toBe(1)
      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.status).toBe('notice_failed')
      expect(after.noticeFailureReason).toBe('no_send_record')
    })

    it('does not judge a notice the dispatcher has not reached yet', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      await approveRateIncrease(regional(), row.id, 'reason')
      await sendDueRateIncreaseNotices(facilityId, daysFromNow(15), () => {})

      const result = await reconcileRateIncreaseNotices(facilityId, () => {})
      expect(result.blocked).toBe(0)
      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.status).toBe('notice_sent')
    })

    it('raises one task, not one per nightly run', async () => {
      const { leaseId, eventId } = await noticedAndDelivered()
      await prisma.message.updateMany({ where: { eventId }, data: { status: 'bounced' } })

      await applyDueRateIncreases(facilityId, daysFromNow(45), () => {})
      const second = await applyDueRateIncreases(facilityId, daysFromNow(46), () => {})
      expect(second.applied).toBe(0)

      const tasks = await prisma.task.findMany({
        where: { type: 'rate_increase_notice_undelivered', entityId: leaseId },
      })
      expect(tasks).toHaveLength(1)
    })

    it('a held increase is still cancellable, and blocks a second one on the lease', async () => {
      const { row, leaseId, eventId } = await noticedAndDelivered()
      await prisma.message.updateMany({ where: { eventId }, data: { status: 'bounced' } })
      await applyDueRateIncreases(facilityId, daysFromNow(45), () => {})

      // D-88: the operator re-notices from a good address, so the held row
      // must not silently allow a duplicate alongside it.
      expect(
        await scheduleRateIncrease(manager(), facilityId, {
          leaseId,
          newRateCents: 15_900,
          effectiveDate: daysFromNow(60),
        }),
      ).toMatchObject({ ok: false })

      expect(await cancelRateIncrease(manager(), row.id, 'bad address, re-noticing')).toEqual({ ok: true })
    })
  })

  // B-166 / D-88. B-152 built the hold and left Cancel as the only control on
  // it. D-88's remedy — "the operator re-notices from a good address and the
  // clock restarts" — is what this builds, and the properties worth a database
  // are that the clone carries the same figures and the original approval, the
  // held row is closed out with it, and re-noticing to the SAME address is
  // refused rather than sent.
  describe('re-noticing a held increase (B-166 / D-88)', () => {
    async function held(effectiveInDays = 45) {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(effectiveInDays),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      await approveRateIncrease(regional(), row.id, 'the annual review')
      await sendDueRateIncreaseNotices(facilityId, daysFromNow(effectiveInDays - 30), () => {})
      const sent = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      const event = await prisma.domainEvent.findUniqueOrThrow({ where: { id: sent.noticeEventId! } })
      await processCommsEvent(event)
      await prisma.message.updateMany({ where: { eventId: sent.noticeEventId! }, data: { status: 'bounced' } })
      await reconcileRateIncreaseNotices(facilityId, () => {})

      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: row.id } })
      expect(after.status).toBe('notice_failed')
      return { heldId: row.id, leaseId, eventId: sent.noticeEventId! }
    }

    /// The tenant got a working address. Everything below except the refusal
    /// test needs this first, which is itself the point of the refusal test.
    async function correctTheAddress(leaseId: string): Promise<void> {
      const lease = await prisma.lease.findUniqueOrThrow({
        where: { id: leaseId },
        select: { tenantId: true },
      })
      await prisma.tenant.update({
        where: { id: lease.tenantId },
        data: { email: `fixed-${randomUUID().slice(0, 8)}@example.com` },
      })
    }

    it('refuses while the tenant still has the address the notice bounced at, naming it', async () => {
      const { heldId, leaseId } = await held()
      const lease = await prisma.lease.findUniqueOrThrow({
        where: { id: leaseId },
        select: { tenant: { select: { email: true } } },
      })

      const result = await renoticeRateIncrease(manager(), heldId, 'trying again')
      expect(result).toMatchObject({ ok: false })
      // The address itself, not "the address is bad" — the operator has to
      // know which one to go and change.
      expect((result as { reason: string }).reason).toContain(lease.tenant.email)

      // And nothing moved: a refused re-notice must not have cancelled the
      // held row on its way out.
      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: heldId } })
      expect(after.status).toBe('notice_failed')
    })

    it('clones at the same delta, carries the approval, and cancels the held row', async () => {
      const { heldId, leaseId } = await held()
      await correctTheAddress(leaseId)

      const result = await renoticeRateIncrease(manager(), heldId, 'new address from the tenant')
      expect(result).toMatchObject({ ok: true })

      const oldRow = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: heldId } })
      expect(oldRow.status).toBe('cancelled')

      const clone = await prisma.tenantRateIncrease.findUniqueOrThrow({
        where: { id: (result as { id: string }).id },
      })
      expect(clone.currentRateCents).toBe(oldRow.currentRateCents)
      expect(clone.newRateCents).toBe(oldRow.newRateCents)
      // Approved, by the original approver: the figure they signed off on is
      // unchanged, so the sign-off still describes it.
      expect(clone.status).toBe('approved')
      expect(clone.approvedByStaffId).toBe(regionalId)
      expect(clone.renoticedFromId).toBe(heldId)
      // The clock restarted, which is a statement about the PERIOD, not about
      // the date moving: the tenant gets a full notice period between the new
      // notice and the effective date, and the notice is never scheduled into
      // a day that has already passed. A held increase with weeks of runway
      // left keeps the date the tenant would have been told about anyway.
      expect(
        Math.round((clone.effectiveDate.getTime() - clone.noticeDate.getTime()) / 86_400_000),
      ).toBe(clone.noticeDays)
      expect(clone.noticeDate.getTime()).toBeGreaterThanOrEqual(daysFromNow(0).getTime())

      // One live increase on the lease, not two.
      const live = await prisma.tenantRateIncrease.findMany({
        where: { leaseId, status: { in: ['pending_approval', 'approved', 'notice_sent', 'notice_failed'] } },
      })
      expect(live).toHaveLength(1)
    })

    it('slides the effective date forward when the hold ate the notice period', async () => {
      // The case the date arithmetic exists for: by the time somebody gets a
      // working address there are five days left, and re-noticing on the old
      // date would give the tenant five days' notice for a thirty-day
      // requirement.
      const { heldId, leaseId } = await held(31)
      await prisma.tenantRateIncrease.update({
        where: { id: heldId },
        data: { effectiveDate: daysFromNow(5), noticeDate: daysFromNow(-25) },
      })
      await correctTheAddress(leaseId)

      const result = await renoticeRateIncrease(manager(), heldId, 'new address')
      expect(result).toMatchObject({ ok: true })
      const clone = await prisma.tenantRateIncrease.findUniqueOrThrow({
        where: { id: (result as { id: string }).id },
      })
      expect(clone.effectiveDate.getTime()).toBe(daysFromNow(clone.noticeDays).getTime())
      expect(clone.noticeDate.getTime()).toBe(daysFromNow(0).getTime())
    })

    it('re-notices and then actually applies, end to end', async () => {
      const { heldId, leaseId } = await held()
      await correctTheAddress(leaseId)
      const result = await renoticeRateIncrease(manager(), heldId, 'new address')
      const cloneId = (result as { id: string }).id
      const clone = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: cloneId } })

      await sendDueRateIncreaseNotices(facilityId, clone.noticeDate, () => {})
      const noticed = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: cloneId } })
      expect(noticed.status).toBe('notice_sent')
      const event = await prisma.domainEvent.findUniqueOrThrow({ where: { id: noticed.noticeEventId! } })
      await processCommsEvent(event)

      const applied = await applyDueRateIncreases(facilityId, clone.effectiveDate, () => {})
      expect(applied.applied).toBe(1)
      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.monthlyRateCents).toBe(14_900)
    })

    it('closes the undelivered-notice task — and a note never could have', async () => {
      const { heldId, leaseId } = await held()
      await correctTheAddress(leaseId)
      await renoticeRateIncrease(manager(), heldId, 'new address')

      const task = await prisma.task.findFirstOrThrow({
        where: { type: 'rate_increase_notice_undelivered', entityId: leaseId },
        orderBy: { createdAt: 'desc' },
      })
      expect(task.status).toBe('completed')
    })

    it('cancelling a held increase closes the task too — the other honest ending', async () => {
      const { heldId, leaseId } = await held()
      expect(await cancelRateIncrease(manager(), heldId, 'tenant is moving out anyway')).toEqual({ ok: true })

      const task = await prisma.task.findFirstOrThrow({
        where: { type: 'rate_increase_notice_undelivered', entityId: leaseId },
        orderBy: { createdAt: 'desc' },
      })
      expect(task.status).toBe('completed')
    })

    it('refuses when the tenant now pays something else — the approved delta no longer describes them', async () => {
      const { heldId, leaseId } = await held()
      await correctTheAddress(leaseId)
      await applyRateChange({
        leaseId,
        newRateCents: 11_900,
        effectiveFrom: new Date(),
        reason: 'retention',
      })

      const result = await renoticeRateIncrease(manager(), heldId, 'trying again')
      expect(result).toMatchObject({ ok: false })
      const after = await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: heldId } })
      expect(after.status).toBe('notice_failed')
    })

    it('refuses anything that is not held', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      expect(await renoticeRateIncrease(manager(), row.id, 'why not')).toMatchObject({ ok: false })
    })

    it('the batch re-notices the corrected ones and names the rest', async () => {
      const first = await held(46)
      const second = await held(47)
      await correctTheAddress(first.leaseId)

      const result = await renoticeHeldIncreases(manager(), facilityId, 'the mail server outage')
      expect(result.renoticed).toBe(1)
      // The one that could not go is reported by name, not swallowed by a
      // count — it is the only row anybody still has to do something about.
      expect(result.refused).toHaveLength(1)
      expect(result.refused[0]?.tenantName).toContain('Ada')

      expect(
        (await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: first.heldId } })).status,
      ).toBe('cancelled')
      expect(
        (await prisma.tenantRateIncrease.findUniqueOrThrow({ where: { id: second.heldId } })).status,
      ).toBe('notice_failed')
    })
  })

  // B-153 / PRD 02 §4.3 US-11, §3. The retention save. B-076 built the
  // increase and ECRI is what creates the demand for this; without it a
  // manager keeping a good tenant edits the lease rate directly, bypassing
  // the write-through US-11's schema AC exists to enforce.
  describe('lowering a rate (B-153: the retention save)', () => {
    it('lowers the rate with no notice period and no separate approval', async () => {
      const { leaseId } = await makeLease()
      const result = await scheduleRateDecrease(saver(managerId, 20, 5_000), facilityId, {
        leaseId,
        newRateCents: 11_900,
        effectiveDate: daysFromNow(1),
        reasonCode: 'threatened to move to the place on Lamar',
      })
      expect(result).toMatchObject({ ok: true })

      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      // Approved by the act of making it — the authority check IS the approval.
      expect(row.status).toBe('approved')
      expect(row.approvedByStaffId).toBe(managerId)
      expect(row.noticeDays).toBe(0)

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'rate.tenant_decreased', entityId: row.id },
      })
      expect(audit.reasonCode).toBe('threatened to move to the place on Lamar')
    })

    it('applies on its effective date through applyRateChange, with reason retention', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateDecrease(saver(managerId, 20, 5_000), facilityId, {
        leaseId,
        newRateCents: 11_900,
        effectiveDate: daysFromNow(1),
        reasonCode: 'retention',
      })

      const result = await applyDueRateIncreases(facilityId, daysFromNow(1), () => {})
      expect(result.applied).toBe(1)

      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.monthlyRateCents).toBe(11_900)

      const history = await prisma.leaseRateChange.findFirstOrThrow({
        where: { leaseId, reason: 'retention' },
      })
      expect(history.previousRateCents).toBe(12_900)
      expect(history.newRateCents).toBe(11_900)
    })

    it('never emails a rate-increase notice for a decrease', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateDecrease(saver(managerId, 20, 5_000), facilityId, {
        leaseId,
        newRateCents: 11_900,
        effectiveDate: daysFromNow(1),
        reasonCode: 'retention',
      })

      // The notice job selects on `status: 'approved'`, which a decrease is
      // from creation — the direction check in `noticeIsDue` is the only
      // thing standing between this tenant and a letter saying their rent is
      // going up.
      const result = await sendDueRateIncreaseNotices(facilityId, daysFromNow(30), () => {})
      expect(result.sent).toBe(0)
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      expect(row.status).toBe('approved')
    })

    it('escalates over the actor’s own monthly credit limit rather than refusing flatly', async () => {
      const { leaseId } = await makeLease()
      const result = await scheduleRateDecrease(saver(managerId, 20, 5_000), facilityId, {
        leaseId,
        // $69 a month off a $129 rate — over a $50 limit.
        newRateCents: 6_000,
        effectiveDate: daysFromNow(1),
        reasonCode: 'retention',
      })
      expect(result).toMatchObject({ ok: false, overLimit: true, limitCents: 5_000 })
      expect(await prisma.tenantRateIncrease.count({ where: { leaseId } })).toBe(0)
    })

    it('refuses somebody with no monetary authority at all', async () => {
      const { leaseId } = await makeLease()
      // The increase permission is not the decrease permission, deliberately:
      // `rates:tenant_increase` is regional-and-above by seed and this has to
      // reach a manager at the counter.
      const result = await scheduleRateDecrease(regional(), facilityId, {
        leaseId,
        newRateCents: 11_900,
        effectiveDate: daysFromNow(1),
        reasonCode: 'retention',
      })
      expect(result).toMatchObject({ ok: false })
      expect('overLimit' in result).toBe(false)
    })

    it('refuses without a reason, and refuses a rate that is not lower', async () => {
      const { leaseId } = await makeLease()
      const actor = saver(managerId, 20, null)
      expect(
        await scheduleRateDecrease(actor, facilityId, {
          leaseId,
          newRateCents: 11_900,
          effectiveDate: daysFromNow(1),
          reasonCode: '   ',
        }),
      ).toMatchObject({ ok: false })
      expect(
        await scheduleRateDecrease(actor, facilityId, {
          leaseId,
          newRateCents: 13_900,
          effectiveDate: daysFromNow(1),
          reasonCode: 'retention',
        }),
      ).toMatchObject({ ok: false })
      expect(await prisma.tenantRateIncrease.count({ where: { leaseId } })).toBe(0)
    })

    it('will not sit alongside a live increase on the same lease, in either order', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateIncrease(manager(), facilityId, {
        leaseId,
        newRateCents: 14_900,
        effectiveDate: daysFromNow(45),
      })
      expect(
        await scheduleRateDecrease(saver(managerId, 20, null), facilityId, {
          leaseId,
          newRateCents: 11_900,
          effectiveDate: daysFromNow(1),
          reasonCode: 'retention',
        }),
      ).toMatchObject({ ok: false })

      const { leaseId: otherLeaseId } = await makeLease()
      await scheduleRateDecrease(saver(managerId, 20, null), facilityId, {
        leaseId: otherLeaseId,
        newRateCents: 11_900,
        effectiveDate: daysFromNow(1),
        reasonCode: 'retention',
      })
      expect(
        await scheduleRateIncrease(manager(), facilityId, {
          leaseId: otherLeaseId,
          newRateCents: 14_900,
          effectiveDate: daysFromNow(45),
        }),
      ).toMatchObject({ ok: false })
    })

    it('shows on the review screen as a decrease and nets off the projected delta', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateDecrease(saver(managerId, 20, null), facilityId, {
        leaseId,
        newRateCents: 11_900,
        effectiveDate: daysFromNow(1),
        reasonCode: 'retention',
      })

      const review = await pendingRateIncreases(manager(), facilityId)
      const row = review.rows.find((one) => one.leaseId === leaseId)
      expect(row?.isDecrease).toBe(true)
      expect(row?.newRateCents).toBe(11_900)
    })

    it('is cancellable before its effective date, and then never applies', async () => {
      const { leaseId } = await makeLease()
      await scheduleRateDecrease(saver(managerId, 20, null), facilityId, {
        leaseId,
        newRateCents: 11_900,
        effectiveDate: daysFromNow(2),
        reasonCode: 'retention',
      })
      const row = await prisma.tenantRateIncrease.findFirstOrThrow({ where: { leaseId } })
      expect(await cancelRateIncrease(manager(), row.id, 'they left anyway')).toEqual({ ok: true })

      const result = await applyDueRateIncreases(facilityId, daysFromNow(5), () => {})
      expect(result.applied).toBe(0)
      const lease = await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })
      expect(lease.monthlyRateCents).toBe(12_900)
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

  // B-177 / PRD 02 §4.3 US-11. The picker that replaced a free-text "Lease ID".
  //
  // The defect it closes is not a typo in a form: both money forms took a raw
  // cuid, so a mistyped one permanently reduced a DIFFERENT tenant's rate with
  // a reason code recorded against them. What has to hold is that the list can
  // only offer leases a rate change is legal on, and that a manager who can
  // only lower a rate can still reach it.
  describe('activeLeaseOptions', () => {
    it('offers each occupying lease with the tenant, the unit and what they pay now', async () => {
      const { leaseId, unitId } = await makeLease({ monthlyRateCents: 13_400 })
      const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })

      const options = await activeLeaseOptions(manager(), facilityId)

      expect(options).toEqual([
        {
          id: leaseId,
          tenantName: 'Ada Renter',
          unitNumber: unit.number,
          monthlyRateCents: 13_400,
        },
      ])
    })

    it('never offers a lease that has ended', async () => {
      const open = await makeLease()
      const closed = await makeLease()
      await prisma.lease.update({ where: { id: closed.leaseId }, data: { status: 'ended' } })

      const ids = (await activeLeaseOptions(manager(), facilityId)).map((option) => option.id)

      expect(ids).toContain(open.leaseId)
      // The whole point of the picker: a rate change scheduled against this
      // lease is refused by both services, so offering it is offering a dead end.
      expect(ids).not.toContain(closed.leaseId)
    })

    it('is reachable on the retention-save authority alone', async () => {
      const { leaseId } = await makeLease()

      // `credits:manual` and no `rates:tenant_increase` — a manager who can
      // lower a rate but not raise one still has to say whose.
      const options = await activeLeaseOptions(saver(managerId, 20, 5_000), facilityId)

      expect(options.map((option) => option.id)).toEqual([leaseId])
    })

    it('refuses an actor holding neither authority', async () => {
      await makeLease()
      const bookkeeper: Actor = {
        kind: 'staff',
        staffUserId: managerId,
        assignments: [
          {
            facilityId,
            roleKey: 'manager',
            rank: 20,
            permissions: new Set<PermissionKey>(['tenants:view'] as never),
            limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
          },
        ],
      }

      await expect(activeLeaseOptions(bookkeeper, facilityId)).rejects.toThrow()
    })
  })
})
