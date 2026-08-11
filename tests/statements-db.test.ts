import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  leaseStatement,
  staffStatementsForLease,
  statementsForTenant,
  tenantOwnsLease,
} from '../apps/web/lib/billing/statements'
import { reconciles } from '../packages/core/billing'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-102 / PRD 01 US-705, against real ledger rows. The pure suite proves the
// arithmetic; this proves the boundaries — which entries fall in which month at
// a facility that is not on UTC, and that a lease id in a URL cannot be used to
// read somebody else's money.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let otherFacilityId = ''
let tenantId = ''
let otherTenantId = ''
let leaseId = ''
let otherLeaseId = ''
let staffId = ''

function actor(facilityIds: (string | null)[] = [facilityId]): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: facilityIds.map((id) => ({
      facilityId: id,
      roleKey: 'manager',
      rank: 20,
      permissions: new Set(['tenants:view'] as never),
      limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
    })),
  }
}

async function entry(input: {
  leaseId?: string
  type: 'charge' | 'payment' | 'credit' | 'refund' | 'adjustment' | 'write_off'
  amountCents: number
  occurredAt: string
  description?: string
}) {
  await prisma.ledgerEntry.create({
    data: {
      facilityId,
      leaseId: input.leaseId ?? leaseId,
      type: input.type,
      amountCents: input.amountCents,
      description: input.description ?? `${input.type} ${suffix}`,
      occurredAt: new Date(input.occurredAt),
    },
  })
}

