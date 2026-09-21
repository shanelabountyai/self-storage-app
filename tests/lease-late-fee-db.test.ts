import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { startCheckout, sessionByToken } from '../apps/web/lib/checkout/session'
import { buildLeaseDocuments, existingLeaseDocuments, leaseValuesFor } from '../apps/web/lib/lease/build'
import { signLeaseAction } from '../apps/web/app/(public)/checkout/actions'

// B-347. The lease's late-fee sentence reads the ladder `assessLateFees`
// charges, not `FeeSchedule`. At Austin South the lease promised a $20 late
// fee while the readiness banner said none was ever charged.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitTypeId = ''

// `revalidatePath` throws outside a real Next request; the signature has
// already committed by then. Same helper as checkout-consent-db.test.ts.
async function callAction<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof Error && error.message.includes('static generation store')) return undefined
    throw error
  }
}

describeDb('the lease states the late-fee ladder (B-347)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Late Fee Lease Test',
        slug: `latefee-lease-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    unitTypeId = (
      await prisma.unitType.create({
        data: { facilityId, name: `10x10lf ${suffix}`, widthFt: 10, lengthFt: 10 },
      })
    ).id
    // The row that used to leak into the lease. It must keep existing and keep
    // being ignored.
    await prisma.feeSchedule.create({
      data: { facilityId, feeType: 'late', amountCents: 2_000, effectiveFrom: new Date('2020-01-01T00:00:00Z') },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.documentSignature.deleteMany({ where: { document: { facilityId } } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.consent.deleteMany({ where: { tenant: { email: { contains: `latefee-${suffix}` } } } })
    await prisma.tenant.deleteMany({ where: { email: { contains: `latefee-${suffix}` } } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  async function sessionAtLeaseStep() {
    await prisma.unit.create({ data: { facilityId, unitTypeId, number: `LF-${randomUUID().slice(0, 6)}` } })
    const tenant = await prisma.tenant.create({
      data: { email: `latefee-${suffix}-${randomUUID()}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    const started = await startCheckout({ facilityId, unitTypeId, quotedRateCents: 12_900 })
    if (!started.ok) throw new Error('unreachable')
    await prisma.checkoutSession.update({
      where: { id: started.sessionId },
      data: {
        step: 'lease',
        tenantId: tenant.id,
        data: { firstName: 'Ada', lastName: 'Renter', addressLine1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78704' },
      },
    })
    const view = await sessionByToken(started.token)
    if (!view) throw new Error('unreachable')
    return { token: started.token, view }
  }

  it('names no dollar late fee when there is a FeeSchedule late row but no ladder', async () => {
    const { view } = await sessionAtLeaseStep()
    const { lateFeeSummary } = await leaseValuesFor(view)
    expect(lateFeeSummary).toBe('We do not charge a late fee if your rent is paid late.')
    expect(lateFeeSummary).not.toMatch(/\$/)
  })

  it('names both steps of a two-step ladder, and leaves a signed lease as signed', async () => {
    // Signed BEFORE the ladder exists, so its stored text says no late fee.
    const { token, view } = await sessionAtLeaseStep()
    await buildLeaseDocuments(view)
    const form = new FormData()
    form.set('token', token)
    form.set('typedName', 'Ada Renter')
    form.set('consented', 'yes')
    await callAction(() => signLeaseAction({ status: 'idle' }, form))
    const [signed] = await existingLeaseDocuments(view)
    expect(signed.document.signature).not.toBeNull()
    const signedContent = signed.document.content
    expect(signedContent).toContain('We do not charge a late fee')

    const effectiveFrom = new Date('2020-01-01T00:00:00Z')
    await prisma.lateFeeRule.createMany({
      data: [
        { facilityId, step: 1, daysPastDue: 5, amountCents: 2_500, basis: 'flat', effectiveFrom },
        {
          facilityId,
          step: 2,
          daysPastDue: 15,
          amountCents: 2_000,
          percentBasisPoints: 1_000,
          basis: 'greater',
          capCents: 5_000,
          effectiveFrom,
        },
      ],
    })

    const fresh = await sessionAtLeaseStep()
    const { lateFeeSummary } = await leaseValuesFor(fresh.view)
    expect(lateFeeSummary).toBe(
      'If your rent is not paid on time we charge a late fee of $25 once it is 5 days past due, ' +
        'and a further late fee of the greater of $20 or 10% of the overdue balance (at most $50) once it is 15 days past due.',
    )

    // The signed document is the contract; nothing re-renders it.
    const [after] = await existingLeaseDocuments(view)
    expect(after.document.id).toBe(signed.document.id)
    expect(after.document.content).toBe(signedContent)
    expect(after.document.contentHash).toBe(signed.document.contentHash)
  })
})
