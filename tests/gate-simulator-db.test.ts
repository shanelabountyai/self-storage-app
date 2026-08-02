import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { drainGateCommands, ensureGrant, issueCredential, transitionGrant } from '../apps/web/lib/access/service'
import {
  evaluateKeypadEntry,
  replayVendorEventBacklog,
  setSimulatorConfig,
  simulatorConfigFor,
} from '../apps/web/lib/access/simulator'
import { applyHardwareWebhookEvent } from '../apps/web/lib/access/webhook-handler'

// B-028 / PRD 03 US-7. The virtual keypad, end to end: a real credential
// issued through B-027's service, a real code entered against the mock
// vendor's own state, and a real signed webhook creating the AccessEvent.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''

describeDb('mock gate controller', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Simulator Test',
        slug: `sim-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const tenant = await prisma.tenant.create({
      data: { email: `sim-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
  })

  beforeEach(async () => {
    await prisma.gateSimulatorConfig.deleteMany({ where: { facilityId } })
    await prisma.simulatedVendorEvent.deleteMany({ where: { facilityId } })
    await prisma.accessEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.gateSimulatorConfig.deleteMany({ where: { facilityId } })
    await prisma.simulatedVendorEvent.deleteMany({ where: { facilityId } })
    await prisma.accessEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  async function issueRealCode() {
    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    await transitionGrant(grant.grantId, 'active', 'system:move_in')
    const issued = await issueCredential(grant.grantId, null)
    await drainGateCommands(new Date(), facilityId)
    return { grantId: grant.grantId, credentialId: issued.credentialId, code: issued.code }
  }

  it('grants a real code issued through the access service', async () => {
    const { code, credentialId } = await issueRealCode()
    const outcome = await evaluateKeypadEntry(facilityId, code)

    expect(outcome).toMatchObject({ result: 'granted', reason: 'ok', delivered: true })

    // AC2: a real AccessEvent, through the webhook path — not a return value
    // the keypad invented locally.
    const event = await prisma.accessEvent.findUniqueOrThrow({
      where: { vendorEventId: outcome.vendorEventId },
    })
    expect(event.result).toBe('granted')
    expect(event.credentialId).toBe(credentialId)
  })

  it('denies a code nobody has, and still logs the attempt', async () => {
    const outcome = await evaluateKeypadEntry(facilityId, '000000')
    expect(outcome).toMatchObject({ result: 'denied', reason: 'unknown_code' })

    // FR-4: unknown-code retention. A stranger trying codes at a gate is
    // exactly the pattern a later anomaly flag reads — it must not be
    // discarded just because nothing matched.
    const event = await prisma.accessEvent.findUniqueOrThrow({
      where: { vendorEventId: outcome.vendorEventId },
    })
    expect(event.result).toBe('denied')
    expect(event.credentialId).toBeNull()
  })

  it('denies a code that was issued but has since been revoked', async () => {
    const { grantId, code } = await issueRealCode()
    await transitionGrant(grantId, 'revoked', 'staff:test')
    await drainGateCommands(new Date(), facilityId)

    const outcome = await evaluateKeypadEntry(facilityId, code)
    // Distinct from unknown_code: the vendor recognises the code, it is just
    // switched off — the reason a real gate log needs to tell those apart.
    expect(outcome).toMatchObject({ result: 'denied', reason: 'inactive' })
  })

  it('reactivates a code when a suspended grant resumes', async () => {
    const { grantId, code } = await issueRealCode()
    await transitionGrant(grantId, 'suspended', 'system:delinquency')
    await drainGateCommands(new Date(), facilityId)
    expect((await evaluateKeypadEntry(facilityId, code)).result).toBe('denied')

    await transitionGrant(grantId, 'active', 'system:delinquency_cleared')
    await drainGateCommands(new Date(), facilityId)
    expect((await evaluateKeypadEntry(facilityId, code)).result).toBe('granted')
  })

  it('stores the code only at the mock vendor, never on our own credential row', async () => {
    // SR-2, re-verified at the simulator boundary: the plaintext must not have
    // leaked into AccessCredential just because a "vendor" now exists to hold it.
    const { code, credentialId } = await issueRealCode()
    const credential = await prisma.accessCredential.findUniqueOrThrow({ where: { id: credentialId } })
    expect(JSON.stringify(credential)).not.toContain(code)
  })

  describe('fault injection', () => {
    it('offline: the gate still decides locally, but the event is not delivered', async () => {
      // A real standalone keypad does not stop working because the network is
      // down — only reporting the event home fails.
      const { code } = await issueRealCode()
      await setSimulatorConfig(facilityId, { offline: true, latencyMs: 0, webhookFailing: false })

      const outcome = await evaluateKeypadEntry(facilityId, code)
      expect(outcome).toMatchObject({ result: 'granted', delivered: false })
      expect(await prisma.accessEvent.count({ where: { facilityId } })).toBe(0)
      expect(
        await prisma.simulatedVendorEvent.count({ where: { facilityId, delivered: false } }),
      ).toBe(1)
    })

    it('webhook failing: same distinction as offline, toggled independently', async () => {
      const { code } = await issueRealCode()
      await setSimulatorConfig(facilityId, { offline: false, latencyMs: 0, webhookFailing: true })

      const outcome = await evaluateKeypadEntry(facilityId, code)
      expect(outcome.delivered).toBe(false)
      expect(await prisma.accessEvent.count({ where: { facilityId } })).toBe(0)
    })

    it('replay delivers everything the backlog was owed', async () => {
      const { code } = await issueRealCode()
      await setSimulatorConfig(facilityId, { offline: false, latencyMs: 0, webhookFailing: true })
      await evaluateKeypadEntry(facilityId, code)
      await evaluateKeypadEntry(facilityId, '999999') // an unknown-code denial too
      expect(await prisma.accessEvent.count({ where: { facilityId } })).toBe(0)

      // Replay is an explicit action and tries regardless of the toggle still
      // being on — the point of pressing the button is "attempt it now".
      const result = await replayVendorEventBacklog(facilityId)
      expect(result.delivered).toBe(2)
      expect(await prisma.accessEvent.count({ where: { facilityId } })).toBe(2)
      expect(
        await prisma.simulatedVendorEvent.count({ where: { facilityId, delivered: false } }),
      ).toBe(0)
    })

    it('latency adds real delay without changing the outcome', async () => {
      const { code } = await issueRealCode()
      await setSimulatorConfig(facilityId, { offline: false, latencyMs: 150, webhookFailing: false })

      const start = Date.now()
      const outcome = await evaluateKeypadEntry(facilityId, code)
      expect(Date.now() - start).toBeGreaterThanOrEqual(140)
      expect(outcome).toMatchObject({ result: 'granted', delivered: true })
    })

    it('defaults to no faults for a facility that has never configured any', async () => {
      expect(await simulatorConfigFor(facilityId)).toEqual({
        offline: false,
        latencyMs: 0,
        webhookFailing: false,
      })
    })
  })

  it('is idempotent when the same vendor event is applied twice', async () => {
    // Redelivering an already-applied event (a retried webhook, a second
    // replay) must not double-log the gate open.
    const payload = {
      facilityId,
      vendorEventId: `evt_${suffix}`,
      credentialId: null,
      result: 'granted' as const,
      reason: 'ok',
      occurredAt: new Date().toISOString(),
    }
    await applyHardwareWebhookEvent(payload)
    await applyHardwareWebhookEvent(payload)
    expect(await prisma.accessEvent.count({ where: { vendorEventId: payload.vendorEventId } })).toBe(1)
  })
})
