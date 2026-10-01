import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import {
  incidentDetail,
  logIncidentDocument,
  notifyIncident,
  recordIncident,
  setPoliceReportNumber,
} from '../apps/web/lib/admin/incidents'
import * as provider from '../apps/web/lib/comms/provider'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-424 / PRD 02 US-37 "an incident is one record", against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const at = (iso: string) => new Date(iso)

const WINDOW_START = at('2026-09-10T02:00:00.000Z')
const WINDOW_END = at('2026-09-10T08:00:00.000Z')

let facilityId = ''
let staffId = ''
const unitIds: string[] = []
const tenantIds: string[] = []
let vacantUnitId = ''
let incidentId = ''

function actor(permissions: PermissionKey[] = ['tenants:edit', 'access:events', 'comms:broadcast']): Actor {
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

const gateEvent = (occurredAt: string) =>
  prisma.accessEvent.create({
    data: {
      facilityId,
      vendorEventId: `inc-${randomUUID()}`,
      result: 'denied',
      reason: 'unknown_code',
      occurredAt: at(occurredAt),
    },
  })

const sends: string[] = []

describeDb('an incident is one record', () => {
  beforeAll(async () => {
    vi.spyOn(provider, 'selectProvider').mockReturnValue({
      name: 'test',
      async sendEmail(email) {
        sends.push(email.to)
        return { ok: true, providerMessageId: `test_${sends.length}` }
      },
    })
    const staff = await prisma.staffUser.create({
      data: { email: `inc-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id
    // Never deleted: the suite audit-logs against it (B-185).
    const facility = await prisma.facility.create({
      data: {
        name: `Incident Test ${suffix}`,
        slug: `incident-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    for (const index of [0, 1, 2]) {
      const tenant = await prisma.tenant.create({
        data: { email: `inc-t-${index}-${suffix}@example.com`, firstName: 'Ada', lastName: `Renter${index}` },
      })
      const unit = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: `INC-${index}` } })
      await prisma.lease.create({
        data: {
          facilityId,
          tenantId: tenant.id,
          unitId: unit.id,
          status: 'active',
          startDate: at('2026-08-01T00:00:00.000Z'),
          billingDay: 1,
          monthlyRateCents: 12_900,
        },
      })
      unitIds.push(unit.id)
      tenantIds.push(tenant.id)
    }
    const vacant = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: 'INC-V' } })
    vacantUnitId = vacant.id

    await gateEvent('2026-09-10T01:59:00.000Z') // before the window
    await gateEvent('2026-09-10T03:15:00.000Z')
    await gateEvent('2026-09-10T04:40:00.000Z')
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await prisma.$disconnect()
  })

  it('refuses a staffer who cannot read the gate log, before anything is written', async () => {
    await expect(
      recordIncident(actor(['tenants:edit']), {
        facilityId,
        type: 'break_in',
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        description: 'Locks cut',
        unitIds,
      }),
    ).rejects.toThrow(/access:events/)
    expect(await prisma.incident.count({ where: { facilityId } })).toBe(0)
  })

  it('refuses an empty window, no units, and a unit from another site', async () => {
    const base = { facilityId, type: 'break_in' as const, windowStart: WINDOW_START, windowEnd: WINDOW_END, description: 'Locks cut', unitIds }
    expect(await recordIncident(actor(), { ...base, windowEnd: WINDOW_START })).toEqual({ ok: false, reason: 'bad_window' })
    expect(await recordIncident(actor(), { ...base, unitIds: [] })).toEqual({ ok: false, reason: 'no_units' })
    expect(await recordIncident(actor(), { ...base, unitIds: [...unitIds, 'not-a-unit'] })).toEqual({ ok: false, reason: 'unknown_unit' })
    expect(await prisma.incident.count({ where: { facilityId } })).toBe(0)
  })

  it('on three units makes three tasks and freezes the gate log for the window', async () => {
    const result = await recordIncident(actor(), {
      facilityId,
      type: 'break_in',
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      description: 'Locks cut on three units overnight',
      unitIds: [...unitIds, vacantUnitId],
    })
    expect(result).toMatchObject({ ok: true, tasks: 3, gateEvents: 2 })
    if (!result.ok) return
    incidentId = result.id

    const tasks = await prisma.task.findMany({ where: { facilityId, type: 'incident_follow_up' } })
    expect(tasks.map((task) => task.entityId).sort()).toEqual([...tenantIds].sort())
    expect(tasks.every((task) => task.entityType === 'Tenant' && task.priority === 'high')).toBe(true)

    const detail = await incidentDetail(actor(), incidentId)
    expect(detail?.gateLogExcerpt.map((row) => row.occurredAt)).toEqual([
      '2026-09-10T03:15:00.000Z',
      '2026-09-10T04:40:00.000Z',
    ])
    // The vacant unit is on the record with nobody to call.
    expect(detail?.units).toHaveLength(4)
    expect(detail?.units.filter((unit) => unit.lease === null)).toHaveLength(1)

    const audit = await prisma.auditLog.findFirst({ where: { action: 'incident.recorded', entityId: incidentId } })
    expect(audit).not.toBeNull()
  })

  it('keeps the excerpt when a later event lands inside the window', async () => {
    await gateEvent('2026-09-10T05:00:00.000Z')
    const detail = await incidentDetail(actor(), incidentId)
    expect(detail?.gateLogExcerpt).toHaveLength(2)
  })

  it('has the database refuse a change to the excerpt, and allow the police report number', async () => {
    await expect(
      prisma.incident.update({ where: { id: incidentId }, data: { gateLogExcerpt: [] } }),
    ).rejects.toThrow(/frozen/)

    expect(await setPoliceReportNumber(actor(), incidentId, ' APD-26-1234 ')).toBe(true)
    const detail = await incidentDetail(actor(), incidentId)
    expect(detail?.policeReportNumber).toBe('APD-26-1234')
    expect(detail?.gateLogExcerpt).toHaveLength(2)
  })

  it('lists a photo logged through the document store', async () => {
    await logIncidentDocument(actor(), incidentId, { type: 'inspection_photo', title: 'Cut lock, INC-0', note: 'On the office phone' })
    const detail = await incidentDetail(actor(), incidentId)
    expect(detail?.documents.map((doc) => [doc.type, doc.title])).toEqual([['inspection_photo', 'Cut lock, INC-0']])
  })

  it('sends one message to the affected tenants, and refuses a second', async () => {
    const message = { subject: 'A break-in at the facility', message: 'Three units were entered overnight. Please call the office.' }
    await expect(notifyIncident(actor(['tenants:edit', 'access:events']), incidentId, message)).rejects.toThrow(/comms:broadcast/)

    const first = await notifyIncident(actor(), incidentId, message)
    expect(first).toMatchObject({ ok: true, recipients: 3, sent: 3 })
    expect([...sends].sort()).toEqual([0, 1, 2].map((index) => `inc-t-${index}-${suffix}@example.com`))

    expect(await notifyIncident(actor(), incidentId, { ...message, subject: 'A different story' })).toEqual({
      ok: false,
      reason: 'already_notified',
    })
    expect(sends).toHaveLength(3)
  })
})
