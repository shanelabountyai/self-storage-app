import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { effectiveByGroup } from '@storage/core/facility-settings'
import {
  isLowStock,
  margin,
  priceSale,
  saleProblem,
  settleTender,
  type SaleLineInput,
  type SaleProblem,
  type SaleTotals,
} from '@storage/core/pos'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { openSessionFor } from '@/lib/admin/drawer'

// PRD 02 US-34 (B-078). "Locks, boxes, packing supplies as SKU'd inventory
// per facility — price, tax category, stock count, low-stock alert — sellable
// standalone or attached to a move-in; simple COGS report."
//
// ── Why a merchandise sale is not an invoice ────────────────────────────────
//
// It is paid in full the moment it happens. It never ages, never dunns, never
// enters the allocation order and never appears on a statement. Routing it
// through `Invoice`/`LineItem` would force a fifth `REVENUE_CATEGORIES` entry,
// and that list's own comment explains why it is exactly the four the
// allocation order uses: "'how much rent did we collect' and 'where did this
// payment go' have to be the same question or the report cannot be reconciled
// against a tenant's ledger." Merchandise has no ledger to reconcile against,
// so it reports through its own COGS report instead — which is what US-34
// actually asks for.

function requireManage(actor: Actor, facilityId: string): void {
  assertFacilityAccess(actor, facilityId)
  if (!can(actor, 'merchandise:manage', facilityId)) {
    throw new ForbiddenError('Missing permission merchandise:manage', 'merchandise:manage', facilityId)
  }
}

function requireSell(actor: Actor, facilityId: string): void {
  assertFacilityAccess(actor, facilityId)
  // Selling a lock is counter work; pricing it is not. `payments:take` is the
  // right key because a sale IS a payment.
  if (!can(actor, 'payments:take', facilityId)) {
    throw new ForbiddenError('Missing permission payments:take', 'payments:take', facilityId)
  }
}

export type ProductRow = {
  id: string
  sku: string
  name: string
  priceCents: number
  unitCostCents: number
  taxable: boolean
  stockCount: number
  lowStockAt: number | null
  active: boolean
  lowStock: boolean
}

export async function facilityProducts(
  actor: Actor,
  facilityId: string,
  options: { includeInactive?: boolean } = {},
): Promise<ProductRow[]> {
  assertFacilityAccess(actor, facilityId)
  const rows = await prisma.product.findMany({
    where: { facilityId, ...(options.includeInactive ? {} : { active: true }) },
    orderBy: { sku: 'asc' },
  })
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    priceCents: row.priceCents,
    unitCostCents: row.unitCostCents,
    taxable: row.taxable,
    stockCount: row.stockCount,
    lowStockAt: row.lowStockAt,
    active: row.active,
    lowStock: isLowStock(row.stockCount, row.lowStockAt),
  }))
}

export type UpsertProductInput = {
  id?: string
  sku: string
  name: string
  priceCents: number
  unitCostCents: number
  taxable: boolean
  lowStockAt: number | null
  active: boolean
}

export type ProductResult = { ok: true; id: string } | { ok: false; reason: string }

/// Creates or edits a product. Stock is deliberately NOT settable here — it
/// moves through `adjustStock` (audited, reason-coded) or a sale, so there is
/// no path where a count changes with no record of why.
export async function upsertProduct(
  actor: Actor,
  facilityId: string,
  input: UpsertProductInput,
): Promise<ProductResult> {
  requireManage(actor, facilityId)

  const sku = input.sku.trim()
  if (!sku) return { ok: false, reason: 'Give the product a SKU.' }
  if (!input.name.trim()) return { ok: false, reason: 'Give the product a name.' }
  if (input.priceCents < 0 || input.unitCostCents < 0) {
    return { ok: false, reason: 'Price and cost cannot be negative.' }
  }

  const clash = await prisma.product.findFirst({
    where: { facilityId, sku, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  })
  if (clash) return { ok: false, reason: `SKU ${sku} is already used at this facility.` }

  const data = {
    sku,
    name: input.name.trim(),
    priceCents: input.priceCents,
    unitCostCents: input.unitCostCents,
    taxable: input.taxable,
    lowStockAt: input.lowStockAt,
    active: input.active,
  }

  const saved = input.id
    ? await prisma.product.update({ where: { id: input.id }, data })
    : await prisma.product.create({ data: { facilityId, ...data } })

  return { ok: true, id: saved.id }
}

/// US-34's stock movement that is not a sale: a delivery, a breakage, a
/// recount. Reason-coded because there is no transaction explaining it —
/// an unexplained inventory adjustment is how shrinkage gets papered over.
export async function adjustStock(
  actor: Actor,
  productId: string,
  delta: number,
  reasonCode: string,
): Promise<ProductResult> {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } })
  requireManage(actor, product.facilityId)

  if (!Number.isInteger(delta) || delta === 0) return { ok: false, reason: 'Enter how many to add or remove.' }
  if (!reasonCode.trim()) return { ok: false, reason: 'Say why the count is changing.' }

  const next = product.stockCount + delta
  if (next < 0) return { ok: false, reason: 'That would take the count below zero.' }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: productId }, data: { stockCount: next } })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: product.facilityId,
        action: 'merchandise.stock_adjusted',
        entityType: 'Product',
        entityId: productId,
        reasonCode: reasonCode.trim(),
        context: { sku: product.sku, from: product.stockCount, to: next, delta },
      },
      tx,
    )
  })

  return { ok: true, id: productId }
}

