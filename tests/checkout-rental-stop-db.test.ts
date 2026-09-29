import { randomInt, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  overrideRentalStops,
  rentalStopsFor,
  rentalStopsOverridden,
} from '../apps/web/lib/checkout/details'
import { sessionByToken, startCheckout } from '../apps/web/lib/checkout/session'
import { setTenantDoNotRent } from '../apps/web/lib/admin/tenants'
import { submitDetailsAction } from '../apps/web/app/(public)/checkout/actions'
import { LOCALES, dictionaryFor, translate } from '../apps/web/lib/i18n'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-415 / PRD 02 US-32 "money owed elsewhere is seen before the keys".

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

// Every match key is unique to this run. Twenty suites share "Ada Renter",
// 512-555-0100 and 78704, and a stop that fired on THEIR rows would be a
// fixture collision, not the rule.
const LAST_NAME = `Stop${suffix}`
const PHONE_DIGITS = `737${String(randomInt(0, 10_000_000)).padStart(7, '0')}`
const PHONE_STORED = `(${PHONE_DIGITS.slice(0, 3)}) ${PHONE_DIGITS.slice(3, 6)}-${PHONE_DIGITS.slice(6)}`
const EMAIL = `stop-owes-${suffix}@example.com`
const OWED_CENTS = 12_345
const FLAG_REASON = `Threatened staff ${suffix}`

const NOBODY = {
  email: `stop-nobody-${suffix}@example.com`,
  phone: '737-000-0000',
  lastName: `Nobody${suffix}`,
  postalCode: '75201',
}

let leftFacilityId = ''
let rentingFacilityId = ''
let unitTypeId = ''
let owingTenantId = ''
let paidTenantId = ''
let flaggedTenantId = ''
let counterStaffId = ''
let managerStaffId = ''

