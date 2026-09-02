import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import type { Actor } from '../apps/web/lib/rbac/actor'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-230 / PRD 02 §4.8 US-32, PRD 01 US-601.
//
// Card at the counter. The counter used to refuse a card outright — "Card
// payments go through the online payment screen — there is no card terminal
// here yet" — which is a deflection to email aimed at the tenant standing at
// the desk wanting their gate to reopen.
//
// What is under test is the DECISION half: which facility a charge is raised
// against, which surface it declares, whether it retains the card, and what
// happens when an off-session charge declines. The Stripe call itself is
// mocked, the same wall every other payment suite here hits — this project has
// no key outside production.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

type RecordedCharge = {
  reference: string
  amountCents: number
  facilityId: string
  tenantId: string
  leaseId?: string
  surface?: string
  saveMethod?: boolean
  offSession?: boolean
  paymentMethodId?: string
}

const charges: RecordedCharge[] = []
let declineNext = false

vi.mock('../apps/web/lib/payments/intents', () => ({
  createChargeIntent: vi.fn(async (input: RecordedCharge) => {
    charges.push(input)
    if (declineNext) throw new Error('Your card was declined.')
    const payment = await prisma.payment.create({
      data: {
        facilityId: input.facilityId,
        tenantId: input.tenantId,
        amountCents: input.amountCents,
        method: 'card',
        status: 'pending',
        stripePaymentIntentId: `pi_${randomUUID().slice(0, 12)}`,
      },
    })
    return {
      paymentId: payment.id,
      paymentIntentId: payment.stripePaymentIntentId!,
      clientSecret: 'cs_test',
      deduplicated: false,
    }
  }),
  createCustomerSession: vi.fn(async () => 'cuss_test'),
}))

// Stripe must read as configured or every one of these is an honest no-op.
vi.mock('../apps/web/lib/payments/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/lib/payments/stripe')>()
  return { ...actual, paymentsEnabled: () => true, stripeClient: () => ({}) as never }
})

const { chargeableLease, chargeCardOnFile, startCounterCardPayment } = await import(
  '../apps/web/lib/admin/pos'
)

let facilityId = ''
let otherFacilityId = ''
let tenantId = ''
let leaseId = ''
let staffUserId = ''