export type SellInput = {
  facilityId: string
  lines: { productId: string; quantity: number }[]
  method: 'cash' | 'check' | 'money_order' | 'card'
  tenderedCents?: number
  checkNumber?: string
  /// Optional: a known tenant rather than a walk-in.
  tenantId?: string
}

export type SellResult =
  /// `changeCents` is null for a cheque or money order — `settleTender`
  /// refuses to invent change for one, because an overpaid cheque produces a
  /// credit on the ledger rather than notes out of the drawer.
  | { ok: true; saleId: string; totals: SaleTotals; changeCents: number | null; receiptNumber: number }
  | { ok: false; problem: SaleProblem | 'card_not_supported' | 'tender' | 'no_product' | 'tenant_required' }

/// The facility's combined tax rate in basis points, from the same
/// effective-dated components invoicing uses — merchandise does not get a
/// second tax model.
async function taxBasisPointsFor(facilityId: string, asOf: Date): Promise<number> {
  const rows = await prisma.taxComponent.findMany({ where: { facilityId } })
  const current = effectiveByGroup(rows, asOf, (row) => row.jurisdiction)
  return [...current.values()].reduce((sum, row) => sum + row.rateBasisPoints, 0)
}

/// Sells merchandise over the counter. One transaction: the payment, the
/// sale, its lines, and the stock decrement — so a sale can never record
/// without moving stock, and stock can never move without a paid sale.
export async function sellMerchandise(actor: Actor, input: SellInput): Promise<SellResult> {
  requireSell(actor, input.facilityId)
  if (actor.kind !== 'staff') return { ok: false, problem: 'card_not_supported' }
  // Same limitation the counter payment path has: no terminal integration
  // exists, so a card sale has nothing to charge against.
  if (input.method === 'card') return { ok: false, problem: 'card_not_supported' }

  const productIds = input.lines.map((line) => line.productId)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, facilityId: input.facilityId, active: true },
  })
  if (products.length !== new Set(productIds).size || products.length === 0) {
    return { ok: false, problem: 'no_product' }
  }
  const byId = new Map(products.map((product) => [product.id, product]))

  const withStock = input.lines.map((line) => {
    const product = byId.get(line.productId)!
    return {
      productId: line.productId,
      quantity: line.quantity,
      unitPriceCents: product.priceCents,
      unitCostCents: product.unitCostCents,
      taxable: product.taxable,
      stockCount: product.stockCount,
    }
  })

  const problem = saleProblem(withStock)
  if (problem) return { ok: false, problem }

  const now = new Date()
  const totals = priceSale(withStock as SaleLineInput[], await taxBasisPointsFor(input.facilityId, now))

  const settled = settleTender({
    method: input.method,
    amountCents: totals.totalCents,
    tenderedCents: input.tenderedCents,
    checkNumber: input.checkNumber,
  })
  if (!settled.ok) return { ok: false, problem: 'tender' }

  // US-34 says "sellable standalone", and this is where that stops short:
  // `Payment.tenantId` is required, so every sale must name a tenant. A true
  // anonymous walk-in buying a lock has nowhere to post — refused explicitly
  // rather than papered over with a placeholder tenant, which would put a
  // fake customer in the tenant list to sell a $12 padlock. See PROGRESS.md.
  if (!input.tenantId) return { ok: false, problem: 'tenant_required' }

  const drawerSession = await openSessionFor(input.facilityId)

  const result = await prisma.$transaction(async (tx) => {
    const counter = await tx.$queryRaw<{ nextNumber: number }[]>`
      INSERT INTO "receipt_counter" ("facilityId", "nextNumber", "updatedAt")
      VALUES (${input.facilityId}, 2, NOW())
      ON CONFLICT ("facilityId") DO UPDATE SET "nextNumber" = "receipt_counter"."nextNumber" + 1, "updatedAt" = NOW()
      RETURNING "nextNumber"
    `
    const receiptNumber = counter[0].nextNumber - 1

    const payment = await tx.payment.create({
      data: {
        facilityId: input.facilityId,
        tenantId: input.tenantId!,
        amountCents: totals.totalCents,
        method: input.method,
        status: 'succeeded',
        tenderedCents: settled.tenderedCents,
        changeCents: settled.changeCents,
        checkNumber: input.checkNumber?.trim() || null,
        receivedByStaffId: actor.staffUserId,
        receiptNumber,
        drawerSessionId: drawerSession?.id ?? null,
      },
    })

    const sale = await tx.merchandiseSale.create({
      data: {
        facilityId: input.facilityId,
        paymentId: payment.id,
        tenantId: input.tenantId ?? null,
        soldByStaffId: actor.staffUserId,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        costCents: totals.costCents,
        occurredAt: now,
        lines: {
          create: totals.lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            unitCostCents: line.unitCostCents,
            lineTotalCents: line.lineTotalCents,
          })),
        },
      },
    })

    for (const line of totals.lines) {
      await tx.product.update({
        where: { id: line.productId },
        data: { stockCount: { decrement: line.quantity } },
      })
    }

    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: input.facilityId,
        action: 'merchandise.sold',
        entityType: 'MerchandiseSale',
        entityId: sale.id,
        context: {
          receiptNumber,
          totalCents: totals.totalCents,
          costCents: totals.costCents,
          lines: totals.lines.length,
        },
      },
      tx,
    )

    return { saleId: sale.id, receiptNumber }
  })

  return {
    ok: true,
    saleId: result.saleId,
    totals,
    changeCents: settled.changeCents,
    receiptNumber: result.receiptNumber,
  }
}

