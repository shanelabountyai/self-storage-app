import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { runDunning } from '../apps/web/lib/billing/dunning'
import { placeHold } from '../apps/web/lib/admin/holds'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-052 / PRD 05 CN-3, CN-5. The ladder against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let unitTypeId = ''
let staffId = ''
let invoiceCounter = 0

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const collected: { itemId: string; ok: boolean; message?: string }[] = []
const recordItem = (o: { itemId: string; ok: boolean; message?: string }) => {
  collected.push(o)
}

function manager(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['tenants:view', 'tenants:edit']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function rent(dueDate: Date, options: { paid?: boolean; kind?: 'rent' | 'fee' } = {}) {
  invoiceCounter += 1
  return prisma.invoice.create({
    data: {
      facilityId,
      leaseId,
      number: `DN${String(invoiceCounter).padStart(5, '0')}`,
      kind: options.kind ?? 'rent',
      status: options.paid ? 'paid' : 'open',
      issueDate: dueDate,
      dueDate,
      periodStart: dueDate,
      periodEnd: new Date(dueDate.getTime() + 30 * 86_400_000),
      subtotalCents: 12_900,
      totalCents: 12_900,
      amountPaidCents: options.paid ? 12_900 : 0,
    },
  })
}

async function daysEmitted(): Promise<number[]> {
  const events = await prisma.domainEvent.findMany({
    where: { facilityId, name: 'delinquency.day_reached' },
    orderBy: { occurredAt: 'asc' },
  })
  return events.map((event) => Number((event.payload as { day: number }).day))
}

describeDb('dunning ladder', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Dunning Test',
        slug: `dunning-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `dunning-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const staff = await prisma.staffUser.create({
      data: { email: `dunning-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'D-1' } })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: d('2026-08-01'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  afterEach(async () => {
    collected.length = 0
    await prisma.leaseHold.deleteMany({ where: { leaseId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.update({ where: { id: leaseId }, data: { status: 'active' } })
    await prisma.facility.update({ where: { id: facilityId }, data: { dunningDays: [1, 5, 10, 30] } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  it('emits nothing before the first rung', async () => {
    await rent(d('2026-09-01'))
    await runDunning(facilityId, d('2026-09-01'), recordItem)
    expect(await daysEmitted()).toEqual([])
  })

  it('emits day 1 on the first day past due', async () => {
    await rent(d('2026-09-01'))
    await runDunning(facilityId, d('2026-09-02'), recordItem)
    expect(await daysEmitted()).toEqual([1])
  })

  it('never repeats a step on a later night', async () => {
    // CN-3's at-most-once, which is the whole reason the event log is the
    // record rather than a flag someone has to reset.
    await rent(d('2026-09-01'))
    await runDunning(facilityId, d('2026-09-02'), recordItem)
    await runDunning(facilityId, d('2026-09-03'), recordItem)
    await runDunning(facilityId, d('2026-09-04'), recordItem)
    expect(await daysEmitted()).toEqual([1])
  })

  it('is idempotent on a re-run of the same night', async () => {
    await rent(d('2026-09-01'))
    await runDunning(facilityId, d('2026-09-06'), recordItem)
    await runDunning(facilityId, d('2026-09-06'), recordItem)
    expect(await daysEmitted()).toEqual([1, 5])
  })

  it('catches up every rung missed while nothing ran, in order', async () => {
    await rent(d('2026-09-01'))
    await runDunning(facilityId, d('2026-10-05'), recordItem)
    expect(await daysEmitted()).toEqual([1, 5, 10, 30])
  })

  it('halts the moment the balance is settled', async () => {
    // "A payment at 11:58pm must suppress the midnight step."
    const invoice = await rent(d('2026-09-01'))
    await runDunning(facilityId, d('2026-09-02'), recordItem)

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'paid', amountPaidCents: 12_900 },
    })
    await runDunning(facilityId, d('2026-09-06'), recordItem)

    expect(await daysEmitted()).toEqual([1])
  })

  it('halts on a hold, and says why', async () => {
    await rent(d('2026-09-01'))
    await placeHold(manager(), leaseId, { type: 'military_scra', reason: 'Deployment orders.' })

    await runDunning(facilityId, d('2026-10-05'), recordItem)

    expect(await daysEmitted()).toEqual([])
    expect(collected.some((item) => item.message?.includes('on hold'))).toBe(true)
  })

  it('halts on move-out', async () => {
    await rent(d('2026-09-01'))
    await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })

    await runDunning(facilityId, d('2026-10-05'), recordItem)

    expect(await daysEmitted()).toEqual([])
    expect(collected.some((item) => item.message?.includes('ended'))).toBe(true)
  })

  it('does not chase on a fee invoice alone', async () => {
    // A fee is due the day it is raised; letting one anchor the ladder would
    // send a day-1 chase for a late fee assessed this morning.
    await rent(d('2026-09-01'), { kind: 'fee' })
    await runDunning(facilityId, d('2026-10-05'), recordItem)
    expect(await daysEmitted()).toEqual([])
  })

  it('starts again for the next invoice once the first is cleared', async () => {
    // Per INVOICE per step: a tenant who clears September and then falls behind
    // on October is chased about October.
    const september = await rent(d('2026-09-01'))
    await runDunning(facilityId, d('2026-09-02'), recordItem)

    await prisma.invoice.update({
      where: { id: september.id },
      data: { status: 'paid', amountPaidCents: 12_900 },
    })
    await rent(d('2026-10-01'))
    await runDunning(facilityId, d('2026-10-02'), recordItem)

    expect(await daysEmitted()).toEqual([1, 1])
  })

  it('carries the position and total so the template can escalate its tone', async () => {
    await rent(d('2026-09-01'))
    await runDunning(facilityId, d('2026-09-12'), recordItem)

    const events = await prisma.domainEvent.findMany({
      where: { facilityId, name: 'delinquency.day_reached' },
      orderBy: { occurredAt: 'asc' },
    })
    const last = events.at(-1)!.payload as { position: number; totalSteps: number }
    expect(last).toMatchObject({ position: 3, totalSteps: 4 })
  })

  it('honours a facility that chases on different days', async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { dunningDays: [7] } })
    await rent(d('2026-09-01'))

    await runDunning(facilityId, d('2026-09-05'), recordItem)
    expect(await daysEmitted()).toEqual([])

    await runDunning(facilityId, d('2026-09-09'), recordItem)
    expect(await daysEmitted()).toEqual([7])
  })

  it('chases nobody at a facility with no ladder configured', async () => {
    await prisma.facility.update({ where: { id: facilityId }, data: { dunningDays: [] } })
    await rent(d('2026-09-01'))
    await runDunning(facilityId, d('2026-10-05'), recordItem)
    expect(await daysEmitted()).toEqual([])
  })
})
