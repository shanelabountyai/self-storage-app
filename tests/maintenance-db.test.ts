import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { createMaintenanceTicket, setTicketStatus, ticketsForFacility, assignTicket } from '../apps/web/lib/admin/maintenance'
import { setUnitOperationalStatus, UnitStatusChangeBlockedError } from '../apps/web/lib/admin/units'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-060 / PRD 02 §4.9 US-37, against real rows.
//
// The property worth a database: a blocking ticket has to actually stop
// `setUnitOperationalStatus` from putting the unit back on the rentable list —
// that guard lives in `canSetManualStatus`, but only `occupancyFactsForMany`
// wires a real ticket into it.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitId = ''
let staffId = ''

function actor(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(['units:edit', 'tenants:view']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('maintenance tickets', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Maintenance ${suffix}`,
        slug: `mt-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const staff = await prisma.staffUser.create({
      data: { email: `mt-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `M-${suffix.slice(0, 4)}` },
    })
    unitId = unit.id
  })

  beforeEach(async () => {
    await prisma.maintenanceTicket.deleteMany({ where: { facilityId } })
    await prisma.unit.update({ where: { id: unitId }, data: { operationalStatus: 'available', status: 'available' } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.maintenanceTicket.deleteMany({ where: { facilityId } })
    await prisma.$disconnect()
  })

  it('creates a ticket and, when it blocks, puts the unit into maintenance', async () => {
    const { id } = await createMaintenanceTicket(actor(), facilityId, {
      unitId,
      title: 'Door will not latch',
      notes: null,
      priority: 'high',
      blocksAvailability: true,
      source: 'manual',
    })
    expect(id).toBeTruthy()

    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
    expect(unit.operationalStatus).toBe('maintenance')
    expect(unit.status).toBe('maintenance')
  })

  it('leaves the unit alone for a non-blocking ticket', async () => {
    await createMaintenanceTicket(actor(), facilityId, {
      unitId,
      title: 'Paint is chipped',
      notes: null,
      priority: 'normal',
      blocksAvailability: false,
      source: 'manual',
    })

    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
    expect(unit.operationalStatus).toBe('available')
  })

  it('refuses to reopen the unit while a blocking ticket is open', async () => {
    await createMaintenanceTicket(actor(), facilityId, {
      unitId,
      title: 'Roof leak',
      notes: null,
      priority: 'high',
      blocksAvailability: true,
      source: 'walkthrough',
    })

    await expect(
      setUnitOperationalStatus(actor(), facilityId, unitId, 'available', 'management_approval'),
    ).rejects.toThrow(UnitStatusChangeBlockedError)
  })

  it('allows marking the unit available again once the ticket is done', async () => {
    const { id } = await createMaintenanceTicket(actor(), facilityId, {
      unitId,
      title: 'Roof leak',
      notes: null,
      priority: 'high',
      blocksAvailability: true,
      source: 'walkthrough',
    })
    await setTicketStatus(actor(), id, 'done')

    // Closing the ticket does not itself flip the unit back — that stays a
    // deliberate act, the same way move-out's `maintenance` intent does — but
    // it no longer blocks one.
    const stillMaintenance = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
    expect(stillMaintenance.operationalStatus).toBe('maintenance')

    await setUnitOperationalStatus(actor(), facilityId, unitId, 'available', 'management_approval')
    const after = await prisma.unit.findUniqueOrThrow({ where: { id: unitId } })
    expect(after.operationalStatus).toBe('available')
  })

  it('reopening a done ticket clears resolvedAt', async () => {
    const { id } = await createMaintenanceTicket(actor(), facilityId, {
      unitId,
      title: 'Light out',
      notes: null,
      priority: 'normal',
      blocksAvailability: false,
      source: 'manual',
    })
    await setTicketStatus(actor(), id, 'done')
    await setTicketStatus(actor(), id, 'open')

    const ticket = await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id } })
    expect(ticket.resolvedAt).toBeNull()
  })

  it('lists open tickets with the unit number and assignee name joined in', async () => {
    const { id } = await createMaintenanceTicket(actor(), facilityId, {
      unitId,
      title: 'Broken hinge',
      notes: 'Squeaks loudly',
      priority: 'normal',
      blocksAvailability: false,
      source: 'manual',
    })
    await assignTicket(actor(), id, staffId)

    const rows = await ticketsForFacility(actor(), facilityId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ unitNumber: `M-${suffix.slice(0, 4)}`, assigneeName: 'Mo Manager' })
  })

  it('excludes done tickets from the default list', async () => {
    const { id } = await createMaintenanceTicket(actor(), facilityId, {
      unitId,
      title: 'Fixed already',
      notes: null,
      priority: 'normal',
      blocksAvailability: false,
      source: 'manual',
    })
    await setTicketStatus(actor(), id, 'done')

    expect(await ticketsForFacility(actor(), facilityId)).toEqual([])
    expect(await ticketsForFacility(actor(), facilityId, { includeDone: true })).toHaveLength(1)
  })
})
