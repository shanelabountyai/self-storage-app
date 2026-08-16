import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { leaseLedger } from '../apps/web/lib/admin/ledger'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-049 / PRD 02 US-24. The ledger against real rows, and its reconciliation.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let otherFacilityId = ''
let tenantId = ''
let leaseId = ''
let unitTypeId = ''
let invoiceCounter = 0

const d = (iso: string) => new Date(`${iso}T12:00:00.000Z`)

function actorAt(facility: string, permissions: PermissionKey[] = ['tenants:view']): Actor {
  return {
    kind: 'staff',
    staffUserId: 'staff-ledger',
    assignments: [
      {
        facilityId: facility,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set<PermissionKey>(permissions),
        limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
      },
    ],
  }
}

async function charge(amountCents: number, on: Date, withInvoice: boolean): Promise<void> {
  let invoiceId: string | undefined
  if (withInvoice) {
    invoiceCounter += 1
    const invoice = await prisma.invoice.create({
      data: {
        facilityId,
        leaseId,
        number: `LG${String(invoiceCounter).padStart(5, '0')}`,
        kind: 'rent',
        status: 'open',
        issueDate: on,
        dueDate: on,
        periodStart: on,
        periodEnd: new Date(on.getTime() + 30 * 86_400_000),
        subtotalCents: amountCents,
        totalCents: amountCents,
      },
    })
    invoiceId = invoice.id
  }
  await prisma.ledgerEntry.create({
    data: { facilityId, leaseId, type: 'charge', amountCents, description: 'Rent', occurredAt: on, invoiceId },
  })
}

describeDb('tenant ledger', () => {
  beforeAll(async () => {
    const [facility, other] = await Promise.all([
      prisma.facility.create({
        data: {
          name: 'Ledger Test',
          slug: `ledger-${suffix}`,
          addressLine1: '1 Storage Way',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      }),
      prisma.facility.create({
        data: {
          name: 'Ledger Other',
          slug: `ledger-other-${suffix}`,
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

    const tenant = await prisma.tenant.create({
      data: { email: `ledger-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'L-1' } })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: d('2026-08-01'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  afterEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  it('reads every entry in date order with a running balance', async () => {
    await charge(12_900, d('2026-09-01'), true)
    await prisma.ledgerEntry.create({
      data: { facilityId, leaseId, type: 'payment', amountCents: -5_000, description: 'Payment', occurredAt: d('2026-09-05') },
    })

    const ledger = await leaseLedger(actorAt(facilityId), leaseId)
    expect(ledger!.lines.map((line) => line.balanceCents)).toEqual([12_900, 7_900])
    expect(ledger!.totals.balanceCents).toBe(7_900)
  })

  it('names the invoice an entry belongs to', async () => {
    await charge(12_900, d('2026-09-01'), true)
    const ledger = await leaseLedger(actorAt(facilityId), leaseId)
    expect(ledger!.lines[0].invoiceNumber).toMatch(/^LG/)
  })

  it('reconciles a lease whose ledger matches its invoices', async () => {
    await charge(12_900, d('2026-09-01'), true)
    const ledger = await leaseLedger(actorAt(facilityId), leaseId)
    expect(ledger!.reconciliation.reconciles).toBe(true)
  })

  it('reconciles a move-in charge that never became an invoice', async () => {
    // B-026 posts the opening charge before invoicing exists. Calling that a
    // discrepancy would cry wolf on every tenant who ever moved in.
    await charge(20_000, d('2026-08-01'), false)
    const ledger = await leaseLedger(actorAt(facilityId), leaseId)
    expect(ledger!.reconciliation.reconciles).toBe(true)
  })

  it('reconciles once that move-in charge is paid', async () => {
    await charge(20_000, d('2026-08-01'), false)
    await prisma.ledgerEntry.create({
      data: { facilityId, leaseId, type: 'payment', amountCents: -20_000, description: 'Move-in payment', occurredAt: d('2026-08-01') },
    })
    const ledger = await leaseLedger(actorAt(facilityId), leaseId)
    expect(ledger!.totals.balanceCents).toBe(0)
    expect(ledger!.reconciliation.reconciles).toBe(true)
  })

  it('reports a real discrepancy with its likely cause', async () => {
    // An invoice raised with no ledger charge behind it — the shape a bug in a
    // future billing path would take.
    invoiceCounter += 1
    await prisma.invoice.create({
      data: {
        facilityId,
        leaseId,
        number: `LG${String(invoiceCounter).padStart(5, '0')}`,
        kind: 'rent',
        status: 'open',
        issueDate: d('2026-09-01'),
        dueDate: d('2026-09-01'),
        periodStart: d('2026-09-01'),
        periodEnd: d('2026-10-01'),
        subtotalCents: 12_900,
        totalCents: 12_900,
      },
    })

    const ledger = await leaseLedger(actorAt(facilityId), leaseId)
    expect(ledger!.reconciliation.reconciles).toBe(false)
    expect(ledger!.reconciliation.differenceCents).toBe(-12_900)
    expect(ledger!.reconciliation.explanation).toContain('wrong lease')
  })

  it('refuses a staffer with no access to the lease’s facility', async () => {
    await expect(leaseLedger(actorAt(otherFacilityId), leaseId)).rejects.toThrow()
  })

  it('refuses a staffer without tenants:view', async () => {
    await expect(
      leaseLedger(actorAt(facilityId, ['units:edit']), leaseId),
    ).rejects.toThrow(ForbiddenError)
  })

  it('returns null for a lease that does not exist', async () => {
    expect(await leaseLedger(actorAt(facilityId), 'no-such-lease')).toBeNull()
  })
})