export type MerchandiseReport = {
  rows: { sku: string; name: string; quantity: number; revenueCents: number; costCents: number }[]
  revenueCents: number
  costCents: number
  marginCents: number
  /// Null when nothing sold — 0% margin reads as selling at cost, and "no
  /// sales this month" is not that.
  marginRatio: number | null
  taxCents: number
}

/// US-34's "simple COGS report", per product over a date range.
export async function merchandiseReport(
  actor: Actor,
  facilityId: string,
  from: Date,
  to: Date,
): Promise<MerchandiseReport> {
  assertFacilityAccess(actor, facilityId)
  if (!can(actor, 'reports:financial', facilityId)) {
    throw new ForbiddenError('Missing permission reports:financial', 'reports:financial', facilityId)
  }

  const sales = await prisma.merchandiseSale.findMany({
    where: { facilityId, occurredAt: { gte: from, lt: to } },
    include: { lines: { include: { product: { select: { sku: true, name: true } } } } },
  })

  const byProduct = new Map<string, { sku: string; name: string; quantity: number; revenueCents: number; costCents: number }>()
  let taxCents = 0

  for (const sale of sales) {
    taxCents += sale.taxCents
    for (const line of sale.lines) {
      const key = line.productId
      const row = byProduct.get(key) ?? {
        sku: line.product.sku,
        name: line.product.name,
        quantity: 0,
        revenueCents: 0,
        costCents: 0,
      }
      row.quantity += line.quantity
      row.revenueCents += line.lineTotalCents
      row.costCents += line.unitCostCents * line.quantity
      byProduct.set(key, row)
    }
  }

  const rows = [...byProduct.values()].sort((a, b) => b.revenueCents - a.revenueCents)
  // Every figure from the core module, never computed here — §4.11's rule.
  const totals = margin(rows)

  return { rows, ...totals, taxCents }
}
