import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { reconcileFacility } from '../apps/web/lib/access/reconciliation'
import {
  acceptableSecrets,
  pruneRetiredSecrets,
  rotateWebhookSecret,
  signingSecret,
  webhookSecretStatus,
} from '../apps/web/lib/access/webhook-secrets'
import {
  addCamera,
  facilityCameras,
  InvalidCameraUrlError,
  removeCamera,
  validateCameraUrl,
} from '../apps/web/lib/access/cameras'
import { gateHealth } from '../apps/web/lib/admin/gate-health'
import { accessCodeEncryptionKey, hashCode } from '../apps/web/lib/access/secret'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-080 / PRD 03 FR-9, FR-10, SR-4 — against real rows.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let otherFacilityId = ''
let staffId = ''
let tenantId = ''
let grantId = ''
let credentialId = ''

const CODE = '778899'

function actor(facilityIds: (string | null)[] = [facilityId]): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: facilityIds.map((id) => ({
      facilityId: id,
      roleKey: 'manager',
      rank: 20,
      permissions: new Set(['facility:settings', 'access:events'] as never),
      limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
    })),
  }
}

describeDb('gate hardening (FR-9 / FR-10 / SR-4)', () => {
  beforeAll(async () => {
    const staff = await prisma.staffUser.create({
      data: { email: `gh-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const facility = await prisma.facility.create({
      data: {
        name: `Gate ${suffix}`,
        slug: `gate-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const other = await prisma.facility.create({
      data: {
        name: `Gate other ${suffix}`,
        slug: `gate-other-${suffix}`,
        addressLine1: '2 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    otherFacilityId = other.id

    const tenant = await prisma.tenant.create({
      data: { email: `gh-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
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
    await prisma.gateReconciliationRun.deleteMany({ where: { facilityId } })
    await prisma.gateWebhookSecret.deleteMany({ where: { facilityId } })
    await prisma.facilityCamera.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId, type: 'gate_drift_review' } })
    await prisma.accessGrant.update({
      where: { id: grantId },
      data: { state: 'active', extendedHours: false },
    })
    await prisma.accessCredential.update({
      where: { id: credentialId },
      data: { state: 'active' },
    })
    await prisma.facility.update({
      where: { id: facilityId },
      data: { gateAdapter: 'simulated', gateHours: undefined },
    })
    await prisma.gateSimulatorConfig.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.gateReconciliationRun.deleteMany({ where: { facilityId } })
    await prisma.gateWebhookSecret.deleteMany({ where: { facilityId } })
    await prisma.facilityCamera.deleteMany({ where: { facilityId } })
    await prisma.task.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {})
    // Facilities and staff stay: `audit_log` is append-only and
    // RESTRICT-references the facility.
  })

  describe('reconciliation (FR-9)', () => {
    /// Puts the controller in the state a correctly-synced site would be in.
    async function controllerInSync() {
      await prisma.simulatedGateCode.create({
        data: { facilityId, credentialId, code: CODE, active: true },
      })
    }

    it('finds nothing when the controller matches', async () => {
      await controllerInSync()
      const result = await reconcileFacility(facilityId)
      expect(result.verifiable).toBe(true)
      expect(result.drifts).toEqual([])
      expect(result.credentialsChecked).toBe(1)
    })

    it('finds a code the controller honours that we revoked', async () => {
      await controllerInSync()
      // The move-out happened on our side; the command never reached the gate.
      await prisma.accessCredential.update({
        where: { id: credentialId },
        data: { state: 'revoked' },
      })

      const result = await reconcileFacility(facilityId)
      expect(result.drifts.map((drift) => drift.kind)).toContain('open_state_mismatch')
      expect(result.permissiveCount).toBeGreaterThan(0)
    })

    it('finds a ghost code belonging to no credential of ours', async () => {
      await controllerInSync()
      await prisma.simulatedGateCode.create({
        data: { facilityId, credentialId: `ghost-${suffix}`, code: '111222', active: true },
      })

      const result = await reconcileFacility(facilityId)
      const ghost = result.drifts.find((drift) => drift.kind === 'unknown_at_controller')
      expect(ghost).toBeDefined()
      expect(ghost?.gateTooPermissive).toBe(true)
    })

    it('never puts a gate code in the stored findings', async () => {
      // The findings are read on a screen, written to a job log and attached to
      // a task. SR-1 keeps codes out of all three.
      await controllerInSync()
      await prisma.simulatedGateCode.update({
        where: { credentialId },
        data: { code: '424242' },
      })

      await reconcileFacility(facilityId)
      const run = await prisma.gateReconciliationRun.findFirstOrThrow({ where: { facilityId } })
      expect(JSON.stringify(run.drifts)).not.toContain('424242')
      expect(JSON.stringify(run.drifts)).not.toContain(CODE)
    })

    it('raises exactly one task per facility per day, however many findings', async () => {
      await controllerInSync()
      for (const n of ['1', '2', '3']) {
        await prisma.simulatedGateCode.create({
          data: { facilityId, credentialId: `ghost-${n}-${suffix}`, code: `90000${n}`, active: true },
        })
      }

      await reconcileFacility(facilityId)
      await reconcileFacility(facilityId)

      const tasks = await prisma.task.findMany({
        where: { facilityId, type: 'gate_drift_review' },
      })
      // Three findings, two runs, one task. A controller restored from backup
      // can produce dozens at once, and dozens of tasks is a queue nobody opens.
      expect(tasks).toHaveLength(1)
      expect(tasks[0].priority).toBe('high')
    })

    it('raises no task at all when there is no drift', async () => {
      await controllerInSync()
      await reconcileFacility(facilityId)
      expect(await prisma.task.count({ where: { facilityId, type: 'gate_drift_review' } })).toBe(0)
    })

    it('overwrites the day’s row rather than filling history with duplicates', async () => {
      await controllerInSync()
      await reconcileFacility(facilityId)
      await reconcileFacility(facilityId)
      expect(await prisma.gateReconciliationRun.count({ where: { facilityId } })).toBe(1)
    })

    it('records a manual facility as NOT verifiable rather than skipping it', async () => {
      // A site that silently drops out of the report is one nobody notices has
      // been unverified for six months.
      await prisma.facility.update({ where: { id: facilityId }, data: { gateAdapter: 'manual' } })

      const result = await reconcileFacility(facilityId)
      expect(result.verifiable).toBe(false)
      const run = await prisma.gateReconciliationRun.findFirstOrThrow({ where: { facilityId } })
      expect(run.verifiable).toBe(false)
      expect(run.driftCount).toBe(0)
    })

    it('reports an OFFLINE controller as not verifiable, not as everything missing', async () => {
      // The dangerous confusion: an empty entry list would read as "the
      // controller holds nothing" and flag every credential at the site.
      await controllerInSync()
      await prisma.gateSimulatorConfig.create({ data: { facilityId, offline: true } })

      const result = await reconcileFacility(facilityId)
      expect(result.verifiable).toBe(false)
      expect(result.drifts).toEqual([])
    })

    it('audits drift', async () => {
      await controllerInSync()
      await prisma.simulatedGateCode.create({
        data: { facilityId, credentialId: `ghost-a-${suffix}`, code: '313131', active: true },
      })
      await reconcileFacility(facilityId)

      const entry = await prisma.auditLog.findFirst({
        where: { action: 'gate.drift_detected', entityId: facilityId },
        orderBy: { occurredAt: 'desc' },
      })
      expect(entry).not.toBeNull()
    })
  })

  describe('webhook secret rotation (SR-4)', () => {
    const configured = Boolean(accessCodeEncryptionKey())

    it.runIf(configured)('accepts BOTH secrets during the rotation window', async () => {
      const first = await rotateWebhookSecret(actor(), facilityId)
      if (!first.ok) throw new Error('expected rotation to succeed')

      const second = await rotateWebhookSecret(actor(), facilityId)
      if (!second.ok) throw new Error('expected rotation to succeed')

      const accepted = await acceptableSecrets(facilityId)
      // Without this a rotation drops every gate event sent while somebody is
      // pasting the new value into a vendor portal — and gate events are the
      // record of who came through the door.
      expect(accepted).toContain(second.secret)
      expect(accepted).toContain(first.secret)
      // Only ever one to sign with.
      expect(await signingSecret(facilityId)).toBe(second.secret)
    })

    it.runIf(configured)('stops accepting the old secret once its window closes', async () => {
      const first = await rotateWebhookSecret(actor(), facilityId)
      if (!first.ok) throw new Error('expected rotation to succeed')
      await rotateWebhookSecret(actor(), facilityId)

      const wellAfter = new Date(Date.now() + 48 * 60 * 60 * 1000)
      expect(await acceptableSecrets(facilityId, wellAfter)).not.toContain(first.secret)
    })

    it.runIf(configured)('keeps exactly one active secret per facility', async () => {
      await rotateWebhookSecret(actor(), facilityId)
      await rotateWebhookSecret(actor(), facilityId)
      await rotateWebhookSecret(actor(), facilityId)

      // The partial unique index is what enforces it; this proves the write
      // order in `rotateWebhookSecret` respects it rather than crashing.
      expect(await prisma.gateWebhookSecret.count({ where: { facilityId, active: true } })).toBe(1)
    })

    it.runIf(configured)('never stores the secret in the clear', async () => {
      const rotated = await rotateWebhookSecret(actor(), facilityId)
      if (!rotated.ok) throw new Error('expected rotation to succeed')

      const row = await prisma.gateWebhookSecret.findFirstOrThrow({
        where: { facilityId, active: true },
      })
      expect(row.secretRef).not.toContain(rotated.secret)
    })

    it.runIf(configured)('prunes a secret whose window has closed', async () => {
      await rotateWebhookSecret(actor(), facilityId)
      await rotateWebhookSecret(actor(), facilityId)

      await pruneRetiredSecrets(new Date(Date.now() + 48 * 60 * 60 * 1000))
      expect(await prisma.gateWebhookSecret.count({ where: { facilityId } })).toBe(1)
    })

    it.runIf(configured)('audits the rotation', async () => {
      await rotateWebhookSecret(actor(), facilityId)
      const entry = await prisma.auditLog.findFirst({
        where: { action: 'gate.webhook_secret_rotated', entityId: facilityId },
        orderBy: { occurredAt: 'desc' },
      })
      expect(entry).not.toBeNull()
    })

    it('refuses to rotate a facility the actor has no settings permission for', async () => {
      await expect(
        rotateWebhookSecret(actor([otherFacilityId]), facilityId),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('falls back to the shared secret at a facility nobody has rotated', async () => {
      // Rotation is opt-in per site: a facility nobody has touched behaves
      // exactly as it did before this feature existed.
      const status = await webhookSecretStatus(facilityId)
      expect(status.configured).toBe(false)
      expect((await acceptableSecrets(facilityId)).length).toBeGreaterThan(0)
    })
  })

  describe('camera links (FR-10)', () => {
    it('stores a label and an https address', async () => {
      await addCamera(actor(), {
        facilityId,
        label: 'Front gate',
        url: 'https://nvr.example.com/live/1',
      })
      const cameras = await facilityCameras(facilityId)
      expect(cameras).toHaveLength(1)
      expect(cameras[0].label).toBe('Front gate')
    })

    it('refuses http', () => {
      // An http viewer sends its login in the clear on a network shared with
      // the gate.
      expect(() => validateCameraUrl('http://nvr.example.com/live')).toThrow(InvalidCameraUrlError)
    })

    it('refuses a URL with credentials embedded in it', () => {
      // SR-1 forbids storing vendor passwords anywhere, and this is exactly
      // that with the password hidden in plain sight in a URL bar.
      expect(() => validateCameraUrl('https://admin:hunter2@nvr.example.com/live')).toThrow(
        /Remove the username and password/,
      )
    })

    it('refuses javascript: and other non-http schemes', () => {
      // A stored `javascript:` URL rendered as a link in the admin is stored
      // XSS with extra steps.
      expect(() => validateCameraUrl('javascript:alert(1)')).toThrow(InvalidCameraUrlError)
      expect(() => validateCameraUrl('data:text/html,<script>')).toThrow(InvalidCameraUrlError)
    })

    it('removes a link and audits the host, never the full URL', async () => {
      const camera = await addCamera(actor(), {
        facilityId,
        label: 'Corridor',
        url: 'https://nvr.example.com/live/secret-token-42',
      })
      await removeCamera(actor(), camera.id)

      expect(await facilityCameras(facilityId)).toHaveLength(0)
      const entry = await prisma.auditLog.findFirst({
        where: { action: 'gate.camera_link_changed', entityId: facilityId },
        orderBy: { occurredAt: 'desc' },
      })
      // A viewer path can carry a site or camera token, and the audit log is
      // read by more people than the settings screen.
      expect(JSON.stringify(entry?.after)).not.toContain('secret-token-42')
      expect(JSON.stringify(entry?.after)).toContain('nvr.example.com')
    })

    it('refuses a facility the actor cannot configure', async () => {
      await expect(
        addCamera(actor([otherFacilityId]), {
          facilityId,
          label: 'Nope',
          url: 'https://nvr.example.com/live',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe('health dashboard', () => {
    it('reports a site that has never been reconciled as a concern, not as healthy', async () => {
      const rows = await gateHealth(actor())
      const row = rows.find((candidate) => candidate.facilityId === facilityId)
      expect(row).toBeDefined()
      expect(row?.reconciliation).toBeNull()
    })

    it('carries the drift counts through once a run exists', async () => {
      await prisma.simulatedGateCode.create({
        data: { facilityId, credentialId, code: CODE, active: true },
      })
      await prisma.simulatedGateCode.create({
        data: { facilityId, credentialId: `ghost-h-${suffix}`, code: '565656', active: true },
      })
      await reconcileFacility(facilityId)

      const rows = await gateHealth(actor())
      const row = rows.find((candidate) => candidate.facilityId === facilityId)
      expect(row?.reconciliation?.driftCount).toBeGreaterThan(0)
      expect(row?.reconciliation?.permissiveCount).toBeGreaterThan(0)
    })

    it('shows only facilities the actor is assigned to', async () => {
      const rows = await gateHealth(actor())
      expect(rows.map((row) => row.facilityId)).toContain(facilityId)
      expect(rows.map((row) => row.facilityId)).not.toContain(otherFacilityId)
    })
  })
})
