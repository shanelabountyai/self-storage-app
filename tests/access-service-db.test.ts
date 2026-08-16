import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import {
  drainGateCommands,
  ensureGrant,
  ensureGrantForHolder,
  generateCode,
  generateUniqueCode,
  issueCredential,
  revealCode,
  transitionGrant,
} from '../apps/web/lib/access/service'
import { codeForLease, provisionAccessForLease } from '../apps/web/lib/access/provision'
import { leaseIdForSession } from '../apps/web/lib/checkout/provision'
import { hashCode } from '../apps/web/lib/access/secret'
import * as adapters from '../apps/web/lib/access/adapter'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-027 / PRD 03 FR-1–FR-3.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let staffId = ''
let bookkeeperId = ''

const ownerActor = (): Actor => ({
  kind: 'staff',
  staffUserId: staffId,
  assignments: [
    {
      facilityId,
      roleKey: 'owner',
      rank: 40,
      permissions: new Set<PermissionKey>(['access:view_codes']),
      limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
    },
  ],
})

// A real staff role that does not hold `access:view_codes` (bookkeeper is
// read-only) — the negative case for the reveal permission check.
const bookkeeperActor = (): Actor => ({
  kind: 'staff',
  staffUserId: bookkeeperId,
  assignments: [
    {
      facilityId,
      roleKey: 'bookkeeper',
      rank: 10,
      permissions: new Set<PermissionKey>(),
      limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
    },
  ],
})

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

    // recordAudit's actor is a real FK to staff_user (see facility-settings-db
    // test's own note), so revealCode's audited path needs actual rows.
    const [owner, bookkeeper] = await Promise.all([
      prisma.staffUser.create({
        data: { email: `access-owner-${suffix}@example.com`, firstName: 'Owner', lastName: 'Test' },
      }),
      prisma.staffUser.create({
        data: { email: `access-bookkeeper-${suffix}@example.com`, firstName: 'Bk', lastName: 'Test' },
      }),
    ])
    staffId = owner.id
    bookkeeperId = bookkeeper.id
  })

  beforeEach(async () => {
    vi.restoreAllMocks()
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    // Not the facility: revealCode's audit entries hold a Restrict FK to it
    // (facility-settings-db.test.ts's tests hit the same wall) — a facility
    // with audit history cannot be hard-deleted, by design (PRD 02 FR-10).
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

  it('holds one grant per authorized person too, the same shape as a tenant holder', async () => {
    // FR-1, widened by B-029: the holder is whichever of tenantId /
    // authorizedPersonId is set, and either shape gets exactly one grant.
    const person = await prisma.authorizedAccessPerson.create({
      data: {
        facilityId,
        leaseId,
        name: 'Backup Holder',
        phone: '555-0100',
        relationship: 'spouse',
        createdByStaffId: staffId,
      },
    })

    const first = await ensureGrantForHolder(facilityId, { authorizedPersonId: person.id }, 'staff:test')
    const second = await ensureGrantForHolder(facilityId, { authorizedPersonId: person.id }, 'staff:test')
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.grantId).toBe(first.grantId)

    // Never touches the tenant's own grant on the same facility.
    const tenantGrant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    expect(tenantGrant.grantId).not.toBe(first.grantId)

    // Not cleaned up here: AccessGrant→AuthorizedAccessPerson is Restrict, so
    // this row has to outlive the grant referencing it. afterAll's
    // accessGrant.deleteMany runs before its lease.deleteMany, which then
    // cascades to this row.
  })

  it('rejects an AccessGrant row with both holders, or neither, at the database', async () => {
    // The DB CHECK constraint (migration 20260802110000) is the backstop for
    // FR-1's "exactly one holder" — Prisma's schema language cannot express
    // it, so this is the only place that invariant can actually be proven.
    // (The legal case — exactly one of the two set — is exercised by every
    // other test in this file via ensureGrant/ensureGrantForHolder.)
    await expect(
      prisma.accessGrant.create({
        data: { facilityId, tenantId: null, authorizedPersonId: null, state: 'pending' },
      }),
    ).rejects.toThrow()

    const person = await prisma.authorizedAccessPerson.create({
      data: {
        facilityId,
        leaseId,
        name: 'Both Holders Test',
        phone: '555-0101',
        relationship: 'roommate',
        createdByStaffId: staffId,
      },
    })
    await expect(
      prisma.accessGrant.create({
        data: { facilityId, tenantId, authorizedPersonId: person.id, state: 'pending' },
      }),
    ).rejects.toThrow()
    await prisma.authorizedAccessPerson.delete({ where: { id: person.id } })
  })

  it('retries past a code collision rather than issuing a duplicate', async () => {
    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    const first = await issueCredential(grant.grantId, leaseId)

    let calls = 0
    const result = await generateUniqueCode(facilityId, prisma, () => {
      calls += 1
      return calls === 1 ? first.code : '482913'
    })

    expect(calls).toBe(2)
    expect(result.code).toBe('482913')
    expect(result.codeHash).toBe(hashCode('482913'))
  })

  it('gives up after exhausting its attempt budget rather than looping forever', async () => {
    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    await prisma.accessCredential.create({
      data: {
        facilityId,
        grantId: grant.grantId,
        leaseId,
        type: 'pin',
        valueRef: 'unrevealable:test',
        codeHash: hashCode('111111'),
        state: 'active',
        syncStatus: 'pending',
      },
    })

    await expect(generateUniqueCode(facilityId, prisma, () => '111111')).rejects.toThrow(
      /unique gate code/,
    )
  })

  it('reveals a code only to staff who hold access:view_codes, and audits the read', async () => {
    const original = process.env.ACCESS_CODE_ENCRYPTION_KEY
    process.env.ACCESS_CODE_ENCRYPTION_KEY = randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64)

    try {
      const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
      const issued = await issueCredential(grant.grantId, leaseId)

      await expect(revealCode(bookkeeperActor(), issued.credentialId, 'other')).rejects.toThrow(
        ForbiddenError,
      )

      const revealed = await revealCode(ownerActor(), issued.credentialId, 'other')
      expect(revealed).toEqual({ available: true, code: issued.code })

      const entries = await prisma.auditLog.findMany({
        where: { entityId: issued.credentialId, action: 'access.code_viewed' },
      })
      expect(entries).toHaveLength(1)
      expect(entries[0].actorStaffId).toBe(staffId)
    } finally {
      process.env.ACCESS_CODE_ENCRYPTION_KEY = original
    }
  })

  it('reveals as unavailable, not an error, when no encryption key is configured', async () => {
    const original = process.env.ACCESS_CODE_ENCRYPTION_KEY
    delete process.env.ACCESS_CODE_ENCRYPTION_KEY

    try {
      const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
      const issued = await issueCredential(grant.grantId, leaseId)

      const revealed = await revealCode(ownerActor(), issued.credentialId, 'other')
      expect(revealed).toMatchObject({ available: false })
    } finally {
      process.env.ACCESS_CODE_ENCRYPTION_KEY = original
    }
  })

  it('gives the confirmation page its own code, keyed off the lease rather than a permission', async () => {
    const original = process.env.ACCESS_CODE_ENCRYPTION_KEY
    process.env.ACCESS_CODE_ENCRYPTION_KEY = randomUUID().replace(/-/g, '').padEnd(64, '1').slice(0, 64)

    try {
      const provisioned = await provisionAccessForLease(leaseId)
      if (!('code' in provisioned)) throw new Error('expected a freshly issued code')

      expect(await codeForLease(leaseId)).toBe(provisioned.code)
      expect(await codeForLease('no-such-lease')).toBeNull()
    } finally {
      process.env.ACCESS_CODE_ENCRYPTION_KEY = original
    }
  })

  // D-54 (B-106 part 5). The grant is keyed `(facilityId, tenantId)`, so a
  // credential per LEASE handed a three-unit renter three PINs that opened the
  // same gate with identical permissions and hours. B-106 part 4 shipped
  // exactly that, and nothing asserted otherwise — which is why this test
  // exists rather than only the fix.
  it('issues one code per tenant per facility, not one per unit they rent', async () => {
    const original = process.env.ACCESS_CODE_ENCRYPTION_KEY
    process.env.ACCESS_CODE_ENCRYPTION_KEY = randomUUID().replace(/-/g, '').padEnd(64, '1').slice(0, 64)

    try {
      const unitType = await prisma.unitType.findFirstOrThrow({ where: { facilityId } })
      const second = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: `B-${suffix.slice(0, 4)}` },
      })
      const secondLease = await prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: second.id,
          status: 'active',
          startDate: new Date(),
          monthlyRateCents: 9_900,
          billingDay: 1,
        },
      })

      const first = await provisionAccessForLease(leaseId)
      if (!('code' in first)) throw new Error('expected a freshly issued code')
      const alsoTheirs = await provisionAccessForLease(secondLease.id)

      // The second unit mints nothing: the tenant already has a working code
      // for this gate.
      expect(alsoTheirs).toMatchObject({ alreadyProvisioned: true })
      expect(
        await prisma.accessCredential.count({ where: { facilityId, state: 'active' } }),
      ).toBe(1)

      // ...and the portal card for the SECOND unit shows that same code rather
      // than falling back to "it will be texted to you", which is what a
      // `leaseId` match returned before D-54.
      expect(await codeForLease(secondLease.id)).toBe(first.code)
      expect(await codeForLease(leaseId)).toBe(first.code)

      await prisma.lease.delete({ where: { id: secondLease.id } })
      await prisma.unit.delete({ where: { id: second.id } })
    } finally {
      process.env.ACCESS_CODE_ENCRYPTION_KEY = original
    }
  })

  it('resolves the checkout session that became this lease', async () => {
    const session = await prisma.checkoutSession.create({
      data: {
        facilityId,
        unitTypeId: (await prisma.unit.findFirstOrThrow({ where: { facilityId } })).unitTypeId,
        tenantId,
        unitId: (await prisma.unit.findFirstOrThrow({ where: { facilityId } })).id,
        step: 'provisioned',
        status: 'completed',
        quotedRateCents: 12_900,
        tokenHash: `test-${suffix}`,
        lockExpiresAt: new Date(Date.now() + 60_000),
      },
    })

    expect(await leaseIdForSession(session.id)).toBe(leaseId)
    expect(await leaseIdForSession('no-such-session')).toBeNull()

    await prisma.checkoutSession.delete({ where: { id: session.id } })
  })
})
