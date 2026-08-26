import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { SHARED_ACCESS_PRESETS } from '../packages/core/access'
import {
  createAuthorizedPerson,
  expireSharedAccess,
  ExpiryInThePastError,
} from '../apps/web/lib/access/authorized-persons'
import { propagateGateHours } from '../apps/web/lib/access/time-windows'
import { drainGateCommands } from '../apps/web/lib/access/service'

// B-086 / PRD 03 US-8 AC1. Time-boxed shared access: an expiry date that
// actually stops the code working, and a per-person window that actually
// reaches the controller.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''

const tenantActor = (): Actor => ({ kind: 'tenant', tenantId })

/// `YYYY-MM-DD`, N days from now in the facility's timezone.
const dayOffset = (days: number): string => {
  const at = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(at)
}

describeDb('time-boxed shared access', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Shared Access Test',
        slug: `shared-access-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        authorizedAccessCap: 3,
        gateHours: Object.fromEntries(
          ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
            (day) => [day, { closed: false, open: '06:00', close: '22:00' }],
          ),
        ),
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `shared-access-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: 'A-1' },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 1,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.authorizedAccessPerson.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.authorizedAccessPerson.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    // Not the facility: audit entries from this file hold a Restrict FK to it.
    await prisma.$disconnect()
  })

  const add = (input: Partial<Parameters<typeof createAuthorizedPerson>[2]> = {}) =>
    createAuthorizedPerson(tenantActor(), leaseId, {
      name: 'Guest Holder',
      phone: '555-0101',
      relationship: 'brother',
      ...input,
    })

  it('stores the END of the named day, so "until the 14th" includes the 14th', async () => {
    const { personId } = await add({ expiresOn: dayOffset(3) })
    const person = await prisma.authorizedAccessPerson.findUniqueOrThrow({
      where: { id: personId },
    })

    // Local midnight ENDING that day is local midnight STARTING the next one,
    // so the stored instant reads as the following date, not the named one.
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
    }).format(person.expiresAt!)
    expect(localDate).toBe(dayOffset(4))
    // 05:00 or 06:00 UTC depending on the season — never 00:00 UTC, which is
    // what a naive conversion would store and what would cut a Texas guest off
    // five hours early.
    expect(person.expiresAt!.getUTCHours()).toBeGreaterThan(0)
  })

  it('refuses a date already gone rather than issuing a code that dies tonight', async () => {
    await expect(add({ expiresOn: dayOffset(-1) })).rejects.toBeInstanceOf(ExpiryInThePastError)
    expect(await prisma.authorizedAccessPerson.count({ where: { leaseId } })).toBe(0)
  })

  it('leaves a person with no date alone forever', async () => {
    const { personId } = await add()
    const result = await expireSharedAccess(new Date(Date.now() + 365 * 86_400_000), facilityId)
    expect(result.expired).toBe(0)
    const person = await prisma.authorizedAccessPerson.findUniqueOrThrow({ where: { id: personId } })
    expect(person.active).toBe(true)
  })

  it('does not expire anybody before their last day is over', async () => {
    const { personId } = await add({ expiresOn: dayOffset(1) })
    // Late on the last day itself.
    const { expired } = await expireSharedAccess(new Date(Date.now() + 86_000_000), facilityId)
    expect(expired).toBe(0)
    const person = await prisma.authorizedAccessPerson.findUniqueOrThrow({ where: { id: personId } })
    expect(person.active).toBe(true)
  })

  // The point of the whole item: a keypad decides from the codes it was last
  // told about, so an expired person we merely hide from our own reads still
  // opens the gate. The revoke has to reach the controller.
  it('revokes at the controller, not just in our own table', async () => {
    const { personId, credentialId } = await add({ expiresOn: dayOffset(1) })
    await drainGateCommands(new Date(), facilityId)
    expect(
      (await prisma.simulatedGateCode.findFirst({ where: { credentialId } }))?.active,
    ).toBe(true)

    const { expired } = await expireSharedAccess(new Date(Date.now() + 3 * 86_400_000), facilityId)
    expect(expired).toBe(1)

    const person = await prisma.authorizedAccessPerson.findUniqueOrThrow({ where: { id: personId } })
    expect(person.active).toBe(false)
    expect(person.revokedAt).not.toBeNull()
    // Neither a staff member nor the tenant did this, and the row must not
    // claim otherwise.
    expect(person.revokedByStaffId).toBeNull()
    expect(person.revokedByTenantId).toBeNull()

    const grant = await prisma.accessGrant.findFirstOrThrow({ where: { authorizedPersonId: personId } })
    expect(grant.state).toBe('revoked')
    expect(grant.stateCause).toBe('system:shared_access_expired')

    // And the controller agrees — that is the assertion the feature exists for.
    expect(
      (await prisma.simulatedGateCode.findFirst({ where: { credentialId } }))?.active,
    ).toBe(false)
  })

  it('is a no-op on a second pass, so a catch-up run is safe', async () => {
    await add({ expiresOn: dayOffset(1) })
    const at = new Date(Date.now() + 3 * 86_400_000)
    expect((await expireSharedAccess(at, facilityId)).expired).toBe(1)
    expect((await expireSharedAccess(at, facilityId)).expired).toBe(0)
  })

  it('expires one person without touching another on the same lease', async () => {
    const expiring = await add({ name: 'Ends Friday', expiresOn: dayOffset(1) })
    const staying = await add({ name: 'Stays', phone: '555-0102' })

    await expireSharedAccess(new Date(Date.now() + 3 * 86_400_000), facilityId)

    expect(
      (await prisma.authorizedAccessPerson.findUniqueOrThrow({ where: { id: expiring.personId } }))
        .active,
    ).toBe(false)
    expect(
      (await prisma.authorizedAccessPerson.findUniqueOrThrow({ where: { id: staying.personId } }))
        .active,
    ).toBe(true)
  })

  // `accessHours` was written by US-9's service since B-029 and read by
  // nothing, so a manager who set "weekends only" had configured precisely
  // nothing. This is the assertion that it now reaches the hardware.
  it('pushes the person window to the controller, narrowed against the facility', async () => {
    const { credentialId } = await add({
      accessHours: SHARED_ACCESS_PRESETS.weekends.schedule,
      phone: '555-0103',
    })
    await propagateGateHours(facilityId)
    await drainGateCommands(new Date(), facilityId)

    const code = await prisma.simulatedGateCode.findFirstOrThrow({ where: { credentialId } })
    const window = code.windowSchedule as Record<string, { closed: boolean; open?: string }>
    expect(window.monday).toEqual({ closed: true })
    // The preset says 00:00–23:59; the facility says 06:00–22:00. The tighter
    // one wins, or a portal form would be a way to buy 24-hour access free.
    expect(window.saturday).toEqual({ closed: false, open: '06:00', close: '22:00' })
  })

  it('leaves a person with no window on the facility hours', async () => {
    const { credentialId } = await add({ phone: '555-0104' })
    await propagateGateHours(facilityId)
    await drainGateCommands(new Date(), facilityId)

    const code = await prisma.simulatedGateCode.findFirstOrThrow({ where: { credentialId } })
    const window = code.windowSchedule as Record<string, unknown>
    expect(window.monday).toEqual({ closed: false, open: '06:00', close: '22:00' })
  })
})
