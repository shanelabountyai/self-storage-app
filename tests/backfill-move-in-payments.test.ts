import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { planMoveInBackfill } from '../apps/web/scripts/backfill-move-in-payments.mts'
import { postMoveInPaymentToLedger } from '../apps/web/lib/payments/reconcile'

// B-255. The repair for every lease created by a web move-in before the payment
// half of the opening ledger was written. What is checked here is the matching,
// because that is where the script decides money moves: it credits a lease only
// when exactly one succeeded payment of exactly the outstanding amount exists.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitTypeId = ''

describeDb('move-in payment backfill', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Backfill Test',
        slug: `backfill-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { email: { contains: suffix } } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  /// One tenant, one lease, one unpaid-looking opening charge.
  async function strandedMoveIn(label: string, chargeCents: number) {
    const tenant = await prisma.tenant.create({
      data: { email: `bf-${label}-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `${label}-${suffix}`.slice(0, 20) },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId: tenant.id,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        monthlyRateCents: 12_900,
        billingDay: 1,
      },
    })
    await prisma.ledgerEntry.create({
      data: {
        facilityId,
        leaseId: lease.id,
        type: 'charge',
        amountCents: chargeCents,
        description: 'Move-in charges',
      },
    })
    return { tenant, lease }
  }

  async function succeededPayment(tenantId: string, amountCents: number) {
    return prisma.payment.create({
      data: {
        facilityId,
        tenantId,
        amountCents,
        method: 'card',
        status: 'succeeded',
        stripePaymentIntentId: `pi_bf_${randomUUID().slice(0, 12)}`,
      },
    })
  }

  const mine = (plans: Awaited<ReturnType<typeof planMoveInBackfill>>) =>
    plans.filter((plan) => plan.facilityId === facilityId)

  it('matches a stranded move-in to the payment that paid for it, and posts it', async () => {
    const { tenant, lease } = await strandedMoveIn('ok', 15_400)
    const payment = await succeededPayment(tenant.id, 15_400)

    const plan = mine(await planMoveInBackfill()).find((row) => row.tenantId === tenant.id)
    expect(plan?.payment?.id).toBe(payment.id)
    expect(plan?.leaseIds).toEqual([lease.id])

    await postMoveInPaymentToLedger(payment, plan!.leaseIds)
    const entries = await prisma.ledgerEntry.findMany({ where: { leaseId: lease.id } })
    expect(entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0)

    // And the repaired lease drops out of the plan — running the script twice
    // must not credit it twice.
    expect(mine(await planMoveInBackfill()).some((row) => row.tenantId === tenant.id)).toBe(false)
  })

  it('refuses to guess when two payments of the same amount could be the one', async () => {
    const { tenant } = await strandedMoveIn('amb', 9_900)
    await succeededPayment(tenant.id, 9_900)
    await succeededPayment(tenant.id, 9_900)

    const plan = mine(await planMoveInBackfill()).find((row) => row.tenantId === tenant.id)
    expect(plan?.payment).toBeNull()
    expect(plan?.candidates).toBe(2)
  })

  it('leaves a move-in alone when no payment matches what it owes', async () => {
    const { tenant } = await strandedMoveIn('none', 20_000)
    await succeededPayment(tenant.id, 12_900)

    const plan = mine(await planMoveInBackfill()).find((row) => row.tenantId === tenant.id)
    expect(plan?.payment).toBeNull()
    expect(plan?.candidates).toBe(0)
  })
})
