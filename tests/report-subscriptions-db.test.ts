import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { PermissionKey } from '@storage/db/rbac-catalog'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import {
  addSubscription,
  buildReportEmail,
  parseRecipients,
  removeSubscription,
  sendDueReports,
  subscriptionsFor,
} from '../apps/web/lib/admin/report-subscriptions'
import { periodFor } from '../packages/core/comms'
import { closePeriod } from '../apps/web/lib/admin/accounting-close'

// PRD 02 US-40 (B-084 part 3). Scheduled report emails, against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''
const TZ = 'America/Chicago'

function actor(permissions: PermissionKey[] = ['reports:financial', 'reports:operational', 'accounting:close']): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'regional',
        rank: 30,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

function facility() {
  return { id: facilityId, name: `Subs ${suffix}`, timezone: TZ }
}

describeDb('scheduled report emails', () => {
  beforeAll(async () => {
    const created = await prisma.facility.create({
      data: {
        name: `Subs ${suffix}`,
        slug: `subs-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: TZ,
      },
    })
    facilityId = created.id

    const staff = await prisma.staffUser.create({
      data: { email: `subs-${suffix}@example.com`, firstName: 'Ren', lastName: 'Regional' },
    })
    staffId = staff.id
  })

  beforeEach(async () => {
    await prisma.reportSubscription.deleteMany({ where: { facilityId } })
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.accountingPeriod.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.reportSubscription.deleteMany({ where: { facilityId } })
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.accountingPeriod.deleteMany({ where: { facilityId } })
    // The facility deliberately stays: `audit_log` holds a foreign key to it
    // and is append-only, so removing it would mean deleting the audit entries
    // subscribing and closing just wrote.
    await prisma.$disconnect()
  })

  describe('the recipient list', () => {
    it('splits on commas, semicolons and newlines, and lower-cases', () => {
      const parsed = parseRecipients(' Owner@Example.com , ops@example.com\nboss@example.com')
      expect(parsed.ok).toBe(true)
      expect(parsed.ok === true && parsed.addresses).toEqual([
        'owner@example.com',
        'ops@example.com',
        'boss@example.com',
      ])
    })

    it('de-duplicates rather than sending twice', () => {
      const parsed = parseRecipients('a@example.com, A@example.com')
      expect(parsed.ok === true && parsed.addresses).toEqual(['a@example.com'])
    })

    it('REFUSES a bad address rather than dropping it', () => {
      // Silently ignoring one is how a report goes to three people when
      // somebody meant four, and nobody finds out until a month-end question
      // goes unanswered.
      const parsed = parseRecipients('good@example.com, not-an-address')
      expect(parsed.ok).toBe(false)
      expect(parsed.ok === false && parsed.problem).toContain('not-an-address')
    })

    it('refuses an empty list', () => {
      expect(parseRecipients('   ').ok).toBe(false)
    })
  })

  describe('managing subscriptions', () => {
    it('adds, lists and removes one', async () => {
      expect(
        (await addSubscription(actor(), facilityId, {
          reportKey: 'revenue',
          cadence: 'weekly',
          recipients: 'owner@example.com',
        })).ok,
      ).toBe(true)

      const rows = await subscriptionsFor(actor(), facilityId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ reportKey: 'revenue', cadence: 'weekly', active: true })

      await removeSubscription(actor(), rows[0].id)
      expect(await subscriptionsFor(actor(), facilityId)).toHaveLength(0)
    })

    it('refuses a report key that is not in the catalog', async () => {
      const result = await addSubscription(actor(), facilityId, {
        reportKey: 'everything',
        cadence: 'daily',
        recipients: 'owner@example.com',
      })
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.field).toBe('reportKey')
    })

    it('refuses somebody without financial reporting access', async () => {
      const counter: Actor = {
        kind: 'staff',
        staffUserId: staffId,
        assignments: [
          {
            facilityId,
            roleKey: 'counter',
            rank: 10,
            permissions: new Set<PermissionKey>(['reports:operational']),
            limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
          },
        ],
      }
      await expect(subscriptionsFor(counter, facilityId)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe('sending', () => {
    async function subscribe(cadence: 'daily' | 'weekly' | 'monthly') {
      await addSubscription(actor(), facilityId, {
        reportKey: 'occupancy',
        cadence,
        recipients: 'owner@example.com, ops@example.com',
      })
    }

    it('sends one message per recipient, once', async () => {
      await subscribe('daily')
      const summary = await sendDueReports(facility(), new Date('2026-08-18T12:00:00Z'))
      expect(summary.sent).toBe(2)

      const messages = await prisma.message.findMany({ where: { facilityId } })
      expect(messages).toHaveLength(2)
      expect(messages.map((message) => message.toAddress).sort()).toEqual([
        'ops@example.com',
        'owner@example.com',
      ])
    })

    it('does not send the same period twice, however often the job runs', async () => {
      // There is no `lastSentAt` column — the message idempotency key IS the
      // record, so a re-run or a retry is safe by construction.
      await subscribe('daily')
      await sendDueReports(facility(), new Date('2026-08-18T12:00:00Z'))
      await sendDueReports(facility(), new Date('2026-08-18T18:00:00Z'))

      expect(await prisma.message.count({ where: { facilityId } })).toBe(2)
    })

    it('sends again on the next day, because the period changed', async () => {
      await subscribe('daily')
      await sendDueReports(facility(), new Date('2026-08-18T12:00:00Z'))
      await sendDueReports(facility(), new Date('2026-08-19T12:00:00Z'))

      expect(await prisma.message.count({ where: { facilityId } })).toBe(4)
    })

    it('skips a weekly on a day that is not Monday', async () => {
      await subscribe('weekly')
      // 2026-08-18 is a Tuesday.
      const summary = await sendDueReports(facility(), new Date('2026-08-18T12:00:00Z'))
      expect(summary.sent).toBe(0)
      expect(await prisma.message.count({ where: { facilityId } })).toBe(0)
    })

    it('sends a weekly on Monday', async () => {
      await subscribe('weekly')
      const summary = await sendDueReports(facility(), new Date('2026-08-17T12:00:00Z'))
      expect(summary.sent).toBe(2)
    })

    it('classifies a report as operational, not marketing', async () => {
      // A staff report about a business carries no tenant consent question —
      // but sending it as marketing would put it behind a consent gate that
      // does not apply and a suppression lane that does not fit.
      await subscribe('daily')
      await sendDueReports(facility(), new Date('2026-08-18T12:00:00Z'))
      const message = await prisma.message.findFirstOrThrow({ where: { facilityId } })
      expect(message.classification).toBe('operational')
    })
  })

  describe('the job that actually sends them', () => {
    it('is registered in SCHEDULED_JOBS, at the hour the screen promises', async () => {
      // This test exists because the registration was MISSED once. Every other
      // piece of part 3 was built and tested — the model, the renderer, the
      // schedule, the send, the screen — and none of it would ever have run,
      // because nothing wired the handler into the cron. A feature that is
      // fully tested and never invoked is the failure mode a unit suite is
      // least likely to notice, so the wiring itself is now asserted.
      const { SCHEDULED_JOBS } = await import('../apps/web/lib/jobs/registry')
      const job = SCHEDULED_JOBS.find((entry) => entry.name === 'reports.email')

      expect(job, 'reports.email is not registered — scheduled reports would never send').toBeDefined()
      // 6am facility-local, which is what the settings screen tells operators
      // and what puts it after the 2am and 3am overnight sweeps.
      expect(job!.localHour).toBe(6)
      expect(job!.scope).toBe('per_facility')
    })
  })

  describe('a monthly report and the close', () => {
    it('says the month can still change when it is not closed', async () => {
      const period = periodFor('monthly', { year: 2026, month: 6, day: 1 }, TZ)
      const built = await buildReportEmail(
        { id: 'sub_x', facilityId, reportKey: 'occupancy', cadence: 'monthly' },
        'Subs',
        period,
      )
      expect(built!.text).toContain('has not been closed yet')
      expect(built!.text).toContain('can still change')
    })

    it('says the figures are filed once the month is closed', async () => {
      // The link that makes part 1 pay for itself: a monthly email showing
      // numbers that quietly differ from the filed ones is the confusion the
      // close exists to remove.
      await closePeriod(actor(), facilityId, 2026, 5)
      const period = periodFor('monthly', { year: 2026, month: 6, day: 1 }, TZ)
      const built = await buildReportEmail(
        { id: 'sub_x', facilityId, reportKey: 'occupancy', cadence: 'monthly' },
        'Subs',
        period,
      )
      expect(built!.text).toContain('is closed')
      expect(built!.text).toContain('will not change')
    })
  })
})
