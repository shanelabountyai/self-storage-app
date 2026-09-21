import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { voidRentInvoice } from '../apps/web/lib/billing/corrections'
import { recomputeInvoices } from '../apps/web/lib/billing/allocation'
import { generateInvoices } from '../apps/web/lib/billing/invoices'
import { leaseLedger } from '../apps/web/lib/admin/ledger'
import { assessLateFees } from '../apps/web/lib/billing/late-fees'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-327. A voided rent invoice releases its period, and the re-raise carries
// what the original carried.
//
// Every case runs the REAL generator both times rather than writing the
// reissue by hand, because the defect lived in the join between the two: the
// index let the period be billed again, and the consumed marks decided what the
// second invoice said. A fixture that built the second invoice itself would
// pass whether or not the marks were unwound.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''
let unitTypeId = ''
let unitCounter = 0
const tenantIds: string[] = []

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const noop = () => {}

function manager(maxCreditCents: number | null = null): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(['credits:manual', 'tenants:view']),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents },
      },
    ],
  }
}

async function makeLease(
  startDate: Date,
  transferredFromLeaseId?: string,
  extra: { preferredLocale?: string; billingAccountId?: string } = {},
) {
  unitCounter += 1
  const tenant = await prisma.tenant.create({
    data: {
      email: `vr-${unitCounter}-${suffix}@example.com`,
      firstName: 'Vera',
      lastName: `Rebill${unitCounter}`,
      preferredLocale: extra.preferredLocale,
    },
  })
  tenantIds.push(tenant.id)
  const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: `VR-${unitCounter}` } })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId: tenant.id,
      unitId: unit.id,
      status: 'active',
      startDate,
      billingDay: 1,
      monthlyRateCents: 12_900,
      transferredFromLeaseId,
      billingAccountId: extra.billingAccountId,
    },
  })
  return { leaseId: lease.id, tenantId: tenant.id }
}

async function redeem(leaseId: string, schedule: { periodIndex: number; amountCents: number }[], applied: number[]) {
  const promotion = await prisma.promotion.create({
    data: {
      name: `Rebill promo ${suffix}`,
      type: 'amount_off',
      value: 1,
      durationPeriods: schedule.length,
      status: 'active',
      facilityIds: [facilityId],
    },
  })
  return prisma.promoRedemption.create({
    data: {
      promotionId: promotion.id,
      facilityId,
      leaseId,
      schedule,
      totalCents: schedule.reduce((sum, period) => sum + period.amountCents, 0),
      appliedPeriods: applied,
    },
  })
}

/// The live (non-void) rent invoice for one period, with its lines.
async function liveRent(leaseId: string, periodStart: string) {
  const rows = await prisma.invoice.findMany({
    where: { leaseId, kind: 'rent', periodStart: d(periodStart), status: { not: 'void' } },
    include: { lineItems: true },
  })
  expect(rows).toHaveLength(1)
  return rows[0]
}

const discounts = (invoice: { lineItems: { type: string; description: string; amountCents: number }[] }) =>
  invoice.lineItems
    .filter((line) => line.type === 'discount')
    .map((line) => ({ description: line.description, amountCents: line.amountCents }))

async function appliedPeriods(redemptionId: string) {
  const row = await prisma.promoRedemption.findUniqueOrThrow({ where: { id: redemptionId } })
  return [...row.appliedPeriods].sort((a, b) => a - b)
}

async function voidIt(invoiceId: string) {
  expect(await voidRentInvoice(manager(), { invoiceId, reasonCode: 'wrong_rate' })).toMatchObject({ ok: true })
}

