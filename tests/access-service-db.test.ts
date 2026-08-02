import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import {
  drainGateCommands,
  ensureGrant,
  generateCode,
  issueCredential,
  transitionGrant,
} from '../apps/web/lib/access/service'
import { provisionAccessForLease } from '../apps/web/lib/access/provision'
import * as adapters from '../apps/web/lib/access/adapter'

// B-027 / PRD 03 FR-1–FR-3.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''

describe('gate code policy', () => {
  it('never generates an obvious code', () => {
    // A keypad wears, and "123456" or six identical digits is what a stranger
    // tries first. Tested against the generator directly — running it through
    // the database forty times proves the same thing far more slowly.
    for (let i = 0; i < 5_000; i++) {
      const code = generateCode()
      expect(code).toMatch(/^\d{6}$/)
      expect(code).not.toMatch(/^(\d)\1{5}$/)
      expect('0123456789').not.toContain(code)
      expect('9876543210').not.toContain(code)
    }
  })
})

describeDb('access control service', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Access Test',
        slug: `access-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `access-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
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
    vi.restoreAllMocks()
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  it('holds one grant per tenant per facility', async () => {
    // FR-1: a tenant with two units at one site still holds one grant.
    const first = await ensureGrant(facilityId, tenantId, 'system:move_in')
    const second = await ensureGrant(facilityId, tenantId, 'system:move_in')
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.grantId).toBe(first.grantId)
    expect(await prisma.accessGrant.count({ where: { facilityId } })).toBe(1)
  })

  it('queues a command for every real transition and none for a repeat', async () => {
    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    await transitionGrant(grant.grantId, 'active', 'system:move_in')
    const afterFirst = await prisma.gateCommand.count({ where: { facilityId } })
    expect(afterFirst).toBe(1)

    // A delinquency run firing twice must not tell the controller twice.
    const repeat = await transitionGrant(grant.grantId, 'active', 'system:move_in')
    expect(repeat).toMatchObject({ ok: true, changed: false })
    expect(await prisma.gateCommand.count({ where: { facilityId } })).toBe(afterFirst)
  })

  it('refuses to revive a revoked grant', async () => {
    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    await transitionGrant(grant.grantId, 'active', 'system:move_in')
    await transitionGrant(grant.grantId, 'revoked', 'system:move_out')

    const revived = await transitionGrant(grant.grantId, 'active', 'staff:someone')
    expect(revived.ok).toBe(false)
  })

  it('generates a code without storing it', async () => {
    // SR-2: the credential row holds a reference, never the digits. The
    // plaintext exists only in the return value and in what goes to the
    // controller.
    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    const issued = await issueCredential(grant.grantId, leaseId)

    expect(issued.code).toMatch(/^\d{6}$/)
    const credential = await prisma.accessCredential.findUniqueOrThrow({
      where: { id: issued.credentialId },
    })
    expect(credential.valueRef).not.toContain(issued.code)
    expect(JSON.stringify(credential)).not.toContain(issued.code)
  })

  it('marks a credential synced once the controller accepts it', async () => {
    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    const issued = await issueCredential(grant.grantId, leaseId)

    const result = await drainGateCommands(new Date(), facilityId)
    expect(result.succeeded).toBeGreaterThan(0)

    const credential = await prisma.accessCredential.findUniqueOrThrow({
      where: { id: issued.credentialId },
    })
    expect(credential.syncStatus).toBe('synced')
    expect(credential.lastSyncAt).not.toBeNull()
  })

  it('retries a controller that is merely offline', async () => {
    vi.spyOn(adapters, 'adapterFor').mockReturnValue(
      adapters.scriptedAdapter([{ ok: false, retryable: true, message: 'controller offline' }]),
    )

    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    await issueCredential(grant.grantId, leaseId)

    const result = await drainGateCommands(new Date(), facilityId)
    expect(result.failed).toBe(1)
    expect(result.deadLettered).toBe(0)

    const command = await prisma.gateCommand.findFirstOrThrow({ where: { facilityId } })
    expect(command.status).toBe('failed')
    // Backed off rather than retried immediately — a controller that is down
    // should not be hammered.
    expect(command.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('dead-letters immediately when the controller says no', async () => {
    // A rejected code will fail identically on retry; retrying only delays the
    // staff alert that is the actual fix.
    vi.spyOn(adapters, 'adapterFor').mockReturnValue(
      adapters.scriptedAdapter([{ ok: false, retryable: false, message: 'zone unknown' }]),
    )

    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    const issued = await issueCredential(grant.grantId, leaseId)

    const result = await drainGateCommands(new Date(), facilityId)
    expect(result.deadLettered).toBe(1)

    const credential = await prisma.accessCredential.findUniqueOrThrow({
      where: { id: issued.credentialId },
    })
    expect(credential.syncStatus).toBe('failed')

    // FR-3's staff alert. The tenant is moved in and expecting a code, so this
    // has to reach a human rather than sitting in a table.
    const alerts = await prisma.domainEvent.findMany({
      where: { facilityId, name: 'access.sync_failed' },
    })
    expect(alerts).toHaveLength(1)
  })

  it('gives up after a bounded number of attempts', async () => {
    vi.spyOn(adapters, 'adapterFor').mockReturnValue(
      adapters.scriptedAdapter([{ ok: false, retryable: true, message: 'still offline' }]),
    )

    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    await issueCredential(grant.grantId, leaseId)

    // Each pass is "later", so the backoff never blocks the next attempt.
    for (let attempt = 1; attempt <= 5; attempt++) {
      await drainGateCommands(new Date(Date.now() + attempt * 60 * 60_000), facilityId)
    }

    const command = await prisma.gateCommand.findFirstOrThrow({ where: { facilityId } })
    expect(command.status).toBe('dead_lettered')
    expect(command.attempts).toBe(5)
  })

  it('provisions a move-in idempotently', async () => {
    const first = await provisionAccessForLease(leaseId)
    const second = await provisionAccessForLease(leaseId)

    expect(first.ok).toBe(true)
    expect(second).toMatchObject({ ok: true, alreadyProvisioned: true })
    // One code, not two — a redelivered lease.moved_in must not mint another.
    expect(await prisma.accessCredential.count({ where: { leaseId, state: 'active' } })).toBe(1)
  })

  it('reports a missing lease rather than throwing', async () => {
    expect(await provisionAccessForLease('no-such-lease')).toMatchObject({
      ok: false,
      reason: 'lease_not_found',
    })
  })
})
