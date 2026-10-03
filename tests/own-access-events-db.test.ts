import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { ownAccessEvents } from '../apps/web/lib/portal/own-access-events'
import { ensureGrantForHolder, issueCredential } from '../apps/web/lib/access/service'

// B-431: the tenant sees their own and their authorized person's entries, and
// nobody else's.

const describeDb = process.env.DATABASE_URL ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const now = new Date('2026-10-03T15:00:00Z')
let facilityId = ''
let tenantId = ''
let otherId = ''

async function event(credentialId: string, ageDays: number, tag: string) {
  await prisma.accessEvent.create({
    data: {
      facilityId,
      vendorEventId: `${tag}-${suffix}`,
      credentialId,
      result: 'granted',
      reason: 'ok',
      occurredAt: new Date(now.getTime() - ageDays * 86_400_000),
    },
  })
}

describeDb('own access events (B-431)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Hist ${suffix}`,
        slug: `hist-${suffix}`,
        addressLine1: '1 Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `T ${suffix}`, widthFt: 5, lengthFt: 5 },
    })
    const ids: string[] = []
    const leases: string[] = []
    for (const k of ['a', 'b']) {
      const tenant = await prisma.tenant.create({
        data: { email: `h-${k}-${suffix}@example.com`, firstName: k, lastName: 'T' },
      })
      ids.push(tenant.id)
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: `${k}-${suffix.slice(0, 4)}` },
      })
      const lease = await prisma.lease.create({
        data: {
          facilityId,
          tenantId: tenant.id,
          unitId: unit.id,
          status: 'active',
          startDate: new Date('2026-06-01T00:00:00Z'),
          billingDay: 1,
          monthlyRateCents: 10_000,
        },
      })
      leases.push(lease.id)
    }
    ;[tenantId, otherId] = ids

    const own = await ensureGrantForHolder(facilityId, { tenantId }, 'system:move_in')
    const ownCred = await issueCredential(own.grantId, leases[0])
    const person = await prisma.authorizedAccessPerson.create({
      data: { facilityId, leaseId: leases[0], name: 'Bea Helper', phone: '512-555-0100', relationship: 'sister' },
    })
    const pg = await ensureGrantForHolder(facilityId, { authorizedPersonId: person.id }, 'system:move_in')
    const personCred = await issueCredential(pg.grantId, leases[0])
    const neighbour = await ensureGrantForHolder(facilityId, { tenantId: otherId }, 'system:move_in')
    const neighbourCred = await issueCredential(neighbour.grantId, leases[1])

    await event(ownCred.credentialId, 1, 'own')
    await event(personCred.credentialId, 2, 'person')
    await event(ownCred.credentialId, 31, 'old')
    await event(neighbourCred.credentialId, 1, 'neighbour')
  })

  afterAll(async () => {
    // The facility stays: audit_log RESTRICT-references it.
    if (facilityId) await prisma.accessEvent.deleteMany({ where: { facilityId } })
  })

  it('lists the tenant and their person, newest first, within 30 days', async () => {
    const rows = await ownAccessEvents(tenantId, now)
    expect(rows.map((r) => r.personName)).toEqual([null, 'Bea Helper'])
  })

  it('never shows a neighbour’s events', async () => {
    const rows = await ownAccessEvents(otherId, now)
    expect(rows).toHaveLength(1)
    expect(rows[0].personName).toBeNull()
  })
})
