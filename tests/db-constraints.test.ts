import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '../packages/db/generated/client'

// Proves the raw-SQL invariants in the migration actually hold in a real
// Postgres. Skipped when no database is reachable so `npm test` stays offline;
// CI provisions a throwaway Postgres and runs it for real.
const hasDatabase = Boolean(process.env.DATABASE_URL)
const prisma = hasDatabase ? new PrismaClient() : null

afterAll(async () => {
  await prisma?.$disconnect()
})

/// Runs the callback inside a transaction that always rolls back, so the test
/// never leaves rows behind — including in a developer's own dev database.
async function inRollbackTransaction(fn: (tx: unknown) => Promise<void>) {
  const sentinel = new Error('rollback')
  await expect(
    prisma!.$transaction(async (tx) => {
      await fn(tx)
      throw sentinel
    }),
  ).rejects.toThrow(sentinel)
}

type Tx = Omit<PrismaClient, '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>

async function seedLease(tx: Tx, suffix: string) {
  const facility = await tx.facility.create({
    data: {
      name: `Test ${suffix}`,
      slug: `test-${suffix}`,
      addressLine1: '1 Test St',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      timezone: 'America/Chicago',
    },
  })
  const unitType = await tx.unitType.create({
    data: {
      facilityId: facility.id,
      name: '10x10',
      widthFt: 10,
      lengthFt: 10,
      streetRateCents: 12_000,
      webRateCents: 10_900,
    },
  })
  const unit = await tx.unit.create({
    data: { facilityId: facility.id, unitTypeId: unitType.id, number: 'A100' },
  })
  const tenant = await tx.tenant.create({
    data: { email: `t-${suffix}@example.com`, firstName: 'Pat', lastName: 'Renter' },
  })
  return { facility, unit, tenant }
}

describe.skipIf(!hasDatabase)('database constraints', () => {
  it('allows at most one active lease per unit', async () => {
    await inRollbackTransaction(async (raw) => {
      const tx = raw as Tx
      const { facility, unit, tenant } = await seedLease(tx, 'one-active')
      const lease = {
        facilityId: facility.id,
        unitId: unit.id,
        tenantId: tenant.id,
        startDate: new Date(),
        monthlyRateCents: 10_900,
        billingDay: 1,
        status: 'active' as const,
      }

      await tx.lease.create({ data: lease })
      await expect(tx.lease.create({ data: lease })).rejects.toThrow()
    })
  })

  it('allows a new lease once the previous one has ended', async () => {
    await inRollbackTransaction(async (raw) => {
      const tx = raw as Tx
      const { facility, unit, tenant } = await seedLease(tx, 'after-ended')
      const lease = {
        facilityId: facility.id,
        unitId: unit.id,
        tenantId: tenant.id,
        startDate: new Date(),
        monthlyRateCents: 10_900,
        billingDay: 1,
      }

      await tx.lease.create({ data: { ...lease, status: 'ended' } })
      await expect(
        tx.lease.create({ data: { ...lease, status: 'active' } }),
      ).resolves.toBeTruthy()
    })
  })

  it('rejects a billing day that does not exist in every month', async () => {
    await inRollbackTransaction(async (raw) => {
      const tx = raw as Tx
      const { facility, unit, tenant } = await seedLease(tx, 'billing-day')

      await expect(
        tx.lease.create({
          data: {
            facilityId: facility.id,
            unitId: unit.id,
            tenantId: tenant.id,
            startDate: new Date(),
            monthlyRateCents: 10_900,
            billingDay: 31,
          },
        }),
      ).rejects.toThrow()
    })
  })

  it('requires a consent record to have exactly one subject', async () => {
    await inRollbackTransaction(async (raw) => {
      const tx = raw as Tx
      await expect(
        tx.consent.create({
          data: { channel: 'account_sms', state: 'granted', source: 'test' },
        }),
      ).rejects.toThrow()
    })
  })
})
