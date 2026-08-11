'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { adjustStock, sellMerchandise, upsertProduct } from '@/lib/admin/merchandise'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 02 US-34 (B-078). Thin session wrapper; lib/admin/merchandise.ts holds
// the rules, the pricing and the stock movement.

function parseDollars(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null
  const [whole, fraction = ''] = raw.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

export async function saveProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const priceCents = parseDollars(formData.get('price'))
  if (priceCents === null) return fieldError({ price: 'Enter a price, like 12.99.' })
  const costCents = parseDollars(formData.get('cost'))
  if (costCents === null) return fieldError({ cost: 'Enter what it cost you, like 6.50.' })

  const lowStockRaw = String(formData.get('lowStockAt') ?? '').trim()
  const lowStockAt = lowStockRaw === '' ? null : Number(lowStockRaw)
  if (lowStockAt !== null && (!Number.isInteger(lowStockAt) || lowStockAt < 0)) {
    return fieldError({ lowStockAt: 'Enter a whole number, or leave it blank for no alert.' })
  }

  const result = await upsertProduct(actor, facilityId, {
    id: String(formData.get('productId') ?? '') || undefined,
    sku: String(formData.get('sku') ?? ''),
    name: String(formData.get('name') ?? ''),
    priceCents,
    unitCostCents: costCents,
    taxable: formData.get('taxable') === 'yes',
    lowStockAt,
    active: formData.get('active') !== 'no',
  })
  if (!result.ok) return fieldError({ sku: result.reason })

  revalidatePath('/admin/pos/merchandise')
  return success('Saved.')
}

export async function adjustStockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const deltaRaw = String(formData.get('delta') ?? '').trim()
  const delta = Number(deltaRaw)
  if (!Number.isInteger(delta) || delta === 0) {
    return fieldError({ delta: 'Enter how many to add (5) or remove (-5).' })
  }

  const result = await adjustStock(actor, String(formData.get('productId') ?? ''), delta, String(formData.get('reason') ?? ''))
  if (!result.ok) return fieldError({ reason: result.reason })

  revalidatePath('/admin/pos/merchandise')
  return success('Stock updated.')
}

const SELL_PROBLEM_COPY: Record<string, string> = {
  no_lines: 'Choose at least one product.',
  quantity_not_positive: 'Quantity has to be a whole number above zero.',
  price_negative: 'That product has a negative price or cost — fix it before selling.',
  insufficient_stock: 'There is not enough stock for that.',
  card_not_supported: 'Card sales need a terminal, which is not wired up. Take cash or a cheque.',
  tender: 'Check the amount tendered — it has to cover the total.',
  no_product: 'That product is not on sale at this facility.',
  tenant_required: 'A sale has to be attached to a tenant. Anonymous walk-in sales are not supported yet.',
}

export async function sellAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const quantity = Number(String(formData.get('quantity') ?? '1'))

  const result = await sellMerchandise(actor, {
    facilityId: String(formData.get('facilityId') ?? ''),
    lines: [{ productId: String(formData.get('productId') ?? ''), quantity }],
    method: String(formData.get('method') ?? 'cash') as 'cash' | 'check' | 'money_order' | 'card',
    tenderedCents: parseDollars(formData.get('tendered')) ?? undefined,
    checkNumber: String(formData.get('checkNumber') ?? '') || undefined,
    tenantId: String(formData.get('tenantId') ?? '') || undefined,
  })

  if (!result.ok) return fieldError({ productId: SELL_PROBLEM_COPY[result.problem] ?? 'That sale could not be recorded.' })

  revalidatePath('/admin/pos/merchandise')
  const change = result.changeCents ? ` Change ${(result.changeCents / 100).toFixed(2)}.` : ''
  return success(`Sold. Receipt #${result.receiptNumber}, total ${(result.totals.totalCents / 100).toFixed(2)}.${change}`)
}
