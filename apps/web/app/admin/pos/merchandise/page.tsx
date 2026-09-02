import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { facilityProducts } from '@/lib/admin/merchandise'
import { searchTenants } from '@/lib/admin/tenants'
import { formatCents } from '@/lib/format'
import { adjustStockAction, saveProductAction, sellAction } from './actions'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Merchandise' }

// PRD 02 US-34 (B-078). "Locks, boxes, packing supplies as SKU'd inventory
// per facility — price, tax category, stock count, low-stock alert."
//
// Selling is gated on `payments:take` (a sale is a payment); editing what is
// on the shelf and what it cost is `merchandise:manage`, because pricing is
// not counter work.

export default async function MerchandisePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()

  if (!hasPermissionAnywhere(actor, ['payments:take', 'merchandise:manage'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to merchandise.</p>
  }

  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)
  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a single facility above — stock sits on a shelf at one site.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const canManage = hasPermissionAnywhere(actor, ['merchandise:manage'])
  const [products, tenants] = await Promise.all([
    facilityProducts(actor, facilityId, { includeInactive: canManage }),
    q ? searchTenants(actor, q) : Promise.resolve([]),
  ])
  const sellable = products.filter((product) => product.active && product.stockCount > 0)
  const lowStock = products.filter((product) => product.lowStock && product.active)

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Merchandise — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Locks, boxes and packing supplies.{' '}
          <Link href="/admin/pos" className="underline underline-offset-2">
            Back to POS
          </Link>
          .
        </p>
      </div>

      {lowStock.length > 0 && (
        <p role="alert" className="border-input rounded-md border p-3 text-sm">
          Low stock:{' '}
          {lowStock.map((product) => `${product.name} (${product.stockCount} left)`).join(', ')}.
        </p>
      )}

      <section aria-labelledby="stock-heading" className="flex flex-col gap-3">
        <h2 id="stock-heading" className="font-medium">
          On the shelf
        </h2>
        {products.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing set up yet.</p>
        ) : (
          <ScrollRegion aria-label="Products">
            <table className="w-full min-w-2xl border-collapse text-sm">
              <caption className="sr-only">Products, prices and stock counts at this facility</caption>
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">SKU</th>
                  <th scope="col" className="py-2 pr-4">Name</th>
                  <th scope="col" className="py-2 pr-4 text-right">Price</th>
                  <th scope="col" className="py-2 pr-4 text-right">Cost</th>
                  <th scope="col" className="py-2 pr-4 text-right">Stock</th>
                  <th scope="col" className="py-2 pr-4">Tax</th>
                  {canManage && <th scope="col" className="py-2 pr-4">Adjust</th>}
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="border-input border-b align-top">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{product.sku}</th>
                    <td className="py-2 pr-4">
                      {product.name}
                      {!product.active && <span className="text-muted-foreground"> (inactive)</span>}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(product.priceCents)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCents(product.unitCostCents)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {product.stockCount}
                      {product.lowStock && <span className="font-medium"> · low</span>}
                    </td>
                    <td className="py-2 pr-4">{product.taxable ? 'Taxable' : 'Exempt'}</td>
                    {canManage && (
                      <td className="py-2 pr-4">
                        <AdminForm action={adjustStockAction} label={`Adjust stock for ${product.name}`} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="productId" value={product.id} />
                          <Field name="delta" label="+/−" className="flex flex-col gap-1 text-xs" />
                          <Field name="reason" label="Why" className="flex flex-col gap-1 text-xs" />
                          <Button type="submit">Apply</Button>
                        </AdminForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      <section aria-labelledby="sell-heading" className="flex flex-col gap-3">
        <h2 id="sell-heading" className="font-medium">
          Sell
        </h2>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          A sale is attached to a tenant so it lands on a receipt with their name on it. Search for
          them first; anonymous walk-in sales are not supported yet.
        </p>

        <form method="GET" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm" htmlFor="q">
            Find the tenant
            <input
              id="q"
              name="q"
              defaultValue={q ?? ''}
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            />
          </label>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>

        {q && tenants.length === 0 && (
          <p className="text-muted-foreground text-sm">Nobody matches “{q}”.</p>
        )}

        {tenants.length > 0 && sellable.length > 0 && (
          <AdminForm action={sellAction} label="Record a merchandise sale" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="facilityId" value={facilityId} />
            <Field name="tenantId" label="Tenant" as="select" required className="flex flex-col gap-1 text-sm">
              {tenants.map((tenant) => (
                <option key={tenant.tenantId} value={tenant.tenantId}>
                  {tenant.name} — {tenant.email}
                </option>
              ))}
            </Field>
            <Field name="productId" label="Product" as="select" required className="flex flex-col gap-1 text-sm">
              {sellable.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} — {formatCents(product.priceCents)} ({product.stockCount} left)
                </option>
              ))}
            </Field>
            <Field name="quantity" label="Qty" type="number" min={1} defaultValue={1} required />
            <Field name="method" label="Paid by" as="select" defaultValue="cash">
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="money_order">Money order</option>
            </Field>
            <Field name="tendered" label="Tendered ($)" inputMode="decimal" hint="Cash only." />
            <Field name="checkNumber" label="Check #" hint="Check or money order only." />
            <Button type="submit">Record sale</Button>
          </AdminForm>
        )}

        {sellable.length === 0 && (
          <p className="text-muted-foreground text-sm">Nothing is in stock to sell.</p>
        )}
      </section>

      {canManage && (
        <section aria-labelledby="add-heading" className="flex flex-col gap-3">
          <h2 id="add-heading" className="font-medium">
            Add a product
          </h2>
          <p className="text-muted-foreground max-w-prose text-xs text-pretty">
            Stock is not set here — it moves through an adjustment or a sale, so a count never
            changes without a record of why.
          </p>
          <AdminForm action={saveProductAction} label="Add a product" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="facilityId" value={facilityId} />
            <Field name="sku" label="SKU" required />
            <Field name="name" label="Name" required className="flex flex-col gap-1 text-sm" />
            <Field name="price" label="Price ($)" inputMode="decimal" required />
            <Field name="cost" label="Cost to us ($)" inputMode="decimal" required defaultValue="0.00" />
            <Field name="lowStockAt" label="Warn at" type="number" min={0} hint="Blank for no alert." />
            <Field name="taxable" label="Tax" as="select" defaultValue="yes">
              <option value="yes">Taxable</option>
              <option value="no">Exempt</option>
            </Field>
            <Button type="submit">Add product</Button>
          </AdminForm>
        </section>
      )}
    </div>
  )
}