function actorAt(facility: string): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId: facility,
        roleKey: 'counter',
        rank: 10,
        permissions: new Set<PermissionKey>(['tenants:view', 'payments:take']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

describeDb('card at the counter', () => {
  beforeAll(async () => {
    const [facility, other] = await Promise.all([
      prisma.facility.create({
        data: {
          name: `Counter Card ${suffix}`,
          slug: `counter-card-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      }),
      prisma.facility.create({
        data: {
          name: `Counter Card Other ${suffix}`,
          slug: `counter-card-other-${suffix}`,
          addressLine1: '2 Storage Way',
          city: 'Dallas',
          state: 'TX',
          postalCode: '75201',
          timezone: 'America/Chicago',
        },
      }),
    ])
    facilityId = facility.id
    otherFacilityId = other.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `CC-${suffix}` },
    })
    const tenant = await prisma.tenant.create({
      data: { email: `cc-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-08-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
    // A balance to charge: one month's rent, unpaid.
    await prisma.ledgerEntry.create({
      data: { facilityId, leaseId, type: 'charge', amountCents: 12_900, description: 'Rent' },
    })

    const staff = await prisma.staffUser.create({
      data: { email: `cc-staff-${suffix}@example.com`, firstName: 'Cass', lastName: 'Counter' },
    })
    staffUserId = staff.id
  })

  afterEach(async () => {
    charges.length = 0
    declineNext = false
    await prisma.payment.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    // The facility and the staff user stay: `chargeCardOnFile` writes an
    // `audit_log` row, which RESTRICTs both and refuses its own DELETE (B-185).
    await prisma.$disconnect()
  })

  describe('chargeableLease', () => {
    it('takes the facility from the lease, not from the admin facility switcher', async () => {
      // The tenant profile lists leases across every facility a staffer can
      // see, and links here. A charge raised against whatever the switcher
      // happens to be on would be money posted to the wrong deposit.
      const lease = await chargeableLease(actorAt(facilityId), leaseId)
      expect(lease?.facilityId).toBe(facilityId)
      expect(lease?.balanceCents).toBe(12_900)
      expect(lease?.unitNumber).toBe(`CC-${suffix}`)
    })

    it('refuses a staffer with no reach into the lease’s facility', async () => {
      await expect(chargeableLease(actorAt(otherFacilityId), leaseId)).rejects.toThrow(
        ForbiddenError,
      )
    })

    it('returns null for a lease that does not exist rather than throwing', async () => {
      expect(await chargeableLease(actorAt(facilityId), 'no-such-lease')).toBeNull()
    })
  })

  describe('a card the tenant is holding', () => {
    it('declares the counter surface and does not retain the card', async () => {
      const lease = await chargeableLease(actorAt(facilityId), leaseId)
      if (!lease) throw new Error('unreachable')

      const setup = await startCounterCardPayment(actorAt(facilityId), lease, 12_900)
      expect(setup.available).toBe(true)

      expect(charges).toHaveLength(1)
      // Card and Link only — no bank debit at a desk (see `methodsFor`).
      expect(charges[0].surface).toBe('counter')
      // The tenant handed over a card to settle a balance, not to enrol in
      // anything. Retaining it because it passed through a staff-operated
      // screen would be consent nobody gave.
      expect(charges[0].saveMethod).toBe(false)
      // Named, so the webhook posts to the right unit rather than guessing
      // from tenant + facility (B-035).
      expect(charges[0].leaseId).toBe(leaseId)
    })

    it('keys the charge to the balance it was chosen against, in its own namespace', async () => {
      // Reloading the counter screen must return the intent already raised
      // rather than a second one — and a tenant paying the same figure online
      // and at the desk inside Stripe's 24-hour window must not be
      // deduplicated into one payment, which is what a shared `portal:` key
      // would do.
      const lease = await chargeableLease(actorAt(facilityId), leaseId)
      if (!lease) throw new Error('unreachable')
      await startCounterCardPayment(actorAt(facilityId), lease, 12_900)
      expect(charges[0].reference).toBe(`counter:${leaseId}:12900:12900`)
    })

    it('refuses a staffer with no reach into the facility', async () => {
      const lease = await chargeableLease(actorAt(facilityId), leaseId)
      if (!lease) throw new Error('unreachable')
      await expect(
        startCounterCardPayment(actorAt(otherFacilityId), lease, 12_900),
      ).rejects.toThrow(ForbiddenError)
      expect(charges).toHaveLength(0)
    })
  })

  describe('the card on file', () => {
    it('says so rather than charging nothing when the tenant has no saved card', async () => {
      const lease = await chargeableLease(actorAt(facilityId), leaseId)
      if (!lease) throw new Error('unreachable')
      const result = await chargeCardOnFile(actorAt(facilityId), lease, 12_900)
      expect(result).toEqual({ ok: false, problem: 'no_method' })
      expect(charges).toHaveLength(0)
    })

    it('charges the stored method off-session and logs who did it', async () => {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { stripeDefaultPaymentMethodId: 'pm_test_counter' },
      })
      try {
        const lease = await chargeableLease(actorAt(facilityId), leaseId)
        if (!lease) throw new Error('unreachable')
        const result = await chargeCardOnFile(actorAt(facilityId), lease, 12_900)
        expect(result.ok).toBe(true)

        expect(charges[0].offSession).toBe(true)
        // The tenant's chosen method, stated explicitly rather than left to
        // Stripe's own customer default — the two can disagree, and the tenant
        // chose ours (B-036).
        expect(charges[0].paymentMethodId).toBe('pm_test_counter')

        // The audit row is the whole point: a charge nobody was standing in
        // front of, made by a named person on a stored card.
        const audit = await prisma.auditLog.findFirst({
          where: { facilityId, action: 'payment.card_on_file_charged' },
          orderBy: { occurredAt: 'desc' },
        })
        expect(audit?.actorStaffId).toBe(staffUserId)
      } finally {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { stripeDefaultPaymentMethodId: null },
        })
      }
    })

    it('reports a decline instead of waiting for a webhook that is not coming', async () => {
      // An off-session charge declines SYNCHRONOUSLY — Stripe throws, and no
      // `payment_intent.payment_failed` follows, because the confirmation
      // happened inside the request. A caller that assumed otherwise would
      // leave a staffer looking at a screen that said nothing.
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { stripeDefaultPaymentMethodId: 'pm_test_counter' },
      })
      declineNext = true
      try {
        const lease = await chargeableLease(actorAt(facilityId), leaseId)
        if (!lease) throw new Error('unreachable')
        const result = await chargeCardOnFile(actorAt(facilityId), lease, 12_900)
        expect(result.ok).toBe(false)
        if (result.ok) throw new Error('unreachable')
        expect(result.problem).toBe('declined')
        expect(result.message).toContain('declined')
      } finally {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { stripeDefaultPaymentMethodId: null },
        })
      }
    })

    it('refuses a staffer with no reach into the facility', async () => {
      const lease = await chargeableLease(actorAt(facilityId), leaseId)
      if (!lease) throw new Error('unreachable')
      await expect(chargeCardOnFile(actorAt(otherFacilityId), lease, 12_900)).rejects.toThrow(
        ForbiddenError,
      )
    })
  })
})
