import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { runDelinquencyTimeline } from '../apps/web/lib/delinquency/engine'
import { saveTimeline } from '../apps/web/lib/admin/delinquency-timeline'
import type { TimelineStep } from '../packages/core/delinquency'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-057 / PRD 02 FR-5, US-25, US-28, against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const noop = () => {}

let facilityId = ''
let staffId = ''
let tenantId = ''
let leaseId = ''
let unitId = ''

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['facility:settings']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

const step = (dayOffset: number, label: string, over: Partial<TimelineStep> = {}): TimelineStep => ({
  dayOffset,
  label,
  automatedActions: [],
  noticeTemplateKey: null,
  deliveryMethods: [],
  staffTaskLabel: null,
  requiredProofFields: [],
  ...over,
})

/// A lease $129 past due, with the ledger to match.
///
/// `month` because `(leaseId, periodStart)` is the invoice generator's own
/// idempotency key — a second overdue invoice has to be a different period, the
/// same way a real second month would be.
async function makeOverdueLease(month: '06' | '07' = '06') {
  const start = d(`2026-${month}-01`)
  const end = d(month === '06' ? '2026-07-01' : '2026-08-01')
  const invoice = await prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `D${suffix}${Math.floor(Math.random() * 9000 + 1000)}`,
      kind: 'rent',
      status: 'open',
      issueDate: start,
      dueDate: start,
      periodStart: start,
      periodEnd: end,
      subtotalCents: 12_900,
      totalCents: 12_900,
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId,
      invoiceId: invoice.id,
      type: 'charge',
      amountCents: 12_900,
      description: 'Rent',
      occurredAt: start,
    },
  })
  return invoice
}

