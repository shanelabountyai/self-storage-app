import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor, Assignment } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import {
  InvalidTimezoneError,
  addFeeScheduleEntry,
  addTaxComponent,
  getFacilitySettings,
  updateFacilityDetails,
  updateFacilityHours,
} from '../apps/web/lib/admin/facility-settings'
import { CLOSED_ALL_WEEK } from '../packages/core/facility-settings'
import { ROLES } from '../packages/db/rbac-catalog'

const hasDatabase = Boolean(process.env.DATABASE_URL)

const suffix = randomUUID().slice(0, 8)
let facilityAId = ''
let facilityBId = ''
let staffId = ''
let counterStaffId = ''

function assignmentFor(roleKey: string, facilityId: string | null): Assignment {
  const role = ROLES.find((r) => r.key === roleKey)!
  return {
    facilityId,
    roleKey: role.key,
    rank: role.rank,
    permissions: new Set(role.permissions),
    limits: {
      maxFeeWaiverCents: role.maxFeeWaiverCents,
      maxRefundCents: role.maxRefundCents,
      maxCreditCents: role.maxCreditCents,
    },
  }
}

// recordAudit's actorStaffId is a real FK to staff_user, so these need actual
// rows — a synthetic id would fail the same constraint that keeps the audit
// log honest about who acted.
const ownerAt = (facilityId: string): Actor => ({
  kind: 'staff',
  staffUserId: staffId,
  assignments: [assignmentFor('owner', facilityId)],
})

const counterAt = (facilityId: string): Actor => ({
  kind: 'staff',
  staffUserId: counterStaffId,
  assignments: [assignmentFor('counter', facilityId)],
})

beforeAll(async () => {
  if (!hasDatabase) return
  const [a, b] = await Promise.all([
    prisma.facility.create({
      data: {
        name: 'Settings Test A',
        slug: `settings-test-a-${suffix}`,
        addressLine1: '1 Test St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        timezone: 'America/Chicago',
        status: 'inactive' as const,
      },
    }),
    prisma.facility.create({
      data: {
        name: 'Settings Test B',
        slug: `settings-test-b-${suffix}`,
        addressLine1: '2 Test St',
        city: 'Dallas',
        state: 'TX',
        postalCode: '75201',
        timezone: 'America/Chicago',
        status: 'inactive' as const,
      },
    }),
  ])
  facilityAId = a.id
  facilityBId = b.id

  const [owner, counter] = await Promise.all([
    prisma.staffUser.create({
      data: { email: `settings-owner-${suffix}@example.com`, firstName: 'Owner', lastName: 'Test' },
    }),
    prisma.staffUser.create({
      data: { email: `settings-counter-${suffix}@example.com`, firstName: 'Counter', lastName: 'Test' },
    }),
  ])
  staffId = owner.id
  counterStaffId = counter.id
})

afterAll(async () => {
  if (!hasDatabase) return
  await prisma.taxComponent.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
  await prisma.feeSchedule.deleteMany({ where: { facilityId: { in: [facilityAId, facilityBId] } } })
  // The facilities themselves cannot be hard-deleted once they have audit
  // history (Restrict FK from B-005) — left in place by design.
  await prisma.$disconnect()
})