function staffActor(staffUserId: string, rank: number, facilityId: string): Actor {
  return {
    kind: 'staff',
    staffUserId,
    assignments: [
      {
        facilityId,
        roleKey: rank >= 20 ? 'manager' : 'counter',
        rank,
        permissions: new Set<PermissionKey>(['tenants:view', 'tenants:edit', 'leases:move_in']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

// See `checkout-consent-db.test.ts`: `revalidatePath` needs a real request.
async function callAction<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof Error && error.message.includes('static generation store')) return undefined
    throw error
  }
}

function detailsForm(token: string, overrides: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.set('token', token)
  form.set('firstName', 'Nora')
  form.set('lastName', NOBODY.lastName)
  form.set('email', `stop-renting-${randomUUID()}@example.com`)
  form.set('phone', NOBODY.phone)
  form.set('addressLine1', '2400 South Congress Ave')
  form.set('postalCode', '78704')
  for (const [key, value] of Object.entries(overrides)) form.set(key, value)
  return form
}

async function endedLease(tenantId: string, number: string, balanceCents: number) {
  const unit = await prisma.unit.create({
    data: { facilityId: leftFacilityId, unitTypeId: leftUnitTypeId, number },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId: leftFacilityId,
      tenantId,
      unitId: unit.id,
      status: 'ended',
      startDate: new Date('2026-01-01'),
      moveOutDate: new Date('2026-06-30'),
      monthlyRateCents: 12_900,
      billingDay: 1,
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId: leftFacilityId,
      leaseId: lease.id,
      type: 'charge',
      amountCents: OWED_CENTS,
      description: 'Rent',
    },
  })
  if (balanceCents === 0) {
    await prisma.ledgerEntry.create({
      data: {
        facilityId: leftFacilityId,
        leaseId: lease.id,
        type: 'payment',
        amountCents: -OWED_CENTS,
        description: 'Payment',
      },
    })
  }
}

let leftUnitTypeId = ''

describeDb('rental stops (B-415)', () => {
  beforeAll(async () => {
    const [left, renting] = await Promise.all([
      prisma.facility.create({
        data: {
          name: `Stop Left ${suffix}`,
          slug: `stop-left-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      }),
      prisma.facility.create({
        data: {
          name: `Stop Renting ${suffix}`,
          slug: `stop-renting-${suffix}`,
          addressLine1: '2 Storage Way',
          city: 'Dallas',
          state: 'TX',
          postalCode: '75201',
          timezone: 'America/Chicago',
          phone: '(214) 555-0199',
        },
      }),
    ])
    leftFacilityId = left.id
    rentingFacilityId = renting.id

    leftUnitTypeId = (
      await prisma.unitType.create({
        data: { facilityId: leftFacilityId, name: `5x5 ${suffix}`, widthFt: 5, lengthFt: 5 },
      })
    ).id
    unitTypeId = (
      await prisma.unitType.create({
        data: { facilityId: rentingFacilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
      })
    ).id
    for (let i = 0; i < 6; i++) {
      await prisma.unit.create({
        data: { facilityId: rentingFacilityId, unitTypeId, number: `R-${i}-${suffix}` },
      })
    }

    const [counter, manager, owing, paid, flagged] = await Promise.all([
      prisma.staffUser.create({
        data: { email: `stop-counter-${suffix}@example.com`, firstName: 'Cal', lastName: 'Counter' },
      }),
      prisma.staffUser.create({
        data: { email: `stop-manager-${suffix}@example.com`, firstName: 'Mel', lastName: 'Manager' },
      }),
      prisma.tenant.create({
        data: {
          email: EMAIL,
          firstName: 'Owen',
          lastName: LAST_NAME,
          phone: PHONE_STORED,
          postalCode: '78704-1234',
        },
      }),
      prisma.tenant.create({
        data: { email: `stop-paid-${suffix}@example.com`, firstName: 'Pia', lastName: `Paid${suffix}` },
      }),
      prisma.tenant.create({
        data: { email: `stop-flagged-${suffix}@example.com`, firstName: 'Flo', lastName: `Flag${suffix}` },
      }),
    ])
    counterStaffId = counter.id
    managerStaffId = manager.id
    owingTenantId = owing.id
    paidTenantId = paid.id
    flaggedTenantId = flagged.id

    await endedLease(owingTenantId, `L-1-${suffix}`, OWED_CENTS)
    await endedLease(paidTenantId, `L-2-${suffix}`, 0)
    // The flag's own access check reads the tenant's leases.
    await endedLease(flaggedTenantId, `L-3-${suffix}`, 0)
  })

  afterAll(async () => {
    if (!hasDatabase) return
    // The facilities stay: `audit_log` RESTRICTs against them (B-185).
    const ids = [leftFacilityId, rentingFacilityId]
    await prisma.checkoutSession.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.lease.deleteMany({ where: { facilityId: { in: ids } } })
    await prisma.consent.deleteMany({ where: { tenant: { email: { startsWith: 'stop-' } } } })
    await prisma.tenant.deleteMany({
      where: { email: { startsWith: 'stop-', endsWith: '@example.com' } },
    })
    await prisma.$disconnect()
  })

  async function start(acquisitionSource?: 'walk_in') {
    const started = await startCheckout({
      facilityId: rentingFacilityId,
      unitTypeId,
      quotedRateCents: 12_900,
      ...(acquisitionSource ? { acquisitionSource } : {}),
    })
    if (!started.ok) throw new Error('unreachable')
    return started
  }

  describe('the match', () => {
    const owed = [{ facilityName: `Stop Left ${suffix}`, balanceCents: OWED_CENTS }]

    it('matches on email alone, whatever its case', async () => {
      const stops = await rentalStopsFor({ ...NOBODY, email: EMAIL.toUpperCase() })
      expect(stops).toEqual([
        { tenantId: owingTenantId, name: `Owen ${LAST_NAME}`, doNotRentReason: null, owed },
      ])
    })

    it('matches on phone alone, however either side typed it', async () => {
      for (const phone of [PHONE_DIGITS, `+1 ${PHONE_DIGITS}`, PHONE_DIGITS.replace(/(\d{3})(\d{3})/, '$1.$2.')]) {
        const stops = await rentalStopsFor({ ...NOBODY, phone })
        expect(stops.map((stop) => stop.tenantId)).toEqual([owingTenantId])
      }
    })

    it('matches on last name plus postal code, across case and ZIP+4', async () => {
      const stops = await rentalStopsFor({
        ...NOBODY,
        lastName: LAST_NAME.toUpperCase(),
        postalCode: '78704',
      })
      expect(stops.map((stop) => stop.tenantId)).toEqual([owingTenantId])
    })

    it('does not match on last name alone, or postal code alone', async () => {
      expect(await rentalStopsFor({ ...NOBODY, lastName: LAST_NAME })).toEqual([])
      // 78704 is every other suite's zip too, so this asserts on OUR tenant.
      const byZip = await rentalStopsFor({ ...NOBODY, postalCode: '78704' })
      expect(byZip.map((stop) => stop.tenantId)).not.toContain(owingTenantId)
    })

    it('matches nothing on blank keys', async () => {
      expect(await rentalStopsFor({ email: '', phone: '', lastName: '', postalCode: '' })).toEqual([])
    })

    it('lets a returning tenant through when the ended lease was paid', async () => {
      expect(await rentalStopsFor({ ...NOBODY, email: `stop-paid-${suffix}@example.com` })).toEqual([])
    })
  })

  describe('the do-not-rent flag', () => {
    const editor = () => staffActor(counterStaffId, 10, leftFacilityId)
    const flaggedKeys = { ...NOBODY, email: `stop-flagged-${suffix}@example.com` }

    it('refuses to set or clear without a reason, and writes nothing', async () => {
      expect(await setTenantDoNotRent(editor(), flaggedTenantId, true, '  ')).toEqual({
        ok: false,
        problem: 'reason_required',
      })
      expect(await rentalStopsFor(flaggedKeys)).toEqual([])
    })

    it('stops a flagged tenant who owes nothing, and is audited both ways', async () => {
      expect(await setTenantDoNotRent(editor(), flaggedTenantId, true, FLAG_REASON)).toEqual({ ok: true })
      const stops = await rentalStopsFor(flaggedKeys)
      expect(stops).toEqual([
        { tenantId: flaggedTenantId, name: `Flo Flag${suffix}`, doNotRentReason: FLAG_REASON, owed: [] },
      ])

      expect(await setTenantDoNotRent(editor(), flaggedTenantId, false, 'Settled with the owner')).toEqual({
        ok: true,
      })
      expect(await rentalStopsFor(flaggedKeys)).toEqual([])

      const rows = await prisma.auditLog.findMany({
        where: { entityType: 'Tenant', entityId: flaggedTenantId },
        orderBy: { occurredAt: 'asc' },
        select: { action: true, reasonCode: true, actorStaffId: true },
      })
      expect(rows).toEqual([
        { action: 'tenant.do_not_rent_set', reasonCode: FLAG_REASON, actorStaffId: counterStaffId },
        {
          action: 'tenant.do_not_rent_cleared',
          reasonCode: 'Settled with the owner',
          actorStaffId: counterStaffId,
        },
      ])
    })
  })

  describe('online', () => {
    it('stops at call-the-office, says nothing of why, and creates nothing', async () => {
      const started = await start()
      const email = `stop-renting-${randomUUID()}@example.com`
      const state = await callAction(() =>
        submitDetailsAction({} as never, detailsForm(started.token, { email, phone: PHONE_DIGITS })),
      )

      expect(state).toEqual({
        status: 'error',
        message: 'Please call the office at (214) 555-0199 to finish renting.',
        fieldErrors: {},
      })

      expect(await prisma.tenant.count({ where: { email } })).toBe(0)
      expect(await prisma.lease.count({ where: { facilityId: rentingFacilityId } })).toBe(0)
      const session = await sessionByToken(started.token)
      expect(session?.step).toBe('details')
      expect(session?.tenantId).toBeNull()
    })

    it('a counter session is stopped the same way until a manager overrides it', async () => {
      const started = await start('walk_in')
      const state = await callAction(() =>
        submitDetailsAction({} as never, detailsForm(started.token, { email: EMAIL })),
      )
      expect(state?.status).toBe('error')
      expect((await sessionByToken(started.token))?.step).toBe('details')
    })

    // The copy itself, in both languages: a sentence that names the reason
    // cannot be fixed by the action that renders it.
    it.each(LOCALES)('the %s message carries no balance and no reason', (locale) => {
      const message = translate(dictionaryFor(locale), 'details.callOffice', { phone: '(214) 555-0199' })
      expect(message).toContain('(214) 555-0199')
      expect(message).not.toMatch(/\$|owe|balance|debe|saldo|adeud|flag|rent to/i)
    })
  })

  describe('the counter override', () => {
    it('takes a manager and a reason, and writes ONE audit row', async () => {
      const started = await start('walk_in')
      const session = (await sessionByToken(started.token))!
      const stops = await rentalStopsFor({ ...NOBODY, email: EMAIL })
      const audited = () =>
        prisma.auditLog.findMany({
          where: { entityType: 'CheckoutSession', entityId: session.id },
          select: { action: true, reasonCode: true, actorStaffId: true, facilityId: true, after: true },
        })

      expect(
        await overrideRentalStops(staffActor(counterStaffId, 10, rentingFacilityId), session, stops, 'Paid cash'),
      ).toEqual({ ok: false, problem: 'needs_manager' })
      // A manager somewhere else is not a manager here.
      expect(
        await overrideRentalStops(staffActor(managerStaffId, 20, leftFacilityId), session, stops, 'Paid cash'),
      ).toEqual({ ok: false, problem: 'needs_manager' })
      expect(
        await overrideRentalStops(staffActor(managerStaffId, 20, rentingFacilityId), session, stops, ' '),
      ).toEqual({ ok: false, problem: 'reason_required' })
      expect(await audited()).toEqual([])
      expect(rentalStopsOverridden((await sessionByToken(started.token))?.data, stops)).toBe(false)

      expect(
        await overrideRentalStops(
          staffActor(managerStaffId, 20, rentingFacilityId),
          session,
          stops,
          'Paid the old balance in cash today',
        ),
      ).toEqual({ ok: true })

      expect(await audited()).toEqual([
        {
          action: 'checkout.rental_stop_overridden',
          reasonCode: 'Paid the old balance in cash today',
          actorStaffId: managerStaffId,
          facilityId: rentingFacilityId,
          after: { tenantIds: [owingTenantId], owedCents: OWED_CENTS, doNotRent: false },
        },
      ])

      // The stamp covers the tenant it named and nobody else.
      const stamped = (await sessionByToken(started.token))!
      expect(rentalStopsOverridden(stamped.data, stops)).toBe(true)
      expect(
        rentalStopsOverridden(stamped.data, [...stops, { ...stops[0]!, tenantId: flaggedTenantId }]),
      ).toBe(false)

      // And the shared action now lets the move-in continue.
      const state = await callAction(() =>
        submitDetailsAction({} as never, detailsForm(started.token, { email: EMAIL, firstName: 'Owen', lastName: LAST_NAME })),
      )
      expect(state?.status).not.toBe('error')
      expect((await sessionByToken(started.token))?.step).not.toBe('details')
    })
  })
})
