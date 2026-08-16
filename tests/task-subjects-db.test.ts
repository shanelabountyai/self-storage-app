import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { resolveTaskSubjects, fallbackSubject } from '../apps/web/lib/admin/task-subjects'
import { createTask, facilityTasks } from '../apps/web/lib/admin/tasks'
import { delinquencyQueue } from '../apps/web/lib/admin/delinquency-queue'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// PRD 02 §4.9 US-41, §4.6 US-26, §5.5 FR-22 (B-115, UX review 2026-08-12
// finding 9). `TaskRow` carried `entityType`/`entityId` since B-095 and
// neither `/admin/tasks` nor `/admin/delinquency` read them, so a card named
// no tenant, no unit, and linked nowhere.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let unitNumber = ''
let leaseId = ''

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: randomUUID(),
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['tenants:view', 'delinquency:execute_step']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('task subject resolution (B-115)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Subjects ${suffix}`,
        slug: `ts-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const tenant = await prisma.tenant.create({
      data: { email: `ts-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitNumber = `B-${suffix.slice(0, 4)}`
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: unitNumber } })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('resolves a Lease task to its tenant and unit, and links to the profile', async () => {
    const subjects = await resolveTaskSubjects([{ entityType: 'Lease', entityId: leaseId }])
    const subject = subjects.get(`Lease:${leaseId}`)
    expect(subject).toEqual({ label: `Unit ${unitNumber} — Ada Renter`, href: `/admin/tenants/${tenantId}` })
  })

  it('resolves a Tenant task straight to the tenant', async () => {
    const subjects = await resolveTaskSubjects([{ entityType: 'Tenant', entityId: tenantId }])
    expect(subjects.get(`Tenant:${tenantId}`)).toEqual({
      label: 'Ada Renter',
      href: `/admin/tenants/${tenantId}`,
    })
  })

  it('resolves an Invoice task through its lease, the same as a bare Lease task', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        facilityId,
        leaseId,
        number: `TS${suffix}0001`,
        issueDate: new Date('2026-07-01T00:00:00Z'),
        dueDate: new Date('2026-07-01T00:00:00Z'),
        periodStart: new Date('2026-07-01T00:00:00Z'),
        periodEnd: new Date('2026-08-01T00:00:00Z'),
        totalCents: 12_900,
        status: 'open',
      },
    })

    const subjects = await resolveTaskSubjects([{ entityType: 'Invoice', entityId: invoice.id }])
    expect(subjects.get(`Invoice:${invoice.id}`)).toEqual({
      label: `Unit ${unitNumber} — Ada Renter`,
      href: `/admin/tenants/${tenantId}`,
    })

    await prisma.invoice.delete({ where: { id: invoice.id } })
  })

  it('resolves a Payment task to the tenant who paid it', async () => {
    const payment = await prisma.payment.create({
      data: { facilityId, tenantId, amountCents: 5_000, method: 'cash', status: 'succeeded' },
    })

    const subjects = await resolveTaskSubjects([{ entityType: 'Payment', entityId: payment.id }])
    expect(subjects.get(`Payment:${payment.id}`)).toEqual({
      label: 'Ada Renter',
      href: `/admin/tenants/${tenantId}`,
    })

    await prisma.payment.delete({ where: { id: payment.id } })
  })

  it('resolves a Lead task to the lead, named and linked to its own page', async () => {
    const lead = await prisma.lead.create({
      data: { facilityId, firstName: 'Sam', lastName: 'Shopper', source: 'phone' },
    })

    const subjects = await resolveTaskSubjects([{ entityType: 'Lead', entityId: lead.id }])
    expect(subjects.get(`Lead:${lead.id}`)).toEqual({
      label: 'Sam Shopper',
      href: `/admin/leads/${lead.id}`,
    })

    await prisma.lead.delete({ where: { id: lead.id } })
  })

  it('falls back to a phone number when a lead was never given a name', async () => {
    const lead = await prisma.lead.create({
      data: { facilityId, phone: '512-555-0100', source: 'phone' },
    })

    const subjects = await resolveTaskSubjects([{ entityType: 'Lead', entityId: lead.id }])
    expect(subjects.get(`Lead:${lead.id}`)?.label).toBe('512-555-0100')

    await prisma.lead.delete({ where: { id: lead.id } })
  })

  it('resolves a GateCommand through its credential to the tenant standing at the gate', async () => {
    const grant = await prisma.accessGrant.create({ data: { facilityId, tenantId, state: 'active' } })
    const credential = await prisma.accessCredential.create({
      data: { facilityId, grantId: grant.id, leaseId, type: 'pin', valueRef: 'unrevealable:test' },
    })
    const command = await prisma.gateCommand.create({
      data: {
        facilityId,
        credentialId: credential.id,
        type: 'set_credential',
        idempotencyKey: `gc-${suffix}`,
        payload: {},
      },
    })

    const subjects = await resolveTaskSubjects([{ entityType: 'GateCommand', entityId: command.id }])
    expect(subjects.get(`GateCommand:${command.id}`)).toEqual({
      label: 'Ada Renter',
      href: `/admin/tenants/${tenantId}`,
    })

    await prisma.gateCommand.delete({ where: { id: command.id } })
    await prisma.accessCredential.delete({ where: { id: credential.id } })
    await prisma.accessGrant.delete({ where: { id: grant.id } })
  })

  it('names a facility-wide task in plain words, never the raw model name, and never links it', async () => {
    const subjects = await resolveTaskSubjects([{ entityType: 'Facility', entityId: facilityId }])
    expect(subjects.get(`Facility:${facilityId}`)).toEqual({ label: 'Facility-wide', href: null })
  })

  it('renders a deleted subject unlinked rather than broken', async () => {
    // The row's own requirement: a task whose subject is gone still shows,
    // named honestly, rather than crashing or linking to a 404.
    const subjects = await resolveTaskSubjects([{ entityType: 'Lease', entityId: 'no-such-lease' }])
    expect(subjects.has(`Lease:no-such-lease`)).toBe(false)
    expect(fallbackSubject('Lease')).toEqual({ label: 'This lease no longer exists.', href: null })
  })

  it('never crashes on an entityType the catalog has never named', () => {
    expect(fallbackSubject('SomeFutureThing')).toEqual({
      label: 'The subject of this task no longer exists.',
      href: null,
    })
  })

  it('facilityTasks carries a subject on every row, resolved or a fallback', async () => {
    await prisma.task.deleteMany({ where: { facilityId } })
    await createTask({ facilityId, type: 'move_in_provisioning_failed', entityType: 'Lease', entityId: leaseId })
    await createTask({ facilityId, type: 'returned_mail_review', entityType: 'Tenant', entityId: 'deleted-tenant' })

    const rows = await facilityTasks(actor(), facilityId)
    const lease = rows.find((r) => r.entityType === 'Lease')!
    const missing = rows.find((r) => r.entityType === 'Tenant')!
    expect(lease.subject).toEqual({ label: `Unit ${unitNumber} — Ada Renter`, href: `/admin/tenants/${tenantId}` })
    expect(missing.subject).toEqual({ label: 'This tenant no longer exists.', href: null })
  })

  it('the delinquency queue carries balance and days past due, from the metrics module', async () => {
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.create({
      data: { facilityId, leaseId, type: 'charge', amountCents: 12_900, description: 'Monthly rent' },
    })
    const invoice = await prisma.invoice.create({
      data: {
        facilityId,
        leaseId,
        number: `TS${suffix}0002`,
        issueDate: new Date('2026-06-01T00:00:00Z'),
        dueDate: new Date('2026-06-01T00:00:00Z'),
        periodStart: new Date('2026-06-01T00:00:00Z'),
        periodEnd: new Date('2026-07-01T00:00:00Z'),
        totalCents: 12_900,
        status: 'open',
      },
    })
    await createTask({ facilityId, type: 'delinquency_step', entityType: 'Lease', entityId: leaseId })

    const groups = await delinquencyQueue(actor(), facilityId)
    const task = groups[0].tasks[0]
    expect(task.balanceCents).toBe(12_900)
    // Aged from the invoice's own due date, the same figure the tenant list
    // and the delinquency report read — never recomputed here (D-25).
    expect(task.daysPastDue).toBeGreaterThan(0)
    expect(task.subject).toEqual({ label: `Unit ${unitNumber} — Ada Renter`, href: `/admin/tenants/${tenantId}` })

    await prisma.invoice.delete({ where: { id: invoice.id } })
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
  })
})
