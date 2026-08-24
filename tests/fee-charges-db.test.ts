import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { chargeableFees, chargeableLeases, postFeeCharge } from '../apps/web/lib/billing/charges'
import { waiveFeeInvoice } from '../apps/web/lib/billing/late-fees'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// PRD 02 §4.5 US-21/US-23 (B-167). Charging a fee.
//
// The properties worth a database: the charge lands as a `kind: 'fee'` invoice
// with a matching ledger entry (so autopay collects it and `waiveFeeInvoice`
// can reach it), the authority ladder is measured against the DEPARTURE from
// the facility's schedule rather than the amount, and two fees on the same
// lease on the same day both post — which the `(leaseId, periodStart)` unique
// silently prevented until this item scoped it to rent.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitTypeId = ''
let tenantId = ''
let leaseId = ''
let staffId = ''

/// The three rungs of the ladder this item leans on. `counter` is the case that
/// matters most: `fees:charge` but NO `fees:waive` and a $0 limit, so they can
/// post the facility's price and nothing else.
function counter(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'counter',
        rank: 10,
        permissions: new Set<PermissionKey>(['tenants:view', 'fees:charge'] as never),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

function manager(maxFeeWaiverCents: number | null = 5_000): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>([
          'tenants:view',
          'fees:charge',
          'fees:waive',
        ] as never),
        limits: { maxFeeWaiverCents, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

function noAuthority(): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'bookkeeper',
        rank: 10,
        permissions: new Set<PermissionKey>(['tenants:view'] as never),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function priceFee(feeType: string, amountCents: number): Promise<void> {
  await prisma.feeSchedule.create({
    data: {
      facilityId,
      feeType: feeType as never,
      amountCents,
      effectiveFrom: new Date('2020-01-01T00:00:00Z'),
    },
  })
}

describeDb('charging a fee (US-21 / B-167)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Charges ${suffix}`,
        slug: `charges-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `charge-staff-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id

    const tenant = await prisma.tenant.create({
      data: { email: `charge-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `C-${suffix.slice(0, 4)}` },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-01-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { leaseId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { leaseId } } })
    await prisma.invoice.deleteMany({ where: { leaseId } })
    await prisma.feeSchedule.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    // `audit_log` is append-only — a trigger rejects DELETE (B-002) — so every
    // assertion below is scoped to its own entityId, and the facility that has
    // been audited stays.
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.feeSchedule.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  describe('what a charge lands as', () => {
    it('posts a fee invoice, a matching ledger entry, and an audited reason', async () => {
      await priceFee('cleaning', 7_500)

      const result = await postFeeCharge(counter(), {
        leaseId,
        feeType: 'cleaning',
        amountCents: 7_500,
        note: 'Unit left full of rubbish',
      })
      expect(result).toMatchObject({ ok: true, amountCents: 7_500 })
      if (!result.ok) throw new Error('unreachable')

      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: result.invoiceId },
        include: { lineItems: true },
      })
      // `kind: 'fee'` is load-bearing: it is what stops the charge itself
      // becoming the base for a late fee.
      expect(invoice.kind).toBe('fee')
      expect(invoice.status).toBe('open')
      expect(invoice.totalCents).toBe(7_500)
      expect(invoice.taxCents).toBe(0)
      // The tenant reads this line, so the note has to be in it.
      expect(invoice.lineItems[0]?.description).toBe('Cleaning — Unit left full of rubbish')

      const entry = await prisma.ledgerEntry.findFirstOrThrow({
        where: { leaseId, invoiceId: invoice.id },
      })
      expect(entry.type).toBe('charge')
      expect(entry.amountCents).toBe(7_500)

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'fee.charged', entityId: invoice.id },
      })
      expect(audit.reasonCode).toBe('Unit left full of rubbish')
      // Both figures, so "was this the facility's price or somebody's
      // judgement" is answerable.
      expect(audit.after).toMatchObject({ scheduledCents: 7_500, overrideCents: 0 })
    })

    it('is waivable like any other fee — the reason it is an invoice at all', async () => {
      await priceFee('damage', 12_000)
      const charged = await postFeeCharge(manager(20_000), {
        leaseId,
        feeType: 'damage',
        amountCents: 12_000,
        note: 'Door skin dented',
      })
      if (!charged.ok) throw new Error('unreachable')

      const waived = await waiveFeeInvoice(manager(20_000), charged.invoiceId, {
        reasonCode: 'goodwill',
      })
      expect(waived).toEqual({ ok: true, amountCents: 12_000 })

      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: charged.invoiceId } })
      expect(invoice.status).toBe('void')
    })

    it('posts two fees on the same lease on the same day', async () => {
      // The regression this item's migration exists for. `(leaseId,
      // periodStart)` was unique across every invoice kind, so the second fee
      // of a move-out afternoon was silently lost.
      await priceFee('cleaning', 7_500)
      await priceFee('damage', 12_000)

      const first = await postFeeCharge(manager(), {
        leaseId,
        feeType: 'cleaning',
        amountCents: 7_500,
        note: 'Rubbish',
      })
      const second = await postFeeCharge(manager(), {
        leaseId,
        feeType: 'damage',
        amountCents: 12_000,
        note: 'Dented door',
      })
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)

      const invoices = await prisma.invoice.findMany({ where: { leaseId, kind: 'fee' } })
      expect(invoices).toHaveLength(2)
      expect(invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0)).toBe(19_500)
    })
  })

  describe('the authority ladder', () => {
    it('lets counter staff post the facility’s own price', async () => {
      await priceFee('lock_cut', 3_000)
      expect(
        await postFeeCharge(counter(), {
          leaseId,
          feeType: 'lock_cut',
          amountCents: 3_000,
          note: 'Cut at the tenant’s request',
        }),
      ).toMatchObject({ ok: true })
    })

    it('refuses counter staff a penny either side of it', async () => {
      await priceFee('lock_cut', 3_000)

      // Under: giving money away, which is a waiver by another name.
      expect(
        await postFeeCharge(counter(), {
          leaseId,
          feeType: 'lock_cut',
          amountCents: 2_000,
          note: 'Being nice',
        }),
      ).toMatchObject({ ok: false, reason: 'override_forbidden', overrideCents: 1_000 })

      // Over: discretion in the direction that hurts the tenant, which if
      // anything wants the limit more.
      expect(
        await postFeeCharge(counter(), {
          leaseId,
          feeType: 'lock_cut',
          amountCents: 4_000,
          note: 'Difficult lock',
        }),
      ).toMatchObject({ ok: false, reason: 'override_forbidden', overrideCents: 1_000 })

      expect(await prisma.invoice.findMany({ where: { leaseId } })).toHaveLength(0)
    })

    it('lets a manager move it inside their limit and refuses them outside it', async () => {
      await priceFee('damage', 10_000)

      expect(
        await postFeeCharge(manager(5_000), {
          leaseId,
          feeType: 'damage',
          amountCents: 14_000,
          note: 'Worse than the standard figure',
        }),
      ).toMatchObject({ ok: true })

      const refused = await postFeeCharge(manager(5_000), {
        leaseId,
        feeType: 'damage',
        amountCents: 20_000,
        note: 'Much worse',
      })
      expect(refused).toMatchObject({ ok: false, reason: 'over_limit', overrideCents: 10_000 })
      if (refused.ok) throw new Error('unreachable')
      expect(refused.limitCents).toBe(5_000)
      // RBAC-2: an over-limit refusal names who can carry it rather than
      // simply saying no.
      expect(refused.escalateTo).toBeTruthy()
    })

    it('treats a fee the facility has never priced as an override of the whole amount', async () => {
      expect(
        await postFeeCharge(counter(), {
          leaseId,
          feeType: 'auction_cost',
          amountCents: 5_000,
          note: 'Advertising',
        }),
      ).toMatchObject({ ok: false, reason: 'override_forbidden', overrideCents: 5_000 })

      expect(
        await postFeeCharge(manager(null), {
          leaseId,
          feeType: 'auction_cost',
          amountCents: 5_000,
          note: 'Advertising in the Statesman',
        }),
      ).toMatchObject({ ok: true })
    })

    it('refuses an actor with no charge permission at all', async () => {
      await priceFee('cleaning', 7_500)
      expect(
        await postFeeCharge(noAuthority(), {
          leaseId,
          feeType: 'cleaning',
          amountCents: 7_500,
          note: 'Rubbish',
        }),
      ).toMatchObject({ ok: false, reason: 'forbidden' })
    })
  })

  describe('what it refuses outright', () => {
    it('refuses a fee type that already has an automatic charger', async () => {
      // No hand-posted late fee beside the ladder's, and no hand-posted NSF
      // beside the reversal's — that is how a tenant gets two fees for one
      // event.
      for (const feeType of ['late', 'nsf', 'admin', 'transfer']) {
        expect(
          await postFeeCharge(manager(null), {
            leaseId,
            feeType,
            amountCents: 2_000,
            note: 'Trying it on',
          }),
        ).toMatchObject({ ok: false, reason: 'unknown_fee_type' })
      }
    })

    it('refuses a charge with no note, and a zero or negative amount', async () => {
      await priceFee('cleaning', 7_500)
      expect(
        await postFeeCharge(manager(null), {
          leaseId,
          feeType: 'cleaning',
          amountCents: 7_500,
          note: '   ',
        }),
      ).toMatchObject({ ok: false, reason: 'missing_note' })

      for (const amountCents of [0, -7_500]) {
        expect(
          await postFeeCharge(manager(null), {
            leaseId,
            feeType: 'cleaning',
            amountCents,
            note: 'Rubbish',
          }),
        ).toMatchObject({ ok: false, reason: 'bad_amount' })
      }

      expect(await prisma.invoice.findMany({ where: { leaseId } })).toHaveLength(0)
    })
  })

  describe('what the form is offered', () => {
    it('lists the six types with the facility’s price, and null where there is none', async () => {
      await priceFee('cleaning', 7_500)
      const fees = await chargeableFees(facilityId)

      expect(fees.map((fee) => fee.feeType)).toEqual([
        'lock_cut',
        'cleaning',
        'damage',
        'lien',
        'certified_mail',
        'auction_cost',
      ])
      expect(fees.find((fee) => fee.feeType === 'cleaning')?.scheduledCents).toBe(7_500)
      expect(fees.find((fee) => fee.feeType === 'damage')?.scheduledCents).toBeNull()
    })

    it('offers an ended lease too — the walk that finds the damage is after they have gone', async () => {
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })
      try {
        const leases = await chargeableLeases(tenantId)
        expect(leases.map((lease) => lease.leaseId)).toContain(leaseId)
        expect(leases.find((lease) => lease.leaseId === leaseId)?.ended).toBe(true)

        await priceFee('cleaning', 7_500)
        expect(
          await postFeeCharge(manager(), {
            leaseId,
            feeType: 'cleaning',
            amountCents: 7_500,
            note: 'Found on the walk after they left',
          }),
        ).toMatchObject({ ok: true })
      } finally {
        await prisma.lease.update({ where: { id: leaseId }, data: { status: 'active' } })
      }
    })
  })
})
