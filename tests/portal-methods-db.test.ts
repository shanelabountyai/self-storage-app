import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { autopayLeases, savedMethods, setLeaseAutopay } from '../apps/web/lib/portal/payment-methods'
import { portalDashboardForTenant } from '../apps/web/lib/portal/dashboard'

// B-036 / PRD 01 §4.7 US-704.
//
// `setDefaultMethod` and `removeMethod` are not covered here: both are mostly
// Stripe calls (list, detach, customers.update) and there is no Stripe key
// anywhere in this project, so there is nothing to exercise them against. The
// half that is ours — whether a unit charges itself, and what the dashboard
// says about it — is all below. See PROGRESS.md for what that leaves unproven.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let otherTenantId = ''
let leaseId = ''

describeDb('autopay', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Methods Test',
        slug: `methods-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const [tenant, other] = await Promise.all([
      prisma.tenant.create({
        data: { email: `methods-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
      }),
      prisma.tenant.create({
        data: { email: `methods-other-${suffix}@example.com`, firstName: 'Bo', lastName: 'Other' },
      }),
    ])
    tenantId = tenant.id
    otherTenantId = other.id

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
        protectionCents: 1_200,
        billingDay: 10,
      },
    })
    leaseId = lease.id
  })

  beforeEach(async () => {
    await prisma.lease.update({ where: { id: leaseId }, data: { autopayEnabled: false } })
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeDefaultPaymentMethodId: null },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  it('defaults to off on a lease nothing has enrolled', async () => {
    // The column default matters: a lease created by any path that has not
    // thought about autopay must not silently start charging someone.
    const lease = await prisma.lease.findUniqueOrThrow({
      where: { id: leaseId },
      select: { autopayEnabled: true },
    })
    expect(lease.autopayEnabled).toBe(false)
  })

  it('refuses to turn autopay on with no card to charge', async () => {
    // Otherwise the dashboard reads "On" and the billing day takes nothing —
    // a delinquency the tenant did not earn.
    expect(await setLeaseAutopay(tenantId, leaseId, true)).toEqual({
      ok: false,
      reason: 'no_method',
    })
    const lease = await prisma.lease.findUniqueOrThrow({
      where: { id: leaseId },
      select: { autopayEnabled: true },
    })
    expect(lease.autopayEnabled, 'stored anyway despite being refused').toBe(false)
  })

  it('turns autopay on once a card is on file, and off again', async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeDefaultPaymentMethodId: 'pm_test_card' },
    })

    expect(await setLeaseAutopay(tenantId, leaseId, true)).toEqual({ ok: true })
    expect(
      (await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })).autopayEnabled,
    ).toBe(true)

    expect(await setLeaseAutopay(tenantId, leaseId, false)).toEqual({ ok: true })
    expect(
      (await prisma.lease.findUniqueOrThrow({ where: { id: leaseId } })).autopayEnabled,
    ).toBe(false)
  })

  it('lets a tenant turn autopay OFF even with no card on file', async () => {
    // The stop direction is never blocked. A lease left enrolled with no
    // method has to be escapable, or the tenant is stuck with a broken
    // promise they cannot clear.
    await prisma.lease.update({ where: { id: leaseId }, data: { autopayEnabled: true } })
    expect(await setLeaseAutopay(tenantId, leaseId, false)).toEqual({ ok: true })
  })

  it('refuses to toggle a lease belonging to someone else', async () => {
    // The lease id comes from a form field.
    expect(await setLeaseAutopay(otherTenantId, leaseId, false)).toEqual({
      ok: false,
      reason: 'not_yours',
    })
  })

  it('reports the monthly charge including protection, not just rent', async () => {
    const [lease] = await autopayLeases(tenantId)
    expect(lease.monthlyChargeCents).toBe(12_900 + 1_200)
    expect(lease.billingDay).toBe(10)
  })

  it('tells the dashboard when autopay is on but has nothing to charge', async () => {
    await prisma.lease.update({ where: { id: leaseId }, data: { autopayEnabled: true } })
    const [summary] = await portalDashboardForTenant(tenantId)
    expect(summary.autopayEnabled).toBe(true)
    expect(summary.autopayNeedsCard).toBe(true)

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeDefaultPaymentMethodId: 'pm_test_card' },
    })
    const [withCard] = await portalDashboardForTenant(tenantId)
    expect(withCard.autopayNeedsCard).toBe(false)
  })

  it('no longer infers autopay from merely having a card saved', async () => {
    // The old behaviour: any saved card read as "autopay on", so a renter who
    // opted out at checkout still saw On — and one who opted in saw Off,
    // because nothing ever wrote the field.
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeDefaultPaymentMethodId: 'pm_test_card' },
    })
    const [summary] = await portalDashboardForTenant(tenantId)
    expect(summary.autopayEnabled).toBe(false)
  })

  it('reports saved cards as unavailable rather than empty when Stripe is unconfigured', async () => {
    // "We could not ask" and "you have none" are different sentences.
    const before = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    expect(await savedMethods(tenantId)).toBeNull()
    if (before !== undefined) process.env.STRIPE_SECRET_KEY = before
  })
})