describeDb('B-327 — re-billing a voided rent period', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Void Rebill ${suffix}`,
        slug: `void-rebill-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        billingPolicy: 'first_of_month',
        // B-338: the reissue message, like every billing template, names it.
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id
    const staffUser = await prisma.staffUser.create({
      data: { email: `vr-staff-${suffix}@example.com`, firstName: 'Cass', lastName: 'Manager' },
    })
    staffId = staffUser.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    // The facility and the staff user stay: `audit_log` RESTRICTs both and
    // refuses its own deletion (B-185), and `voidRentInvoice` audits.
    vi.useRealTimers()
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.payLink.deleteMany({ where: { lease: { facilityId } } })
    await prisma.lateFeeRule.deleteMany({ where: { facilityId } })
    await prisma.referral.deleteMany({ where: { facilityId } })
    await prisma.referralInvite.deleteMany({ where: { facilityId } })
    await prisma.promoRedemption.deleteMany({ where: { facilityId } })
    await prisma.promotion.deleteMany({ where: { name: { contains: suffix } } })
    await prisma.paymentAllocation.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.domainEvent.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId, transferredFromLeaseId: { not: null } } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.billingAccount.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await prisma.$disconnect()
  })

  it('re-bills a voided period with the same promotion line, and spends no second period', async () => {
    const { leaseId } = await makeLease(d('2026-08-01'))
    // Distinct amounts, so period 1's discount turning up on September would
    // show as a different number rather than passing silently.
    const redemption = await redeem(
      leaseId,
      [
        { periodIndex: 0, amountCents: 5_000 },
        { periodIndex: 1, amountCents: 3_000 },
      ],
      [],
    )

    await generateInvoices(facilityId, d('2026-08-28'), noop)
    const original = await liveRent(leaseId, '2026-09-01')
    expect(discounts(original)).toEqual([expect.objectContaining({ amountCents: 5_000 })])
    expect(await appliedPeriods(redemption.id)).toEqual([0])

    await voidIt(original.id)
    // Released with the void, not with the re-raise: a lease that is never
    // re-billed (moved out the same day) was not given this month's discount.
    expect(await appliedPeriods(redemption.id)).toEqual([])

    await generateInvoices(facilityId, d('2026-08-28'), noop)
    const reissue = await liveRent(leaseId, '2026-09-01')
    expect(reissue.id).not.toBe(original.id)
    expect(discounts(reissue)).toEqual(discounts(original))
    expect(reissue.totalCents).toBe(original.totalCents)
    expect(await appliedPeriods(redemption.id)).toEqual([0])

    // Still idempotent: the index is scoped to live rows, not removed.
    await generateInvoices(facilityId, d('2026-08-28'), noop)
    expect(await prisma.invoice.count({ where: { leaseId, kind: 'rent', status: { not: 'void' } } })).toBe(1)

    // October gets period 1's discount — the void did not shift the schedule
    // or hand out period 0 twice.
    await generateInvoices(facilityId, d('2026-09-28'), noop)
    expect(discounts(await liveRent(leaseId, '2026-10-01'))).toEqual([
      expect.objectContaining({ amountCents: 3_000 }),
    ])
    expect(await appliedPeriods(redemption.id)).toEqual([0, 1])
  })

  it('re-bills a period with no promotion unchanged', async () => {
    const { leaseId } = await makeLease(d('2026-08-01'))
    await generateInvoices(facilityId, d('2026-08-28'), noop)
    const original = await liveRent(leaseId, '2026-09-01')

    await voidIt(original.id)
    await generateInvoices(facilityId, d('2026-08-28'), noop)
    const reissue = await liveRent(leaseId, '2026-09-01')

    const shape = (invoice: typeof original) =>
      invoice.lineItems
        .map((line) => ({ type: line.type, description: line.description, amountCents: line.amountCents }))
        .sort((a, b) => a.description.localeCompare(b.description))
    expect(shape(reissue)).toEqual(shape(original))
    expect(reissue.totalCents).toBe(original.totalCents)
    expect(discounts(reissue)).toEqual([])
  })

  it('releases the right period on a transferred lease, counted from the tenancy', async () => {
    // June and July ran on the lease this one came from, so September is
    // period 2 of the tenancy. Counting from this lease would release period 0
    // — already spent in June — and September would re-bill at full price.
    const origin = await makeLease(d('2026-06-01'))
    await prisma.lease.update({
      where: { id: origin.leaseId },
      data: { status: 'ended', endDate: d('2026-08-01'), moveOutReason: 'transfer' },
    })
    const { leaseId } = await makeLease(d('2026-08-01'), origin.leaseId)
    const redemption = await redeem(
      leaseId,
      [
        { periodIndex: 0, amountCents: 9_000 },
        { periodIndex: 1, amountCents: 6_000 },
        { periodIndex: 2, amountCents: 3_000 },
      ],
      [0, 1],
    )

    await generateInvoices(facilityId, d('2026-08-28'), noop)
    const original = await liveRent(leaseId, '2026-09-01')
    expect(await appliedPeriods(redemption.id)).toEqual([0, 1, 2])

    await voidIt(original.id)
    expect(await appliedPeriods(redemption.id)).toEqual([0, 1])

    await generateInvoices(facilityId, d('2026-08-28'), noop)
    expect(discounts(await liveRent(leaseId, '2026-09-01'))).toEqual([
      expect.objectContaining({ amountCents: 3_000 }),
    ])
    expect(await appliedPeriods(redemption.id)).toEqual([0, 1, 2])
  })

  it('moves a referral reward to the reissue and never pays it twice', async () => {
    const referrer = await makeLease(d('2026-07-01'))
    const { leaseId, tenantId } = await makeLease(d('2026-08-01'))
    const invite = await prisma.referralInvite.create({
      data: {
        code: `VR${suffix.toUpperCase()}`,
        referrerTenantId: referrer.tenantId,
        facilityId,
        expiresAt: d('2027-01-01'),
      },
    })
    const referral = await prisma.referral.create({
      data: {
        inviteId: invite.id,
        referrerTenantId: referrer.tenantId,
        refereeTenantId: tenantId,
        refereeLeaseId: leaseId,
        facilityId,
        state: 'earned',
        qualifiedAt: d('2026-08-15'),
        refereeRewardCents: 2_500,
      },
    })

    await generateInvoices(facilityId, d('2026-08-28'), noop)
    const original = await liveRent(leaseId, '2026-09-01')
    expect(discounts(original)).toEqual([expect.objectContaining({ amountCents: 2_500 })])
    expect((await prisma.referral.findUniqueOrThrow({ where: { id: referral.id } })).refereeRewardInvoiceId).toBe(
      original.id,
    )

    await voidIt(original.id)
    await generateInvoices(facilityId, d('2026-08-28'), noop)
    const reissue = await liveRent(leaseId, '2026-09-01')
    expect(discounts(reissue)).toEqual(discounts(original))
    expect((await prisma.referral.findUniqueOrThrow({ where: { id: referral.id } })).refereeRewardInvoiceId).toBe(
      reissue.id,
    )

    await generateInvoices(facilityId, d('2026-09-28'), noop)
    expect(discounts(await liveRent(leaseId, '2026-10-01'))).toEqual([])
  })

  // B-329. The void's other half: B-327 releasing the period is what turned a
  // part-paid void into a double bill, so the refusal is tested against the
  // real generator too — the assertion that matters is that the period is NOT
  // re-billed, not merely that the call returned `ok: false`.
  describe('a rent invoice money has been paid against', () => {
    async function payPartOf(invoiceId: string, tenantId: string, amountCents: number) {
      const payment = await prisma.payment.create({
        data: { facilityId, tenantId, amountCents, method: 'cash', status: 'succeeded' },
      })
      await prisma.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId, amountCents } })
      // The real recompute, so the fixture cannot disagree with what a payment
      // actually leaves behind.
      await prisma.$transaction((tx) => recomputeInvoices(tx, [invoiceId]))
    }

    it('is refused, writes nothing, and its period is not billed again', async () => {
      const { leaseId, tenantId } = await makeLease(d('2026-08-01'))
      await generateInvoices(facilityId, d('2026-08-28'), noop)
      const invoice = await liveRent(leaseId, '2026-09-01')
      await payPartOf(invoice.id, tenantId, Math.round(invoice.totalCents / 2))

      const entriesBefore = await prisma.ledgerEntry.count({ where: { leaseId } })
      expect(await voidRentInvoice(manager(), { invoiceId: invoice.id, reasonCode: 'wrong_rate' })).toMatchObject({
        ok: false,
        reason: 'partly_paid',
      })

      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
      expect(after.status).toBe('partially_paid')
      expect(await prisma.ledgerEntry.count({ where: { leaseId } })).toBe(entriesBefore)

      // The double bill itself: before the guard, this raised a second full-rate
      // invoice for a month the tenant had half paid.
      await generateInvoices(facilityId, d('2026-08-28'), noop)
      expect(await prisma.invoice.count({ where: { leaseId, kind: 'rent', periodStart: d('2026-09-01') } })).toBe(1)
    })

    it('is not offered as voidable on the ledger screen', async () => {
      const { leaseId, tenantId } = await makeLease(d('2026-08-01'))
      await generateInvoices(facilityId, d('2026-08-28'), noop)
      const invoice = await liveRent(leaseId, '2026-09-01')
      expect((await leaseLedger(manager(), leaseId))?.voidableInvoices.map((row) => row.id)).toEqual([invoice.id])

      await payPartOf(invoice.id, tenantId, 1_000)
      expect((await leaseLedger(manager(), leaseId))?.voidableInvoices).toEqual([])
    })

    it('still refuses a staffer over their credit limit, and writes nothing', async () => {
      const { leaseId } = await makeLease(d('2026-08-01'))
      await generateInvoices(facilityId, d('2026-08-28'), noop)
      const invoice = await liveRent(leaseId, '2026-09-01')

      expect(await voidRentInvoice(manager(100), { invoiceId: invoice.id, reasonCode: 'wrong_rate' })).toMatchObject({
        ok: false,
        reason: 'over_limit',
      })
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('open')
      expect(await prisma.ledgerEntry.count({ where: { leaseId, type: 'adjustment' } })).toBe(0)
    })
  })

  // ── B-338 ────────────────────────────────────────────────────────────────

  it('B-338: the void form states what the next run re-bills, and says when it is the same amount', async () => {
    // `projectRentRebill` reads the real clock for "which period is current"
    // (D-142), so the clock is pinned — Date only, since faking timers wholesale
    // hangs the Prisma round trips.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-09-03T17:00:00Z'))
      const { leaseId } = await makeLease(d('2026-08-01'))
      await generateInvoices(facilityId, d('2026-08-28'), noop)
      const original = await liveRent(leaseId, '2026-09-01')

      // Rate unchanged: a "rate was never agreed" void would re-bill exactly
      // what it cancels. That equality is what the form warns about.
      const [unchanged] = (await leaseLedger(manager(), leaseId))!.voidableInvoices
      expect(unchanged).toMatchObject({
        id: original.id,
        outstandingCents: original.totalCents,
        rebillCents: original.totalCents,
      })

      // Rate corrected first: the preview follows the lease, as the run will.
      await prisma.lease.update({ where: { id: leaseId }, data: { monthlyRateCents: 9_900 } })
      const [corrected] = (await leaseLedger(manager(), leaseId))!.voidableInvoices
      expect(corrected.rebillCents).toBe(9_900)

      // A month on, September is not the current period and D-142 will not
      // bill it again — the form says nothing rather than quote a figure.
      vi.setSystemTime(new Date('2026-10-03T17:00:00Z'))
      const [stale] = (await leaseLedger(manager(), leaseId))!.voidableInvoices
      expect(stale).toMatchObject({ id: original.id, rebillCents: null })
    } finally {
      vi.useRealTimers()
    }
  })

  it('B-338: the reissue is due the day it is raised, draws no late fee that night, and tells the tenant once', async () => {
    const sent: string[] = []
    vi.spyOn(provider, 'selectProvider').mockImplementation(() => ({
      name: 'test',
      async sendEmail(email) {
        sent.push(email.to)
        return { ok: true, providerMessageId: `test_${sent.length}` }
      },
    }))
    vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
    vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)

    // A step that fires one day late, so a ladder still counting from the
    // voided original's 1 September would charge on the 3rd.
    await prisma.lateFeeRule.create({
      data: { facilityId, step: 1, daysPastDue: 1, amountCents: 2_500, effectiveFrom: d('2026-01-01') },
    })

    // A Spanish-speaking tenant on a business account, so "tenant-only" and
    // "in their language" are both measured, not assumed.
    const payer = await prisma.tenant.create({
      data: { email: `vr-payer-${suffix}@example.com`, firstName: 'Pat', lastName: 'Payables' },
    })
    tenantIds.push(payer.id)
    const account = await prisma.billingAccount.create({
      data: { facilityId, name: `Rebill Co ${suffix}`, payerTenantId: payer.id },
    })
    const { leaseId, tenantId } = await makeLease(d('2026-08-01'), undefined, {
      preferredLocale: 'es',
      billingAccountId: account.id,
    })

    await generateInvoices(facilityId, d('2026-08-28'), noop)
    const original = await liveRent(leaseId, '2026-09-01')
    expect(original.dueDate).toEqual(d('2026-09-01'))
    await voidIt(original.id)

    await generateInvoices(facilityId, d('2026-09-03'), noop)
    const reissue = await liveRent(leaseId, '2026-09-01')
    expect(reissue.id).not.toBe(original.id)
    expect(reissue.dueDate).toEqual(d('2026-09-03'))

    await assessLateFees(facilityId, d('2026-09-03'), noop)
    expect(await prisma.invoice.count({ where: { leaseId, kind: 'fee' } })).toBe(0)

    const events = await prisma.domainEvent.findMany({ where: { name: 'invoice.reissued', entityId: reissue.id } })
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({ replacesInvoiceId: original.id, dueDate: '2026-09-03' })
    // An ordinary first issue is not a reissue.
    expect(await prisma.domainEvent.count({ where: { name: 'invoice.reissued', entityId: original.id } })).toBe(0)

    await processCommsEvent(events[0])
    const messages = await prisma.message.findMany({ where: { eventId: events[0].id } })
    expect(messages).toHaveLength(1)
    expect(messages[0].error).toBeNull()
    expect(messages[0]).toMatchObject({ recipientTenantId: tenantId, templateKey: 'invoice_reissued', status: 'sent' })
    expect(messages[0].subjectSnapshot).toContain('corregida')
    expect(messages[0].bodySnapshot).toContain('$129.00')
  })
})
