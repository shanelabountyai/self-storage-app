import { prisma } from '../packages/db'
import { mintPayLink } from '../apps/web/lib/portal/pay-links'
import { hashPassword } from '../apps/web/lib/auth/password'

// B-314 / B-336. `/pay/[token]/done` needs a real payLink and a real Payment,
// nothing more. A disposable fixture per B-120: its own facility and tenant,
// never the shared demo lease. Shared by `pay-link.spec.ts` and the layout
// loops in `a11y-own-spec-routes.spec.ts` (B-348), each under its own slug.
export async function createPayReceiptFixture(slug: string, password: string) {
  const facility = await prisma.facility.create({
    data: {
      name: 'E2E — Pay Link',
      slug,
      addressLine1: '1 Test Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '78704',
      timezone: 'America/Chicago',
    },
  })
  const facilityId = facility.id

  const tenant = await prisma.tenant.create({
    data: {
      email: `${slug}@example.com`,
      firstName: 'Ada',
      lastName: 'Renter',
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
    },
  })
  const tenantId = tenant.id

  const unitType = await prisma.unitType.create({
    data: { facilityId, name: `10x10 ${slug}`, widthFt: 10, lengthFt: 10 },
  })
  const unit = await prisma.unit.create({ data: { facilityId, unitTypeId: unitType.id, number: 'P-1' } })
  const lease = await prisma.lease.create({
    data: {
      facilityId,
      tenantId,
      unitId: unit.id,
      status: 'active',
      startDate: new Date(),
      billingDay: 1,
      monthlyRateCents: 12_900,
    },
  })
  const leaseId = lease.id

  const link = await mintPayLink({ tenantId, leaseId })
  if (!link) throw new Error('mint failed')

  const payment = await prisma.payment.create({
    data: { facilityId, tenantId, amountCents: 12_900, method: 'card', status: 'succeeded' },
  })

  return {
    facilityId,
    tenantId,
    leaseId,
    token: link.token,
    paymentId: payment.id,
    async cleanup() {
      await prisma.payment.deleteMany({ where: { facilityId } })
      await prisma.payLink.deleteMany({ where: { leaseId } })
      await prisma.lease.deleteMany({ where: { facilityId } })
      await prisma.unit.deleteMany({ where: { facilityId } })
      await prisma.unitType.deleteMany({ where: { facilityId } })
      await prisma.tenant.deleteMany({ where: { id: tenantId } })
      await prisma.facility.delete({ where: { id: facilityId } })
    },
  }
}