describeDb('the delinquency engine', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Engine ${suffix}`,
        slug: `engine-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `engine-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
    const tenant = await prisma.tenant.create({
      data: { email: `engine-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `E-${suffix.slice(0, 4)}` },
    })
    unitId = unit.id
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId,
        status: 'active',
        startDate: d('2026-06-01'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.delinquencyStepRun.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    // B-138's cases open a second lease pointing at this one.
    await prisma.lease.deleteMany({ where: { facilityId, transferredFromLeaseId: { not: null } } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.lease.update({
      where: { id: leaseId },
      data: { delinquencyTimelineId: null, status: 'active' },
    })
    await prisma.delinquencyTimeline.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.delinquencyStepRun.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('does nothing at all when no timeline is configured', async () => {
    await makeOverdueLease()
    const result = await runDelinquencyTimeline(facilityId, d('2026-07-15'), noop)

    expect(result.skippedNoTimeline).toBe(true)
    expect(result.stepsExecuted).toBe(0)
    expect(await prisma.delinquencyStepRun.count({ where: { facilityId } })).toBe(0)
  })

  it('runs every passed step once and records the history', async () => {
    await saveTimeline(actor(), facilityId, {
      label: 'Test',
      qualifyingAmount: 'full_balance',
      steps: [step(1, 'Late'), step(15, 'Pre-lien'), step(30, 'Lien')],
    })
    await makeOverdueLease()

    // 2026-07-15 is 44 days past a 1 June due date.
    const result = await runDelinquencyTimeline(facilityId, d('2026-07-15'), noop)
    expect(result.stepsExecuted).toBe(3)

    const runs = await prisma.delinquencyStepRun.findMany({
      where: { leaseId },
      orderBy: { dayOffset: 'asc' },
    })
    expect(runs.map((one) => one.dayOffset)).toEqual([1, 15, 30])
    expect(runs[0].label).toBe('Late')
  })

  it('is idempotent — a second run the same night changes nothing', async () => {
    await saveTimeline(actor(), facilityId, {
      label: 'Test',
      qualifyingAmount: 'full_balance',
      steps: [step(1, 'Late'), step(15, 'Pre-lien')],
    })
    await makeOverdueLease()

    await runDelinquencyTimeline(facilityId, d('2026-07-15'), noop)
    const second = await runDelinquencyTimeline(facilityId, d('2026-07-15'), noop)

    expect(second.stepsExecuted).toBe(0)
    expect(await prisma.delinquencyStepRun.count({ where: { leaseId } })).toBe(2)
  })

  it('pins the timeline version that governed the lease — US-25', async () => {
    await saveTimeline(actor(), facilityId, {
      label: 'Governing',
      qualifyingAmount: 'full_balance',
      steps: [step(1, 'Late')],
    })
    await makeOverdueLease()
    await runDelinquencyTimeline(facilityId, d('2026-07-15'), noop)

    const lease = await prisma.lease.findUniqueOrThrow({
      where: { id: leaseId },
      include: { delinquencyTimeline: true },
    })
    expect(lease.delinquencyTimeline?.label).toBe('Governing')
  })

  it('raises a staff task for a step that needs a person', async () => {
    await saveTimeline(actor(), facilityId, {
      label: 'Test',
      qualifyingAmount: 'full_balance',
      // Deliberately not an overlock: since B-058 a step whose label says
      // overlock routes to the typed task with its own record and photo, and
      // that path is asserted in overlock-db.test.ts. This covers everything
      // else an operator might put a person on.
      steps: [
        step(1, 'Certified letter', { staffTaskLabel: 'Post it', requiredProofFields: ['tracking_number'] }),
      ],
    })
    await makeOverdueLease()
    await runDelinquencyTimeline(facilityId, d('2026-07-15'), noop)

    const task = await prisma.task.findFirstOrThrow({
      where: { facilityId, type: 'delinquency_step', entityId: leaseId },
    })
    expect(task.status).toBe('open')
    expect(task.priority).toBe('high')
  })

  it('suspends the gate through B-098’s own path, with the same cause', async () => {
    const grant = await prisma.accessGrant.create({
      data: { facilityId, tenantId, state: 'active', stateCause: 'system:move_in' },
    })
    await saveTimeline(actor(), facilityId, {
      label: 'Test',
      qualifyingAmount: 'full_balance',
      steps: [step(6, 'Access denied', { automatedActions: ['suspend_access'] })],
    })
    await makeOverdueLease()
    await runDelinquencyTimeline(facilityId, d('2026-07-15'), noop)

    const after = await prisma.accessGrant.findUniqueOrThrow({ where: { id: grant.id } })
    expect(after.state).toBe('suspended')
    // The same cause the threshold rule uses — a suspended gate must look
    // identical however it was reached.
    expect(after.stateCause).toBe('system:delinquency')
  })

  it('emits stage_changed with where it moved from and to', async () => {
    await saveTimeline(actor(), facilityId, {
      label: 'Test',
      qualifyingAmount: 'full_balance',
      steps: [step(1, 'Late'), step(15, 'Pre-lien')],
    })
    await makeOverdueLease()
    await runDelinquencyTimeline(facilityId, d('2026-07-15'), noop)

    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { name: 'delinquency.stage_changed', entityId: leaseId },
      orderBy: { occurredAt: 'desc' },
    })
    expect((event.payload as Record<string, unknown>).to).toBe('Pre-lien')
  })

  // B-138 / D-86. The arrears now move to the lease a transfer opens, so the
  // tenant arrives here with the full `daysPastDue` and no step runs of their
  // own. Without the chain read that restarts the whole notice sequence.
  describe('across a transfer (B-138)', () => {
    /// The shape `completeTransfer` leaves behind: the old lease ended, the new
    /// one carrying the link, the standing and the invoices. Built by hand
    /// rather than by calling the transfer so this suite tests the ENGINE.
    let transferCounter = 0
    async function transferredLease(invoiceId: string) {
      transferCounter += 1
      const unit = await prisma.unit.create({
        data: {
          facilityId,
          unitTypeId: (await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })).unitTypeId,
          number: `E2-${suffix.slice(0, 4)}-${transferCounter}`,
        },
      })
      const created = await prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: unit.id,
          status: 'delinquent',
          startDate: d('2026-07-16'),
          billingDay: 1,
          monthlyRateCents: 12_900,
          transferredFromLeaseId: leaseId,
        },
      })
      await prisma.lease.update({
        where: { id: leaseId },
        data: { status: 'ended', endDate: d('2026-07-16'), moveOutReason: 'transfer' },
      })
      await prisma.invoice.update({ where: { id: invoiceId }, data: { leaseId: created.id } })
      await prisma.ledgerEntry.updateMany({
        where: { leaseId, invoiceId },
        data: { leaseId: created.id },
      })
      return created
    }

    it('resumes at the step it was on rather than sending day 1 again', async () => {
      await saveTimeline(actor(), facilityId, {
        label: 'Test',
        qualifyingAmount: 'full_balance',
        steps: [step(1, 'First notice'), step(30, 'Second notice')],
      })
      const invoice = await makeOverdueLease()
      await runDelinquencyTimeline(facilityId, d('2026-06-05'), noop)
      expect(await prisma.delinquencyStepRun.count({ where: { leaseId, supersededAt: null } })).toBe(1)

      const created = await transferredLease(invoice.id)

      // Day 30 from a 1 June due date. Day 1 is behind us and already served.
      const result = await runDelinquencyTimeline(facilityId, d('2026-07-01'), noop)
      expect(result.stepsExecuted).toBe(1)

      const runs = await prisma.delinquencyStepRun.findMany({
        where: { leaseId: created.id, supersededAt: null },
      })
      expect(runs.map((run) => run.dayOffset)).toEqual([30])
      // And the evidence stayed where the notice was actually served from.
      expect(
        await prisma.delinquencyStepRun.count({ where: { leaseId, dayOffset: 1 } }),
      ).toBe(1)
    })

    it('closes the whole episode on cure, including the steps served before the move', async () => {
      await saveTimeline(actor(), facilityId, {
        label: 'Test',
        qualifyingAmount: 'full_balance',
        steps: [step(1, 'First notice')],
      })
      const invoice = await makeOverdueLease()
      await runDelinquencyTimeline(facilityId, d('2026-06-05'), noop)
      const created = await transferredLease(invoice.id)

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { amountPaidCents: 12_900, status: 'paid' },
      })
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId: created.id,
          invoiceId: invoice.id,
          type: 'payment',
          amountCents: -12_900,
          description: 'Paid',
          occurredAt: d('2026-07-02'),
        },
      })

      // Both leases in the chain are in the same facility scan, so the ended
      // one also reaches `cured` on its own. This asserts the OUTCOME — no open
      // step run survives anywhere in the chain — rather than which of the two
      // closed it, because the new lease's cure must not depend on the old one
      // happening to cure itself in the same run.
      const result = await runDelinquencyTimeline(facilityId, d('2026-07-02'), noop)
      expect(result.cured).toBeGreaterThanOrEqual(1)
      // Superseded, not deleted, and on the lease it was served from — leaving
      // it open would resume a cured tenant at day 1 if they fall behind again.
      expect(
        await prisma.delinquencyStepRun.count({ where: { facilityId, supersededAt: null } }),
      ).toBe(0)
      expect(await prisma.delinquencyStepRun.count({ where: { leaseId } })).toBe(1)
    })
  })

  describe('cure — US-25’s AC', () => {
    it('halts, cancels open tasks and keeps the history', async () => {
      await saveTimeline(actor(), facilityId, {
        label: 'Test',
        qualifyingAmount: 'full_balance',
        steps: [
          step(1, 'Certified letter', { staffTaskLabel: 'Post it', requiredProofFields: ['tracking_number'] }),
        ],
      })
      const invoice = await makeOverdueLease()
      await runDelinquencyTimeline(facilityId, d('2026-07-15'), noop)
      expect(await prisma.delinquencyStepRun.count({ where: { leaseId, supersededAt: null } })).toBe(1)

      // They pay.
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          invoiceId: invoice.id,
          type: 'payment',
          amountCents: -12_900,
          description: 'Paid',
          occurredAt: d('2026-07-16'),
        },
      })
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { amountPaidCents: 12_900, status: 'paid' },
      })

      const result = await runDelinquencyTimeline(facilityId, d('2026-07-16'), noop)
      expect(result.cured).toBe(1)

      // The step history SURVIVES — it is the evidence US-28 needs — but stops
      // counting as executed.
      expect(await prisma.delinquencyStepRun.count({ where: { leaseId } })).toBe(1)
      expect(await prisma.delinquencyStepRun.count({ where: { leaseId, supersededAt: null } })).toBe(0)

      // Nobody applied the overlock, so the task is cancelled rather than
      // completed — a proof-less "completed" in the history is worse than none.
      const task = await prisma.task.findFirstOrThrow({
        where: { facilityId, entityId: leaseId, type: 'delinquency_step' },
      })
      expect(task.status).toBe('cancelled')
    })

    it('starts over rather than resuming when a cured lease falls behind again', async () => {
      await saveTimeline(actor(), facilityId, {
        label: 'Test',
        qualifyingAmount: 'full_balance',
        steps: [step(1, 'Late')],
      })
      const first = await makeOverdueLease()
      await runDelinquencyTimeline(facilityId, d('2026-07-15'), noop)

      await prisma.ledgerEntry.create({
        data: {
          facilityId, leaseId, invoiceId: first.id, type: 'payment',
          amountCents: -12_900, description: 'Paid', occurredAt: d('2026-07-16'),
        },
      })
      await prisma.invoice.update({
        where: { id: first.id },
        data: { amountPaidCents: 12_900, status: 'paid' },
      })
      await runDelinquencyTimeline(facilityId, d('2026-07-16'), noop)

      // A new month, unpaid. Day 1 must fire again — a partial unique index
      // scoped to the open episode is what allows it.
      await makeOverdueLease('07')
      const again = await runDelinquencyTimeline(facilityId, d('2026-08-15'), noop)
      expect(again.stepsExecuted).toBe(1)
      expect(await prisma.delinquencyStepRun.count({ where: { leaseId } })).toBe(2)
    })
  })

  it('advances nothing while a hold is in force', async () => {
    await saveTimeline(actor(), facilityId, {
      label: 'Test',
      qualifyingAmount: 'full_balance',
      steps: [step(1, 'Late')],
    })
    await makeOverdueLease()
    await prisma.leaseHold.create({
      data: {
        leaseId,
        type: 'military_scra',
        reason: 'Deployed',
        effectiveFrom: d('2026-06-01'),
        placedByStaffId: staffId,
      },
    })

    const result = await runDelinquencyTimeline(facilityId, d('2026-07-15'), noop)
    expect(result.stepsExecuted).toBe(0)
    expect(result.halted).toBe(1)

    await prisma.leaseHold.deleteMany({ where: { leaseId } })
  })
})
