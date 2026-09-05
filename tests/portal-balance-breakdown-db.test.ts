import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { balanceBreakdownFor, reconciles } from '../apps/web/lib/portal/balance-breakdown'
import { payableLease } from '../apps/web/lib/portal/payment'
import { translate } from '../apps/web/lib/i18n'
import { en } from '../apps/web/lib/i18n/en'

// PRD 01 US-702/US-703 §6.7 (B-232). What `/portal/pay` shows a tenant before
// it asks them for money.
//
// The screen was "Balance $487.50 / Paying today $487.50" and nothing else,
// while the balance was rent plus tax plus a late fee. Two things are under
// test: that the itemisation ADDS UP to the balance it explains, and that the
// gate figures the screen quotes are the facility-wide ones the gate rule
// actually reads.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseAId = ''
let leaseBId = ''

describeDb('the balance a tenant is asked to pay', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Breakdown ${suffix}`,
        slug: `breakdown-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        // Deliberately NOT zero. D-16's default is 0 and the portal hardcoded
        // it as though it were the rule; a facility that relaxes it is the case
        // that was wrong.
        accessRestoreAtOrBelowCents: 5_000,
      },
    })
    facilityId = facility.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const tenant = await prisma.tenant.create({
      data: { email: `bd-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    async function makeLease(number: string) {
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number },
      })
      const lease = await prisma.lease.create({
        data: {
          facilityId,
          tenantId,
          unitId: unit.id,
          status: 'active',
          startDate: new Date('2026-07-01T00:00:00Z'),
          billingDay: 1,
          monthlyRateCents: 12_900,
        },
      })
      return lease.id
    }
    leaseAId = await makeLease(`BD-A-${suffix}`)
    leaseBId = await makeLease(`BD-B-${suffix}`)

    // A settled July, then an unpaid August invoice and a late fee on it. The
    // settled month is what must NOT appear on the bill.
    async function invoice(input: {
      leaseId: string
      number: string
      on: Date
      lines: { type: 'rent' | 'fee' | 'tax'; description: string; amountCents: number }[]
    }) {
      const total = input.lines.reduce((sum, line) => sum + line.amountCents, 0)
      const created = await prisma.invoice.create({
        data: {
          facilityId,
          leaseId: input.leaseId,
          number: input.number,
          kind: input.lines[0].type === 'fee' ? 'fee' : 'rent',
          status: 'open',
          issueDate: input.on,
          dueDate: input.on,
          periodStart: input.on,
          periodEnd: new Date(input.on.getTime() + 30 * 24 * 60 * 60 * 1000),
          subtotalCents: total,
          taxCents: 0,
          totalCents: total,
          amountPaidCents: 0,
          lineItems: {
            create: input.lines.map((line) => ({
              type: line.type,
              description: line.description,
              quantity: 1,
              unitAmountCents: line.amountCents,
              amountCents: line.amountCents,
            })),
          },
        },
      })
      await prisma.ledgerEntry.create({
        data: {
          facilityId,
          leaseId: input.leaseId,
          type: 'charge',
          amountCents: total,
          description: `Invoice ${input.number}`,
          occurredAt: input.on,
          invoiceId: created.id,
        },
      })
    }

    await invoice({
      leaseId: leaseAId,
      number: `INV-J-${suffix}`,
      on: new Date('2026-07-01T15:00:00Z'),
      lines: [{ type: 'rent', description: 'Rent, July', amountCents: 12_900 }],
    })
    await prisma.ledgerEntry.create({
      data: {
        facilityId,
        leaseId: leaseAId,
        type: 'payment',
        amountCents: -12_900,
        description: 'Payment INV-J',
        occurredAt: new Date('2026-07-03T15:00:00Z'),
      },
    })
    await invoice({
      leaseId: leaseAId,
      number: `INV-A-${suffix}`,
      on: new Date('2026-08-01T15:00:00Z'),
      lines: [
        { type: 'rent', description: 'Rent, August', amountCents: 12_900 },
        { type: 'tax', description: 'TX tax (8.25%)', amountCents: 1_064 },
      ],
    })
    await invoice({
      leaseId: leaseAId,
      number: `INV-F-${suffix}`,
      on: new Date('2026-08-11T15:00:00Z'),
      lines: [
        { type: 'fee', description: 'Late fee (step 1) — 10+ days past due', amountCents: 2_000 },
      ],
    })

    // The second unit, so the facility-wide figure is a different number from
    // this lease's balance.
    await prisma.ledgerEntry.create({
      data: {
        facilityId,
        leaseId: leaseBId,
        type: 'charge',
        amountCents: 10_000,
        description: 'Move-in charges',
        occurredAt: new Date('2026-08-01T15:00:00Z'),
      },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId } } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  it('adds up to the balance it explains', async () => {
    const breakdown = await balanceBreakdownFor(leaseAId, 'America/Chicago')
    // Rent 129.00 + tax 10.64 + late fee 20.00. July is settled and absent.
    expect(breakdown.totalCents).toBe(15_964)
    expect(reconciles(breakdown, 15_964)).toBe(true)
  })

  it('leaves out a month that was paid for, and expands an invoice into its lines', async () => {
    const breakdown = await balanceBreakdownFor(leaseAId, 'America/Chicago')

    // Not one row saying "Invoice INV-A — $139.64", which is the bare total the
    // screen already had, and not July, which is settled.
    //
    // B-260 (D-122): a STORED line prints its own `label` — what the billing
    // engine wrote onto the invoice, which the statement and every staff screen
    // also show — while the late fee's wording is GENERATED here, so it carries
    // `lateFee` and a null label and the page says it in the reader's language.
    // Translating a recorded invoice line would make this screen disagree with
    // the record it is itemising.
    expect(breakdown.lines.map((line) => line.label)).toEqual([
      'Rent, August',
      'TX tax (8.25%)',
      null,
    ])
    expect(breakdown.lines.map((line) => line.lateFee)).toEqual([false, false, true])
    expect(breakdown.lines.map((line) => line.amountCents)).toEqual([12_900, 1_064, 2_000])
  })

  it('says a late fee in the tenant\'s words and marks it disputable', async () => {
    const breakdown = await balanceBreakdownFor(leaseAId, 'America/Chicago')
    const fee = breakdown.lines.find((line) => line.disputable)

    // Never "Late fee (step 1) — 10+ days past due": a step number is a rule
    // engine's word, and the tenant wants the date it was charged. B-260 moved
    // the wording into the dictionaries; what this file asserts is that the
    // line is FLAGGED as the generated one and carries the date the page
    // interpolates, rather than the sentence itself.
    expect(fee?.lateFee).toBe(true)
    expect(fee?.label).toBeNull()
    expect(fee?.on).toBe('August 11, 2026')
    expect(translate(en, 'paypg.lateFeeAssessed', { on: fee!.on })).toBe(
      'Late fee, assessed August 11, 2026',
    )
    // The rent and tax lines are not something to argue with, so they carry no
    // phone number.
    expect(breakdown.lines.filter((line) => line.disputable)).toHaveLength(1)
  })

  it('quotes the FACILITY-wide balance and the facility threshold for the gate', async () => {
    const lease = await payableLease(tenantId, leaseAId)
    if (!lease) throw new Error('unreachable')

    // This lease owes $159.64; the tenant owes $259.64 at this facility, which
    // is what `gateDecision` compares — a grant cannot be partially suspended.
    expect(lease.balanceCents).toBe(15_964)
    expect(lease.facilityBalanceCents).toBe(25_964)
    // D-16's threshold, read rather than assumed to be zero.
    expect(lease.restoreAtOrBelowCents).toBe(5_000)
  })
})