describe.skipIf(!hasDatabase)('updateFacilityDetails', () => {
  it('updates fields and writes an audit entry', async () => {
    const actor = ownerAt(facilityAId)
    await updateFacilityDetails(actor, facilityAId, {
      name: 'Settings Test A (renamed)',
      addressLine1: '99 New Address',
      addressLine2: null,
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      timezone: 'America/Chicago',
      phone: '512-555-0100',
      email: 'a@example.com',
    })

    const facility = await prisma.facility.findUniqueOrThrow({ where: { id: facilityAId } })
    expect(facility.name).toBe('Settings Test A (renamed)')
    expect(facility.addressLine1).toBe('99 New Address')

    const entries = await prisma.auditLog.findMany({
      where: { entityId: facilityAId, action: 'facility.settings_changed' },
    })
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0].before).toMatchObject({ name: 'Settings Test A' })
    expect(entries[0].after).toMatchObject({ name: 'Settings Test A (renamed)' })
  })

  it('rejects a timezone that is not a real IANA zone', async () => {
    const actor = ownerAt(facilityAId)
    await expect(
      updateFacilityDetails(actor, facilityAId, {
        name: 'X',
        addressLine1: 'X',
        addressLine2: null,
        city: 'X',
        state: 'TX',
        postalCode: '00000',
        timezone: 'Mars/Olympus_Mons',
        phone: null,
        email: null,
      }),
    ).rejects.toBeInstanceOf(InvalidTimezoneError)
  })

  it('refuses a role with no settings permission', async () => {
    const actor = counterAt(facilityAId)
    await expect(
      updateFacilityDetails(actor, facilityAId, {
        name: 'Hijacked',
        addressLine1: 'X',
        addressLine2: null,
        city: 'X',
        state: 'TX',
        postalCode: '00000',
        timezone: 'America/Chicago',
        status: 'inactive' as const,
        phone: null,
        email: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("refuses an owner of facility A editing facility B's settings", async () => {
    const actor = ownerAt(facilityAId)
    await expect(
      updateFacilityDetails(actor, facilityBId, {
        name: 'Cross-facility write',
        addressLine1: 'X',
        addressLine2: null,
        city: 'X',
        state: 'TX',
        postalCode: '00000',
        timezone: 'America/Chicago',
        status: 'inactive' as const,
        phone: null,
        email: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const stillOriginal = await prisma.facility.findUniqueOrThrow({ where: { id: facilityBId } })
    expect(stillOriginal.name).toBe('Settings Test B')
  })
})

describe.skipIf(!hasDatabase)('updateFacilityHours', () => {
  it('stores a validated weekly schedule for both office and gate hours', async () => {
    const actor = ownerAt(facilityAId)
    const officeHours = {
      ...CLOSED_ALL_WEEK,
      monday: { closed: false, open: '09:00', close: '18:00' },
    }
    const gateHours = {
      ...CLOSED_ALL_WEEK,
      monday: { closed: false, open: '06:00', close: '22:00' },
    }

    await updateFacilityHours(actor, facilityAId, { officeHours, gateHours })

    const settings = await getFacilitySettings(facilityAId)
    expect(settings.officeHours).toEqual(officeHours)
    expect(settings.gateHours).toEqual(gateHours)
  })
})

describe.skipIf(!hasDatabase)('effective-dated tax components', () => {
  it('never mutates history — adding a rate creates a new row', async () => {
    const actor = ownerAt(facilityAId)

    await addTaxComponent(actor, facilityAId, {
      jurisdiction: 'state',
      rateBasisPoints: 625,
      effectiveFrom: new Date('2020-01-01'),
    })
    await addTaxComponent(actor, facilityAId, {
      jurisdiction: 'state',
      rateBasisPoints: 650,
      effectiveFrom: new Date('2099-01-01'), // far future — must not be "current" yet
    })

    const settings = await getFacilitySettings(facilityAId)
    const stateRate = settings.currentTaxComponents.find((t) => t.jurisdiction === 'state')
    expect(stateRate?.rateBasisPoints).toBe(625)

    const history = settings.taxComponentHistory.filter((t) => t.jurisdiction === 'state')
    expect(history).toHaveLength(2)
  })

  it('refuses a rate over 100%', async () => {
    const actor = ownerAt(facilityAId)
    await expect(
      addTaxComponent(actor, facilityAId, {
        jurisdiction: 'bogus',
        rateBasisPoints: 10_001,
        effectiveFrom: new Date(),
      }),
    ).rejects.toThrow()
  })
})

describe.skipIf(!hasDatabase)('effective-dated fee schedule', () => {
  it('picks the most recent effective amount', async () => {
    const actor = ownerAt(facilityAId)

    await addFeeScheduleEntry(actor, facilityAId, {
      feeType: 'late',
      amountCents: 2_500,
      effectiveFrom: new Date('2020-01-01'),
    })
    await addFeeScheduleEntry(actor, facilityAId, {
      feeType: 'late',
      amountCents: 3_000,
      effectiveFrom: new Date('2021-01-01'),
    })

    const settings = await getFacilitySettings(facilityAId)
    const lateFee = settings.currentFeeSchedule.find((f) => f.feeType === 'late')
    expect(lateFee?.amountCents).toBe(3_000)
  })

  it('refuses a negative amount', async () => {
    const actor = ownerAt(facilityAId)
    await expect(
      addFeeScheduleEntry(actor, facilityAId, {
        feeType: 'nsf',
        amountCents: -100,
        effectiveFrom: new Date(),
      }),
    ).rejects.toThrow()
  })
})