describeDb('monthly statements (US-705)', () => {
  beforeAll(async () => {
    const staff = await prisma.staffUser.create({
      data: { email: `st-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const facility = await prisma.facility.create({
      data: {
        name: `Statements ${suffix}`,
        slug: `statements-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        // Deliberately NOT UTC: the month boundary is the whole point.
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const other = await prisma.facility.create({
      data: {
        name: `Statements other ${suffix}`,
        slug: `statements-other-${suffix}`,
        addressLine1: '2 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    otherFacilityId = other.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `S-${suffix.slice(0, 4)}` },
    })
    const unit2 = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `S2-${suffix.slice(0, 4)}` },
    })

    const tenant = await prisma.tenant.create({
      data: { email: `st-t-${suffix}@example.com`, firstName: 'Priya', lastName: 'Books' },
    })
    tenantId = tenant.id

    const otherTenant = await prisma.tenant.create({
      data: { email: `st-o-${suffix}@example.com`, firstName: 'Otto', lastName: 'Other' },
    })
    otherTenantId = otherTenant.id

    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id

    const otherLease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId: otherTenant.id,
        unitId: unit2.id,
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00Z'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    otherLeaseId = otherLease.id
  })

  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
    // Facilities and staff stay: `audit_log` RESTRICT-references the facility.
  })

  it('reconciles a month of real entries', async () => {
    await entry({ type: 'charge', amountCents: 12_900, occurredAt: '2026-08-01T12:00:00Z' })
    await entry({ type: 'payment', amountCents: -12_900, occurredAt: '2026-08-03T18:00:00Z' })

    const statement = await leaseStatement({ leaseId, year: 2026, month: 8 })
    expect(reconciles(statement)).toBe(true)
    expect(statement.openingBalanceCents).toBe(0)
    expect(statement.closingBalanceCents).toBe(0)
    expect(statement.lines).toHaveLength(2)
  })

  it('carries the previous months forward as the opening balance', async () => {
    await entry({ type: 'charge', amountCents: 12_900, occurredAt: '2026-06-01T12:00:00Z' })
    await entry({ type: 'charge', amountCents: 12_900, occurredAt: '2026-07-01T12:00:00Z' })
    await entry({ type: 'payment', amountCents: -12_900, occurredAt: '2026-07-05T12:00:00Z' })
    await entry({ type: 'charge', amountCents: 12_900, occurredAt: '2026-08-01T12:00:00Z' })

    const august = await leaseStatement({ leaseId, year: 2026, month: 8 })
    // June's unpaid rent is the whole opening balance; July's charge and
    // payment cancelled.
    expect(august.openingBalanceCents).toBe(12_900)
    expect(august.closingBalanceCents).toBe(25_800)
    expect(august.lines).toHaveLength(1)
  })

  it('puts a late-evening entry in the month it happened LOCALLY', async () => {
    // 31 August at 8pm in Chicago is 1 September 01:00 UTC. A UTC month
    // boundary would file this tenant's payment in the wrong month — the same
    // mistake B-078's deposits report shipped with, and on a document going to
    // an accountant.
    await entry({ type: 'payment', amountCents: -5_000, occurredAt: '2026-09-01T01:00:00Z' })

    const august = await leaseStatement({ leaseId, year: 2026, month: 8 })
    const september = await leaseStatement({ leaseId, year: 2026, month: 9 })

    expect(august.lines).toHaveLength(1)
    expect(september.lines).toHaveLength(0)
    expect(august.closingBalanceCents).toBe(-5_000)
    expect(september.openingBalanceCents).toBe(-5_000)
  })

  it('hands every entry to exactly one month', async () => {
    // A gap loses an entry; an overlap counts it twice. Either breaks the
    // reconciliation between one month's close and the next month's open.
    for (const day of ['2026-08-01T05:00:00Z', '2026-08-15T12:00:00Z', '2026-09-01T04:59:59Z']) {
      await entry({ type: 'charge', amountCents: 1_000, occurredAt: day })
    }

    const july = await leaseStatement({ leaseId, year: 2026, month: 7 })
    const august = await leaseStatement({ leaseId, year: 2026, month: 8 })
    const september = await leaseStatement({ leaseId, year: 2026, month: 9 })

    expect(july.lines.length + august.lines.length + september.lines.length).toBe(3)
    expect(august.lines).toHaveLength(3)
    expect(august.closingBalanceCents).toBe(september.openingBalanceCents)
    expect(july.closingBalanceCents).toBe(august.openingBalanceCents)
  })

  it('returns an empty but valid statement for a quiet month', async () => {
    await entry({ type: 'charge', amountCents: 12_900, occurredAt: '2026-06-01T12:00:00Z' })

    const july = await leaseStatement({ leaseId, year: 2026, month: 7 })
    expect(july.lines).toEqual([])
    expect(july.openingBalanceCents).toBe(12_900)
    expect(july.closingBalanceCents).toBe(12_900)
    expect(reconciles(july)).toBe(true)
  })

  it('never mixes two leases at the same facility', async () => {
    await entry({ type: 'charge', amountCents: 12_900, occurredAt: '2026-08-01T12:00:00Z' })
    await entry({
      leaseId: otherLeaseId,
      type: 'charge',
      amountCents: 99_900,
      occurredAt: '2026-08-01T12:00:00Z',
    })

    const statement = await leaseStatement({ leaseId, year: 2026, month: 8 })
    expect(statement.lines).toHaveLength(1)
    expect(statement.closingBalanceCents).toBe(12_900)
  })

  it('lists a month per lease month for the tenant', async () => {
    const summaries = await statementsForTenant(tenantId, new Date('2026-08-10T12:00:00Z'))
    expect(summaries.map((summary) => summary.label)).toEqual([
      'August 2026',
      'July 2026',
      'June 2026',
    ])
    expect(summaries.every((summary) => summary.leaseId === leaseId)).toBe(true)
  })

  describe('scoping', () => {
    it('refuses a lease that belongs to another tenant', async () => {
      // The portal takes the lease id from the URL, and a statement is a full
      // month of somebody's financial history.
      expect(await tenantOwnsLease(tenantId, otherLeaseId)).toBe(false)
      expect(await tenantOwnsLease(tenantId, leaseId)).toBe(true)
    })

    it('lets staff at the facility list the months', async () => {
      const result = await staffStatementsForLease(actor(), leaseId, new Date('2026-08-10T12:00:00Z'))
      expect(result?.tenantId).toBe(tenantId)
      expect(result?.months).toHaveLength(3)
    })

    it('refuses staff with no assignment at that facility', async () => {
      // The ledger is scoped this way; a statement reached by a different URL
      // must not be a way around it.
      await expect(staffStatementsForLease(actor([otherFacilityId]), leaseId)).rejects.toThrow()
    })

    it('refuses staff who hold the facility but not tenants:view', async () => {
      const noRead: Actor = {
        kind: 'staff',
        staffUserId: staffId,
        assignments: [
          {
            facilityId,
            roleKey: 'counter',
            rank: 10,
            permissions: new Set(['payments:take'] as never),
            limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
          },
        ],
      }
      await expect(staffStatementsForLease(noRead, leaseId)).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
