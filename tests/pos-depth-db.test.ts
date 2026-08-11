import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { closeDrawer, drawerView, openDrawer, openSessionFor } from '../apps/web/lib/admin/drawer'
import { recordCounterPayment } from '../apps/web/lib/admin/pos'
import { adjustStock, facilityProducts, merchandiseReport, sellMerchandise, upsertProduct } from '../apps/web/lib/admin/merchandise'
import { depositsReport } from '../apps/web/lib/admin/deposits-report'
import type { Actor } from '../apps/web/lib/rbac/actor'

// B-078 / PRD 02 US-33, US-34, US-39.6, against real rows.
//
// The properties worth a database: cash posts to the open session and card
// does not, a close-out snapshots what it counted, an unexplained variance is
// refused, stock moves only with a sale or an audited adjustment, and the
// deposits report shows money taken with no session as unreconciled.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let staffId = ''
let tenantId = ''
let leaseId = ''

const PERMISSIONS = [
  'payments:take',
  'drawer:manage',
  'merchandise:manage',
  'tenants:view',
  'reports:financial',
]

function actorWith(rank: number, permissions: string[] = PERMISSIONS): Actor {
  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: [
      {
        facilityId,
        roleKey: rank >= 20 ? 'manager' : 'counter',
        rank,
        permissions: new Set(permissions as never),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  }
}

const manager = () => actorWith(20)
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describeDb('POS depth (US-33 / US-34 / US-39.6)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `POS Depth ${suffix}`,
        slug: `pos-depth-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        drawerVarianceThresholdCents: 500,
        cashApprovalThresholdCents: 500_000,
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `pd-${suffix}@example.com`, firstName: 'Mo', lastName: 'Manager' },
    })
    staffId = staff.id

    const tenant = await prisma.tenant.create({
      data: { email: `pd-t-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    const unit = await prisma.unit.create({
      data: { facilityId, unitTypeId: unitType.id, number: `P-${suffix.slice(0, 4)}` },
    })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: d('2026-01-01'),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  afterEach(async () => {
    await prisma.merchandiseSaleLine.deleteMany({ where: { sale: { facilityId } } })
    await prisma.merchandiseSale.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.drawerSession.deleteMany({ where: { facilityId } })
    await prisma.product.deleteMany({ where: { facilityId } })
    await prisma.facility.update({
      where: { id: facilityId },
      data: { drawerVarianceThresholdCents: 500 },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    // Facility and staff stay: `audit_log` is append-only and
    // RESTRICT-references the facility.
    await prisma.merchandiseSaleLine.deleteMany({ where: { sale: { facilityId } } })
    await prisma.merchandiseSale.deleteMany({ where: { facilityId } })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId } } })
    await prisma.payment.deleteMany({ where: { facilityId } })
    await prisma.drawerSession.deleteMany({ where: { facilityId } })
    await prisma.product.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  async function takeCash(amountCents: number, tenderedCents = amountCents) {
    return recordCounterPayment(manager(), {
      facilityId,
      tenantId,
      leaseId,
      amountCents,
      method: 'cash',
      tenderedCents,
    })
  }

  describe('drawer sessions (US-33)', () => {
    it('opens with a counted float', async () => {
      const result = await openDrawer(manager(), facilityId, 20_000)
      expect(result.ok).toBe(true)

      const session = await openSessionFor(facilityId)
      expect(session?.openingFloatCents).toBe(20_000)
      expect(session?.status).toBe('open')
    })

    it('refuses a second open drawer at the same facility', async () => {
      await openDrawer(manager(), facilityId, 20_000)
      const second = await openDrawer(manager(), facilityId, 10_000)
      expect(second).toMatchObject({ ok: false, problem: 'already_open' })
    })

    it('posts cash to the open session', async () => {
      const opened = await openDrawer(manager(), facilityId, 20_000)
      if (!opened.ok) throw new Error('unreachable')
      const paid = await takeCash(5_000)
      expect(paid.ok).toBe(true)

      const payment = await prisma.payment.findFirstOrThrow({ where: { facilityId, method: 'cash' } })
      expect(payment.drawerSessionId).toBe(opened.sessionId)
    })

    it('records a payment taken with no drawer open, rather than refusing it', async () => {
      const paid = await takeCash(5_000)
      expect(paid.ok).toBe(true)
      const payment = await prisma.payment.findFirstOrThrow({ where: { facilityId, method: 'cash' } })
      expect(payment.drawerSessionId).toBeNull()
    })

    it('expects float plus cash, with change already netted', async () => {
      const opened = await openDrawer(manager(), facilityId, 20_000)
      if (!opened.ok) throw new Error('unreachable')
      // $60 bill paid with a $100 note: the drawer is up $60.
      await takeCash(6_000, 10_000)

      const view = await drawerView(manager(), opened.sessionId)
      expect(view.slip.expectedCashCents).toBe(26_000)
      expect(view.slip.changeGivenCents).toBe(4_000)
    })

    it('closes with a count and snapshots what it expected', async () => {
      const opened = await openDrawer(manager(), facilityId, 20_000)
      if (!opened.ok) throw new Error('unreachable')
      await takeCash(5_000)

      const closed = await closeDrawer(manager(), opened.sessionId, {
        countedCashCents: 25_000,
        countedChecksCents: 0,
        note: '',
      })
      expect(closed).toMatchObject({ ok: true, varianceCents: 0 })

      const session = await prisma.drawerSession.findUniqueOrThrow({ where: { id: opened.sessionId } })
      expect(session.status).toBe('closed')
      expect(session.expectedCashCents).toBe(25_000)
      expect(session.countedCashCents).toBe(25_000)
      expect(session.varianceCents).toBe(0)
    })

    it('refuses a close that is out past the threshold with no note', async () => {
      const opened = await openDrawer(manager(), facilityId, 20_000)
      if (!opened.ok) throw new Error('unreachable')

      const closed = await closeDrawer(manager(), opened.sessionId, {
        countedCashCents: 18_000,
        countedChecksCents: 0,
        note: '',
      })
      expect(closed).toMatchObject({ ok: false, problem: 'note_required' })

      // Still open — a refused close changes nothing.
      expect((await openSessionFor(facilityId))?.id).toBe(opened.sessionId)
    })

    it('allows the same close once explained, and audits the variance', async () => {
      const opened = await openDrawer(manager(), facilityId, 20_000)
      if (!opened.ok) throw new Error('unreachable')

      const closed = await closeDrawer(manager(), opened.sessionId, {
        countedCashCents: 18_000,
        countedChecksCents: 0,
        note: 'two twenties missing, till left unlocked at lunch',
      })
      expect(closed).toMatchObject({ ok: true, varianceCents: -2_000 })

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'drawer.over_short', entityId: opened.sessionId },
      })
      expect(audit.reasonCode).toContain('two twenties')
    })

    it('allows a small variance with no note', async () => {
      const opened = await openDrawer(manager(), facilityId, 20_000)
      if (!opened.ok) throw new Error('unreachable')
      const closed = await closeDrawer(manager(), opened.sessionId, {
        countedCashCents: 19_800,
        countedChecksCents: 0,
        note: '',
      })
      expect(closed).toMatchObject({ ok: true, varianceCents: -200 })
    })

    it('lets a new drawer open once the last one closed', async () => {
      const first = await openDrawer(manager(), facilityId, 20_000)
      if (!first.ok) throw new Error('unreachable')
      await closeDrawer(manager(), first.sessionId, {
        countedCashCents: 20_000,
        countedChecksCents: 0,
        note: '',
      })
      expect((await openDrawer(manager(), facilityId, 15_000)).ok).toBe(true)
    })

    it('refuses staff without drawer:manage', async () => {
      const counter = actorWith(10, ['payments:take', 'tenants:view'])
      await expect(openDrawer(counter, facilityId, 20_000)).rejects.toThrow()
    })
  })

  describe('merchandise (US-34)', () => {
    async function makeProduct(overrides: Partial<{ sku: string; priceCents: number; unitCostCents: number; lowStockAt: number | null }> = {}) {
      const result = await upsertProduct(manager(), facilityId, {
        sku: overrides.sku ?? `LOCK-${suffix}`,
        name: 'Disc lock',
        priceCents: overrides.priceCents ?? 1_299,
        unitCostCents: overrides.unitCostCents ?? 650,
        taxable: true,
        lowStockAt: overrides.lowStockAt ?? 2,
        active: true,
      })
      if (!result.ok) throw new Error(result.reason)
      await adjustStock(manager(), result.id, 10, 'opening delivery')
      return result.id
    }

    it('adds a product and stocks it through an audited adjustment', async () => {
      const productId = await makeProduct()
      const products = await facilityProducts(manager(), facilityId)
      expect(products[0].stockCount).toBe(10)

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'merchandise.stock_adjusted', entityId: productId },
      })
      expect(audit.reasonCode).toBe('opening delivery')
    })

    it('refuses a stock adjustment with no reason', async () => {
      const productId = await makeProduct()
      expect(await adjustStock(manager(), productId, 5, '  ')).toMatchObject({ ok: false })
    })

    it('refuses a duplicate SKU at the same facility', async () => {
      await makeProduct({ sku: `DUP-${suffix}` })
      const again = await upsertProduct(manager(), facilityId, {
        sku: `DUP-${suffix}`,
        name: 'Another',
        priceCents: 100,
        unitCostCents: 50,
        taxable: true,
        lowStockAt: null,
        active: true,
      })
      expect(again).toMatchObject({ ok: false })
    })

    it('sells, decrements stock and snapshots the COGS', async () => {
      const productId = await makeProduct()
      const sale = await sellMerchandise(manager(), {
        facilityId,
        lines: [{ productId, quantity: 2 }],
        method: 'cash',
        tenderedCents: 5_000,
        tenantId,
      })
      expect(sale.ok).toBe(true)
      if (!sale.ok) throw new Error('unreachable')

      expect(sale.totals.subtotalCents).toBe(2_598)
      expect(sale.totals.costCents).toBe(1_300)

      const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
      expect(product.stockCount).toBe(8)

      const row = await prisma.merchandiseSale.findUniqueOrThrow({ where: { id: sale.saleId } })
      expect(row.costCents).toBe(1_300)
      expect(row.paymentId).toBeTruthy()
    })

    it('posts the sale to the open drawer', async () => {
      const opened = await openDrawer(manager(), facilityId, 10_000)
      if (!opened.ok) throw new Error('unreachable')
      const productId = await makeProduct()
      await sellMerchandise(manager(), {
        facilityId,
        lines: [{ productId, quantity: 1 }],
        method: 'cash',
        tenderedCents: 2_000,
        tenantId,
      })

      const view = await drawerView(manager(), opened.sessionId)
      expect(view.slip.expectedCashCents).toBe(10_000 + 1_299)
    })

    it('refuses to sell more than is in stock, and moves nothing', async () => {
      const productId = await makeProduct()
      const sale = await sellMerchandise(manager(), {
        facilityId,
        lines: [{ productId, quantity: 99 }],
        method: 'cash',
        tenderedCents: 500_000,
        tenantId,
      })
      expect(sale).toMatchObject({ ok: false, problem: 'insufficient_stock' })

      const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
      expect(product.stockCount).toBe(10)
    })

    it('refuses a card sale — there is no terminal', async () => {
      const productId = await makeProduct()
      const sale = await sellMerchandise(manager(), {
        facilityId,
        lines: [{ productId, quantity: 1 }],
        method: 'card',
        tenantId,
      })
      expect(sale).toMatchObject({ ok: false, problem: 'card_not_supported' })
    })

    it('reports revenue, cost and margin per product', async () => {
      const productId = await makeProduct()
      await sellMerchandise(manager(), {
        facilityId,
        lines: [{ productId, quantity: 2 }],
        method: 'cash',
        tenderedCents: 5_000,
        tenantId,
      })

      const report = await merchandiseReport(
        manager(),
        facilityId,
        d('2020-01-01'),
        d('2100-01-01'),
      )
      expect(report.rows).toHaveLength(1)
      expect(report.revenueCents).toBe(2_598)
      expect(report.costCents).toBe(1_300)
      expect(report.marginCents).toBe(1_298)
    })

    it('flags low stock at or below the threshold', async () => {
      const productId = await makeProduct({ lowStockAt: 9 })
      await sellMerchandise(manager(), {
        facilityId,
        lines: [{ productId, quantity: 1 }],
        method: 'cash',
        tenderedCents: 2_000,
        tenantId,
      })
      const products = await facilityProducts(manager(), facilityId)
      expect(products[0].lowStock).toBe(true)
    })
  })

  describe('deposits reconciliation (US-39.6)', () => {
    it('shows recorded cash against what was counted', async () => {
      const opened = await openDrawer(manager(), facilityId, 20_000)
      if (!opened.ok) throw new Error('unreachable')
      await takeCash(5_000)
      await closeDrawer(manager(), opened.sessionId, {
        countedCashCents: 24_800,
        countedChecksCents: 0,
        note: '',
      })

      const report = await depositsReport(manager(), d('2020-01-01'), d('2100-01-01'), facilityId)
      const row = report.rows.find((r) => r.cashRecordedCents > 0)
      expect(row?.cashRecordedCents).toBe(5_000)
      expect(row?.countedCashCents).toBe(24_800)
      expect(row?.varianceCents).toBe(-200)
    })

    it('flags cash taken with no drawer session as unreconciled', async () => {
      await takeCash(7_500)

      const report = await depositsReport(manager(), d('2020-01-01'), d('2100-01-01'), facilityId)
      expect(report.totalUnreconciledCents).toBe(7_500)
    })

    it('reports nothing unreconciled once a session is open', async () => {
      await openDrawer(manager(), facilityId, 20_000)
      await takeCash(7_500)

      const report = await depositsReport(manager(), d('2020-01-01'), d('2100-01-01'), facilityId)
      expect(report.totalUnreconciledCents).toBe(0)
    })
  })
})
