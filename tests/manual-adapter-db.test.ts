import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { drainGateCommands, enqueueCommand } from '../apps/web/lib/access/service'
import { switchGateAdapter } from '../apps/web/lib/access/manual-adapter'
import { manualQueue } from '../apps/web/lib/access/manual-queue'
import { completeTask } from '../apps/web/lib/admin/tasks'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-065 / PRD 03 US-6, against real rows.
//
// The loop: a facility on the manual adapter turns every gate command into a
// task with real instructions, the command parks rather than retrying, and
// completing the task is what settles it. Then AC3 — switching back has to
// preserve grants and re-route the queue.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let grantId = ''
let credentialId = ''
let staffId = ''
let commandSeq = 0

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(['tenants:view', 'tenants:edit', 'facility:settings']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function queueCommand(type: 'set_credential' | 'revoke_access' | 'suspend_access') {
  commandSeq += 1
  await enqueueCommand({
    facilityId,
    grantId,
    credentialId: type === 'set_credential' ? credentialId : undefined,
    type,
    idempotencyKey: `manual-${suffix}-${commandSeq}`,
    payload: type === 'set_credential' ? { code: '482913' } : {},
  })
}

describeDb('the manual adapter', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Manual ${suffix}`,
        slug: `manual-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        gateAdapter: 'manual',
        manualTaskSlaHours: 4,
        officeHours: {
          monday: { closed: false, open: '09:00', close: '17:00' },
          tuesday: { closed: false, open: '09:00', close: '17:00' },
          wednesday: { closed: false, open: '09:00', close: '17:00' },
          thursday: { closed: false, open: '09:00', close: '17:00' },
          friday: { closed: false, open: '09:00', close: '17:00' },
          saturday: { closed: true },
          sunday: { closed: true },
        },
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `manual-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const tenant = await prisma.tenant.create({
      data: { email: `manual-${suffix}@example.com`, firstName: 'Ada', lastName: `Renter ${suffix}` },
    })
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `K-${suffix.slice(0, 4)}` },
    })
    const grant = await prisma.accessGrant.create({
      data: { facilityId, tenantId: tenant.id, state: 'active', stateCause: 'test' },
    })
    grantId = grant.id
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId: tenant.id,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    const credential = await prisma.accessCredential.create({
      data: {
        facilityId,
        grantId,
        leaseId: lease.id,
        valueRef: 'unrevealable:test',
        state: 'active',
      },
    })
    credentialId = credential.id
  })

  beforeEach(async () => {
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.facility.update({ where: { id: facilityId }, data: { gateAdapter: 'manual' } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  describe('AC1 — every command becomes a task', () => {
    it('raises a task instead of talking to a controller', async () => {
      await queueCommand('set_credential')
      const result = await drainGateCommands(new Date(), facilityId)

      expect(result.manual).toBe(1)
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(0)

      const task = await prisma.task.findFirstOrThrow({
        where: { facilityId, type: 'gate_manual_action' },
      })
      expect(task.status).toBe('open')
      expect(task.priority).toBe('high')
      expect(task.entityType).toBe('GateCommand')

      // The controller is never touched at a manual site.
      const controller = await prisma.simulatedGateCode.findUnique({ where: { credentialId } })
      expect(controller).toBeNull()
    })

    it('parks the command rather than retrying it', async () => {
      await queueCommand('set_credential')
      await drainGateCommands(new Date(), facilityId)

      const command = await prisma.gateCommand.findFirstOrThrow({ where: { facilityId } })
      expect(command.status).toBe('awaiting_manual')

      // Draining again must not make a second task. Five retries against a
      // human would be five tasks for one keypad trip.
      await drainGateCommands(new Date(), facilityId)
      expect(await prisma.task.count({ where: { facilityId, type: 'gate_manual_action' } })).toBe(1)
    })

    it('carries the exact keypad action, the code, and the reason', async () => {
      await queueCommand('set_credential')
      await drainGateCommands(new Date(), facilityId)

      const { items } = await manualQueue(actor(), facilityId)
      expect(items).toHaveLength(1)
      expect(items[0].instruction.action).toContain(`Renter ${suffix}`)
      expect(items[0].instruction.action).toContain(`K-${suffix.slice(0, 4)}`)
      expect(items[0].instruction.code).toBe('482913')
      expect(items[0].instruction.reason).toBeTruthy()
    })

    it('tells staff not to delete a suspended code', async () => {
      await queueCommand('suspend_access')
      await drainGateCommands(new Date(), facilityId)

      const { items } = await manualQueue(actor(), facilityId)
      expect(items[0].instruction.action).toContain('do not delete')
    })

    it('settles the command when the task is completed', async () => {
      await queueCommand('set_credential')
      await drainGateCommands(new Date(), facilityId)
      const task = await prisma.task.findFirstOrThrow({ where: { facilityId } })

      const result = await completeTask(actor(), task.id, { note: 'Keyed in at the north panel.' })
      expect(result).toEqual({ ok: true })

      const command = await prisma.gateCommand.findFirstOrThrow({ where: { facilityId } })
      expect(command.status).toBe('succeeded')
      expect(command.completedAt).not.toBeNull()

      // AC1's "stamps actor + time" — B-095's own columns, plus an audit entry
      // because this task type is sensitive.
      const completed = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
      expect(completed.completedByStaffId).toBe(staffId)
      expect(completed.completedAt).not.toBeNull()

      const credential = await prisma.accessCredential.findUniqueOrThrow({
        where: { id: credentialId },
      })
      expect(credential.syncStatus).toBe('synced')
    })

    it('refuses to complete without a note', async () => {
      await queueCommand('set_credential')
      await drainGateCommands(new Date(), facilityId)
      const task = await prisma.task.findFirstOrThrow({ where: { facilityId } })

      const result = await completeTask(actor(), task.id, {})
      expect(result).toEqual({ ok: false, missingFields: ['note'] })

      const command = await prisma.gateCommand.findFirstOrThrow({ where: { facilityId } })
      expect(command.status).toBe('awaiting_manual')
    })
  })

  describe('AC2 — the business-hours SLA', () => {
    it('does not escalate a change raised an hour ago', async () => {
      await queueCommand('set_credential')
      await drainGateCommands(new Date(), facilityId)

      const { items, slaHours } = await manualQueue(actor(), facilityId)
      expect(slaHours).toBe(4)
      expect(items[0].overdue).toBe(false)
    })

    it('escalates one that has sat past the SLA', async () => {
      await queueCommand('set_credential')
      await drainGateCommands(new Date(), facilityId)
      // Backdate a fortnight: whatever the office hours, four business hours
      // have certainly passed.
      await prisma.task.updateMany({
        where: { facilityId },
        data: { createdAt: new Date(Date.now() - 14 * 86_400_000) },
      })

      const { items } = await manualQueue(actor(), facilityId)
      expect(items[0].overdue).toBe(true)
    })
  })

  describe('AC3 — switching adapters', () => {
    it('hands parked commands back to the controller and cancels their tasks', async () => {
      await queueCommand('set_credential')
      await drainGateCommands(new Date(), facilityId)
      expect(
        (await prisma.gateCommand.findFirstOrThrow({ where: { facilityId } })).status,
      ).toBe('awaiting_manual')

      const { rerouted } = await switchGateAdapter(facilityId, 'simulated')
      expect(rerouted).toBe(1)

      const command = await prisma.gateCommand.findFirstOrThrow({ where: { facilityId } })
      expect(command.status).toBe('pending')

      // Leaving the task open would have staff keying in a change the
      // controller is about to make.
      const task = await prisma.task.findFirstOrThrow({ where: { facilityId } })
      expect(task.status).toBe('cancelled')

      // And the re-routed command really does reach the controller.
      await drainGateCommands(new Date(), facilityId)
      const settled = await prisma.gateCommand.findFirstOrThrow({ where: { facilityId } })
      expect(settled.status).toBe('succeeded')
    })

    it('preserves grants and credentials across a switch', async () => {
      const grantBefore = await prisma.accessGrant.findUniqueOrThrow({ where: { id: grantId } })
      const credentialBefore = await prisma.accessCredential.findUniqueOrThrow({
        where: { id: credentialId },
      })

      await switchGateAdapter(facilityId, 'simulated')
      await switchGateAdapter(facilityId, 'manual')

      const grantAfter = await prisma.accessGrant.findUniqueOrThrow({ where: { id: grantId } })
      const credentialAfter = await prisma.accessCredential.findUniqueOrThrow({
        where: { id: credentialId },
      })
      expect(grantAfter.state).toBe(grantBefore.state)
      expect(credentialAfter.state).toBe(credentialBefore.state)
      expect(credentialAfter.valueRef).toBe(credentialBefore.valueRef)
    })

    it('leaves a dead-lettered command dead', async () => {
      await queueCommand('set_credential')
      await prisma.gateCommand.updateMany({
        where: { facilityId },
        data: { status: 'dead_lettered', deadLetteredAt: new Date() },
      })

      const { rerouted } = await switchGateAdapter(facilityId, 'simulated')

      // It gave up for a reason and somebody was alerted. Re-animating it
      // silently would undo a decision that has already been acted on.
      expect(rerouted).toBe(0)
      expect(
        (await prisma.gateCommand.findFirstOrThrow({ where: { facilityId } })).status,
      ).toBe('dead_lettered')
    })

    it('is a no-op when the adapter is unchanged', async () => {
      expect(await switchGateAdapter(facilityId, 'manual')).toEqual({ rerouted: 0 })
    })
  })
})
