import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Prisma, prisma } from '../packages/db'
import {
  enrollMobileKey,
  mobileKeysForTenant,
  revokeMobileKey,
  unlockWithMobileKey,
} from '../apps/web/lib/access/mobile-key'
import { drainGateCommands, ensureGrant, transitionGrant } from '../apps/web/lib/access/service'
import { codeForLease, provisionAccessForLease } from '../apps/web/lib/access/provision'
import { setSimulatorConfig } from '../apps/web/lib/access/simulator'
import { propagateGateHours } from '../apps/web/lib/access/time-windows'
import { DAYS_OF_WEEK } from '@storage/core/facility-settings'
import type { Actor } from '../apps/web/lib/rbac/actor'

// PRD 03 US-8 AC1/AC4, OQ-2 (B-086 part 2, D-121). Phone unlock.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''

const tenantActor = (): Extract<Actor, { kind: 'tenant' }> => ({ kind: 'tenant', tenantId })

describeDb('phone unlock', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Mobile Key Test',
        slug: `mobile-key-${suffix}`,
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
      data: { email: `mobile-key-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
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
    await prisma.accessEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedVendorEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.gateSimulatorConfig.deleteMany({ where: { facilityId } })
    await prisma.gateWebhookSecret.deleteMany({ where: { facilityId } })
    // `Prisma.DbNull`, not `undefined` — `undefined` means "leave this column
    // alone", so the gate hours one test sets would leak into every test after
    // it and deny an unlock for being outside them, depending on the hour the
    // suite happens to run at.
    await prisma.facility.update({ where: { id: facilityId }, data: { gateHours: Prisma.DbNull } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.accessEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedVendorEvent.deleteMany({ where: { facilityId } })
    await prisma.simulatedGateCode.deleteMany({ where: { facilityId } })
    await prisma.gateCommand.deleteMany({ where: { facilityId } })
    await prisma.accessCredential.deleteMany({ where: { facilityId } })
    await prisma.accessGrant.deleteMany({ where: { facilityId } })
    await prisma.gateSimulatorConfig.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  it('opens the gate and records the attempt as a phone unlock', async () => {
    await provisionAccessForLease(leaseId)
    const enrolled = await enrollMobileKey(tenantActor(), facilityId)
    expect(enrolled.ok).toBe(true)

    const outcome = await unlockWithMobileKey(tenantId, facilityId)
    expect(outcome.opened).toBe(true)

    // The unlock is a real gate attempt through the signed webhook path, not a
    // separate "app opened it" side channel — AC3 attributes it to the
    // credential, which is what makes "Phone" renderable in the log at all.
    const event = await prisma.accessEvent.findFirstOrThrow({
      where: { facilityId },
      include: { credential: { select: { type: true } } },
    })
    expect(event.result).toBe('granted')
    expect(event.credential?.type).toBe('mobile_key')
  })

  it('leaves the tenant PIN alone when the phone is switched off', async () => {
    const provisioned = await provisionAccessForLease(leaseId)
    const pin = provisioned.ok && 'code' in provisioned ? provisioned.code : ''
    expect(pin).toMatch(/^\d{6}$/)

    await enrollMobileKey(tenantActor(), facilityId)
    expect(await revokeMobileKey(tenantActor(), facilityId)).toEqual({ ok: true })

    // The point of a credential-scoped revoke. "I lost my phone" must not send
    // the tenant to the office for a new gate code.
    expect(await codeForLease(leaseId)).toBe(pin)
    const unlock = await unlockWithMobileKey(tenantId, facilityId)
    expect(unlock.opened).toBe(false)

    // And the controller was actually told, rather than the row merely being
    // hidden from our own reads — a keypad decides from what it was last sent.
    const revoked = await prisma.accessCredential.findFirstOrThrow({
      where: { facilityId, type: 'mobile_key' },
    })
    const onController = await prisma.simulatedGateCode.findUnique({
      where: { credentialId: revoked.id },
    })
    expect(onController?.active).toBe(false)
  })

  it('never renders the mobile key as the tenant gate code', async () => {
    const provisioned = await provisionAccessForLease(leaseId)
    const pin = provisioned.ok && 'code' in provisioned ? provisioned.code : ''

    // The mobile key is the NEWER active credential on the same grant, so an
    // unfiltered `orderBy createdAt desc` hands the portal a 43-character token
    // and calls it a gate code.
    await enrollMobileKey(tenantActor(), facilityId)
    expect(await codeForLease(leaseId)).toBe(pin)

    // Same trap on the other side: a second move-in must still mint a PIN.
    const second = await provisionAccessForLease(leaseId)
    expect(second).toMatchObject({ ok: true, alreadyProvisioned: true })
  })

  it('inherits the gate hours the grant was already on', async () => {
    // The defect this exists for: `set_time_window`'s idempotency key is a
    // digest of the schedule, so pushing an unchanged schedule to a grant that
    // already has one is correctly deduped — and a credential enrolled after
    // that used to land on the controller with no window at all, which the
    // controller reads as unrestricted. That is `extendedHours`, the add-on the
    // facility sells (D-100), obtained by tapping a portal button.
    await prisma.facility.update({
      where: { id: facilityId },
      data: {
        gateHours: Object.fromEntries(
          DAYS_OF_WEEK.map((day) => [day, { closed: false, open: '06:00', close: '22:00' }]),
        ),
      },
    })
    await provisionAccessForLease(leaseId)
    await propagateGateHours(facilityId)
    await drainGateCommands(new Date(), facilityId)

    await enrollMobileKey(tenantActor(), facilityId)

    const key = await prisma.accessCredential.findFirstOrThrow({
      where: { facilityId, type: 'mobile_key' },
    })
    const onController = await prisma.simulatedGateCode.findUniqueOrThrow({
      where: { credentialId: key.id },
    })
    expect(onController.windowSchedule).not.toBeNull()
    expect(onController.windowExempt).toBe(false)
  })

  it('does not fail the tenant when the event cannot be reported home', async () => {
    // The gate's DECISION and reporting it home are different facts, and
    // delivery used to throw. The caller that made that matter is new: a
    // signing secret we cannot read — a rotated row that outlived its
    // encryption key, or an unset `HARDWARE_WEBHOOK_SECRET` under
    // `NODE_ENV=production`, which is what the e2e suite serves — became a 500
    // on the TENANT'S unlock button, on the one screen whose subject is
    // somebody standing at a gate.
    await provisionAccessForLease(leaseId)
    await enrollMobileKey(tenantActor(), facilityId)

    // An active secret nothing can decrypt, which is what `signingSecret`
    // returns null for. Preferred over deleting the env var because vitest
    // will not let `NODE_ENV` be redefined, and because a rotated-then-lost
    // key is the failure a real deployment actually has.
    await prisma.gateWebhookSecret.create({
      data: { facilityId, secretRef: 'enc:not:a:real:ciphertext', active: true },
    })
    try {
      const outcome = await unlockWithMobileKey(tenantId, facilityId)
      expect(outcome.opened).toBe(true)
      // Undelivered, not lost: the backlog holds it for a replay.
      expect(
        await prisma.simulatedVendorEvent.count({ where: { facilityId, delivered: false } }),
      ).toBeGreaterThan(0)
    } finally {
      await prisma.gateWebhookSecret.deleteMany({ where: { facilityId } })
    }
  })

  it('refuses to open a gate it cannot reach', async () => {
    await provisionAccessForLease(leaseId)
    await enrollMobileKey(tenantActor(), facilityId)

    // A keypad is standalone and keeps working offline. A remote unlock IS the
    // network, and saying "the gate is opening" when nothing was sent is the
    // one dishonesty a server-side transport (D-121) must not commit.
    await setSimulatorConfig(facilityId, { offline: true, latencyMs: 0, webhookFailing: false })
    const outcome = await unlockWithMobileKey(tenantId, facilityId)
    expect(outcome.opened).toBe(false)
    expect(outcome.message).toContain('512-555-0100')
  })

  it('will not open the gate for a suspended tenant', async () => {
    await provisionAccessForLease(leaseId)
    await enrollMobileKey(tenantActor(), facilityId)

    const grant = await ensureGrant(facilityId, tenantId, 'system:move_in')
    await transitionGrant(grant.grantId, 'suspended', 'system:delinquency')
    await drainGateCommands(new Date(), facilityId)

    const outcome = await unlockWithMobileKey(tenantId, facilityId)
    expect(outcome.opened).toBe(false)
    expect((await mobileKeysForTenant(tenantId))[0]).toMatchObject({ suspended: true })
  })

  it('is not offered where the secret could never be read back', async () => {
    // A PIN degrades honestly with no encryption key — the controller has the
    // digits and the tenant was told them once. A mobile key is read back on
    // every unlock, so enrolling here would mint a credential that can never
    // open anything, and the tenant would find out in a car park.
    const original = process.env.ACCESS_CODE_ENCRYPTION_KEY
    delete process.env.ACCESS_CODE_ENCRYPTION_KEY
    try {
      await provisionAccessForLease(leaseId)
      expect((await mobileKeysForTenant(tenantId))[0].unavailableReason).toBeTruthy()
      expect(await enrollMobileKey(tenantActor(), facilityId)).toMatchObject({ ok: false })
      expect(await prisma.accessCredential.count({ where: { facilityId, type: 'mobile_key' } })).toBe(0)
    } finally {
      process.env.ACCESS_CODE_ENCRYPTION_KEY = original
    }
  })

  it('is not offered at a site whose keypad is driven by a person', async () => {
    await provisionAccessForLease(leaseId)
    await prisma.facility.update({ where: { id: facilityId }, data: { gateAdapter: 'manual' } })
    try {
      expect((await mobileKeysForTenant(tenantId))[0].unavailableReason).toBeTruthy()
      const result = await enrollMobileKey(tenantActor(), facilityId)
      expect(result.ok).toBe(false)
    } finally {
      await prisma.facility.update({ where: { id: facilityId }, data: { gateAdapter: 'simulated' } })
    }
  })

  it('gives one key back to a tenant who taps twice', async () => {
    await provisionAccessForLease(leaseId)
    const first = await enrollMobileKey(tenantActor(), facilityId)
    const second = await enrollMobileKey(tenantActor(), facilityId)
    expect(second).toEqual(first)
    // Two live keys on one grant is two things to revoke when one phone is lost.
    expect(
      await prisma.accessCredential.count({ where: { facilityId, type: 'mobile_key', state: 'active' } }),
    ).toBe(1)
  })
})
