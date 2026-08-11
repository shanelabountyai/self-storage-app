import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { simulatedAdapter } from '../apps/web/lib/access/adapter'
import type { GateAdapter, GateCommandInput } from '../apps/web/lib/access/adapter'
import { ptiCloudAdapter } from '../apps/web/lib/access/vendors/pti-cloud'
import { hashCode } from '../apps/web/lib/access/secret'

// PRD 03 §8 Phase 2 (B-080): "adapter contract-test suite".
//
// One set of assertions, run against EVERY adapter. This is the thing that
// makes the port a port rather than an interface somebody wrote down once: if a
// future driver (B-085's real vendor) does not satisfy these, the port has been
// broken by an implementation that only happened to work for the caller that
// was tested with it.
//
// Every rule below is here because getting it wrong produces a specific, quiet
// failure in production — noted per assertion. They are deliberately about the
// CONTRACT (what a caller may rely on) rather than about behaviour peculiar to
// any one controller.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let grantId = ''
let credentialId = ''
let tenantId = ''

const CODE = '445566'

function command(overrides: Partial<GateCommandInput> = {}): GateCommandInput {
  return {
    type: 'set_credential',
    facilityId,
    grantId,
    credentialId,
    payload: { code: CODE },
    ...overrides,
  }
}

describeDb('gate adapter contract', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Adapter ${suffix}`,
        slug: `adapter-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `ad-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const grant = await prisma.accessGrant.create({
      data: { facilityId, tenantId, state: 'active' },
    })
    grantId = grant.id

    const credential = await prisma.accessCredential.create({
      data: {
        facilityId,
        grantId,
        type: 'pin',
        valueRef: `unrevealable:${suffix}`,
        codeHash: hashCode(CODE),
        state: 'active',
      },
    })
    credentialId = credential.id
  })

  beforeEach(async () => {
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.update({ where: { id: grantId }, data: { state: 'active', extendedHours: false } })
    await prisma.accessCredential.update({ where: { id: credentialId }, data: { state: 'active' } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
    // Facility stays: `audit_log` RESTRICT-references it.
  })

  // The manual adapter never reaches an adapter's `send` — B-027's drain parks
  // the command as a task first — so the contract it has to satisfy is the read
  // half only. It is constructed inline rather than exported, because there is
  // deliberately no manual "driver" object in the codebase to mistake for one.
  const manualLike: GateAdapter = {
    name: 'manual',
    async send() {
      return { ok: false, retryable: false, message: 'This facility is on the manual adapter' }
    },
    async snapshot() {
      return { verifiable: false, reason: 'Manual adapter cannot be read back' }
    },
  }

  const ADAPTERS: { name: string; adapter: GateAdapter; enumerates: boolean }[] = [
    { name: 'simulated', adapter: simulatedAdapter, enumerates: true },
    { name: 'pti_cloud', adapter: ptiCloudAdapter, enumerates: true },
    { name: 'manual', adapter: manualLike, enumerates: false },
  ]

  describe.each(ADAPTERS)('$name', ({ adapter, enumerates }) => {
    it('answers every command with a well-formed result', async () => {
      // A driver that throws instead of returning is a driver B-027's drain
      // cannot classify: an exception is neither retryable nor permanent, so
      // the command neither retries nor dead-letters — it is simply lost.
      const result = await adapter.send(command())
      expect(result.ok === true || typeof result.retryable === 'boolean').toBe(true)
    })

    it('refuses an unknown command type WITHOUT asking for a retry', async () => {
      // Retrying a command the controller will never understand burns the retry
      // budget and delays the dead-letter that is the actual staff alert.
      const result = await adapter.send(
        command({ type: 'not_a_real_command' as GateCommandInput['type'] }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.retryable).toBe(false)
    })

    it('refuses a malformed command WITHOUT asking for a retry', async () => {
      const result = await adapter.send(command({ credentialId: null }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.retryable).toBe(false)
    })

    it('always answers a snapshot request, even when it cannot enumerate', async () => {
      // `snapshot` is not optional on the port. An adapter that omitted it
      // would make every caller ask "does this one support reading back?",
      // and the honest answer — "no, so nothing here is verified" — is exactly
      // what a reconciliation report must be able to say.
      const snapshot = await adapter.snapshot(facilityId)
      expect(typeof snapshot.verifiable).toBe('boolean')
      if (!snapshot.verifiable) expect(snapshot.reason).toBeTruthy()
    })

    if (!enumerates) return

    it('applies a credential and reads it back', async () => {
      expect((await adapter.send(command())).ok).toBe(true)

      const snapshot = await adapter.snapshot(facilityId)
      if (!snapshot.verifiable) throw new Error('expected an enumerable adapter')

      const entry = snapshot.entries.find((row) => row.credentialId === credentialId)
      expect(entry).toBeDefined()
      // The hash, never the code. A snapshot that returned plaintext would put
      // gate codes into drift reports, job logs and tasks (SR-1).
      expect(entry?.codeHash).toBe(hashCode(CODE))
      expect(entry?.opens).toBe(true)
      expect(entry?.externalId).toBeTruthy()
    })

    it('is idempotent — sending the same command twice leaves one entry', async () => {
      // B-027 retries on any retryable failure, and a webhook or cron can
      // redeliver. An adapter that created a second controller entry on the
      // second attempt would leave a duplicate code behind on every retry, and
      // the duplicate would outlive the tenant.
      await adapter.send(command())
      await adapter.send(command())

      const snapshot = await adapter.snapshot(facilityId)
      if (!snapshot.verifiable) throw new Error('expected an enumerable adapter')
      expect(snapshot.entries.filter((row) => row.credentialId === credentialId)).toHaveLength(1)
    })

    it('suspends and resumes without losing the code', async () => {
      await adapter.send(command())

      expect((await adapter.send(command({ type: 'suspend_access' }))).ok).toBe(true)
      let snapshot = await adapter.snapshot(facilityId)
      if (!snapshot.verifiable) throw new Error('expected an enumerable adapter')
      let entry = snapshot.entries.find((row) => row.credentialId === credentialId)
      expect(entry?.opens).toBe(false)
      // The code has to survive a suspension. A driver that cleared it would
      // make D-16's automatic restore-on-payment issue a NEW code, and the
      // tenant who paid at 9pm would be given a code they were never told.
      expect(entry?.codeHash).toBe(hashCode(CODE))

      expect((await adapter.send(command({ type: 'resume_access' }))).ok).toBe(true)
      snapshot = await adapter.snapshot(facilityId)
      if (!snapshot.verifiable) throw new Error('expected an enumerable adapter')
      entry = snapshot.entries.find((row) => row.credentialId === credentialId)
      expect(entry?.opens).toBe(true)
      expect(entry?.codeHash).toBe(hashCode(CODE))
    })

    it('stops the code opening the gate after a revoke', async () => {
      await adapter.send(command())
      expect((await adapter.send(command({ type: 'revoke_access' }))).ok).toBe(true)

      const snapshot = await adapter.snapshot(facilityId)
      if (!snapshot.verifiable) throw new Error('expected an enumerable adapter')
      const entry = snapshot.entries.find((row) => row.credentialId === credentialId)

      // Deliberately permissive about HOW: the simulator disables the row and
      // PTI deletes it, because the vendor has no "revoked" state. The contract
      // is only that the code no longer opens the gate — which is the property
      // a move-out actually depends on, and the one a driver must not get wrong.
      expect(entry === undefined || entry.opens === false).toBe(true)
    })

    it('does not enable a suspended grant when a code is pushed', async () => {
      // The quiet one. `set_credential` is issued on a code rotation, and if a
      // driver pushes the code without regard to grant state, rotating a
      // suspended tenant's code silently restores their access — which is a
      // delinquent tenant back in the building with no event anywhere saying so.
      await prisma.accessGrant.update({ where: { id: grantId }, data: { state: 'suspended' } })

      expect((await adapter.send(command())).ok).toBe(true)

      const snapshot = await adapter.snapshot(facilityId)
      if (!snapshot.verifiable) throw new Error('expected an enumerable adapter')
      expect(snapshot.entries.find((row) => row.credentialId === credentialId)?.opens).toBe(false)
    })

    it('reports a controller entry we cannot match as unattributed', async () => {
      await adapter.send(command())
      // A code the controller holds for a credential that no longer exists on
      // our side. Reconciliation's most valuable finding, and it only works if
      // the adapter refuses to guess whose it was.
      await prisma.simulatedGateCode.create({
        data: { facilityId, credentialId: `ghost-${suffix}`, code: '999888', active: true },
      })

      const snapshot = await adapter.snapshot(facilityId)
      if (!snapshot.verifiable) throw new Error('expected an enumerable adapter')
      const ghost = snapshot.entries.find((row) => row.codeHash === hashCode('999888'))
      expect(ghost).toBeDefined()
      expect(ghost?.credentialId).toBeNull()

      await prisma.simulatedGateCode.deleteMany({ where: { credentialId: `ghost-${suffix}` } })
    })
  })
})
