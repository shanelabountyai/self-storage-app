import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { NoActiveCodeError, replaceGateCode } from '../apps/web/lib/access/replace-code'
import { enrollMobileKey, unlockWithMobileKey } from '../apps/web/lib/access/mobile-key'
import { createAuthorizedPerson } from '../apps/web/lib/access/authorized-persons'
import { codeForLease, provisionAccessForLease } from '../apps/web/lib/access/provision'
import { evaluateKeypadEntry } from '../apps/web/lib/access/simulator'
import type { Actor } from '../apps/web/lib/rbac/actor'

// PRD 03 US-1 "a tenant can replace their own code" (B-418).

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''

const tenantActor = (): Extract<Actor, { kind: 'tenant' }> => ({ kind: 'tenant', tenantId })

async function provisionedPin(): Promise<string> {
  const provisioned = await provisionAccessForLease(leaseId)
  const pin = provisioned.ok && 'code' in provisioned ? provisioned.code : ''
  expect(pin).toMatch(/^\d{6}$/)
  return pin
}

describeDb('replacing a gate code', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Replace Code Test',
        slug: `replace-code-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id
    const tenant = await prisma.tenant.create({
      data: { email: `replace-code-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: 'A-1' } })
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
    await prisma.accessEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedVendorEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.authorizedAccessPerson.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.accessEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedVendorEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.authorizedAccessPerson.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  it('denies the old code at the keypad, grants the new one, and audits once', async () => {
    const old = await provisionedPin()
    expect((await evaluateKeypadEntry(facilityId, old)).result).toBe('granted')

    const replaced = await replaceGateCode(tenantActor(), tenantId, facilityId)
    expect(replaced.code).toMatch(/^\d{6}$/)
    expect(replaced.code).not.toBe(old)

    expect((await evaluateKeypadEntry(facilityId, old)).result).toBe('denied')
    expect((await evaluateKeypadEntry(facilityId, replaced.code)).result).toBe('granted')
    // What the portal shows is the new one.
    expect(await codeForLease(leaseId)).toBe(replaced.code)
    // One PIN live, one revoked — the grant itself never moved.
    const pins = await prisma.accessCredential.findMany({ where: { facilityId, type: 'pin' } })
    expect(pins.map((p) => p.state).sort()).toEqual(['active', 'revoked'])

    const audits = await prisma.auditLog.findMany({
      where: { facilityId, action: 'access.code_replaced' },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actorType: 'tenant', entityId: replaced.credentialId })
  })

  it("leaves authorized persons' codes and the phone key alone", async () => {
    await provisionedPin()
    const person = await createAuthorizedPerson(tenantActor(), leaseId, {
      name: 'Bo Helper',
      phone: '512-555-0101',
      relationship: 'brother',
      accessHours: null,
      expiresOn: null,
    })
    await enrollMobileKey(tenantActor(), facilityId)

    await replaceGateCode(tenantActor(), tenantId, facilityId)

    expect((await evaluateKeypadEntry(facilityId, person.code)).result).toBe('granted')
    expect((await unlockWithMobileKey(tenantId, facilityId)).opened).toBe(true)
  })

  it('refuses a tenant with no code here and a stranger to the grant', async () => {
    await expect(replaceGateCode(tenantActor(), tenantId, facilityId)).rejects.toBeInstanceOf(NoActiveCodeError)
    await provisionedPin()
    await expect(
      replaceGateCode({ kind: 'tenant', tenantId: 'someone-else' }, tenantId, facilityId),
    ).rejects.toBeInstanceOf(NoActiveCodeError)
    await expect(
      replaceGateCode({ kind: 'staff', staffUserId: 'nobody', assignments: [] }, tenantId, facilityId),
    ).rejects.toThrow()
  })
})
