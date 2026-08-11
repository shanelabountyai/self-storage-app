import Link from 'next/link'
import { prisma } from '@storage/db'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { searchTenants } from '@/lib/admin/tenants'
import { currentRatesForFacility } from '@/lib/pricing/unit-type-rates'
import { formatCents } from '@/lib/format'
import { AdminForm, Field } from '@/components/admin/form'
import { startWalkInMoveInAction, takePaymentAction } from './actions'

export const metadata = { title: 'POS' }

// PRD 02 §4.8 US-32. Two things happen at a counter: someone pays, or someone
// rents. Drawer sessions (open float, close-out, over/short) are B-078 per
// D-1 — this screen is a payment recorder and a read over `Payment`.

const FIELD_CLASS = 'flex flex-col gap-1 text-sm'

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tenant?: string; soldOut?: string }>
}) {
  const { q, tenant: tenantId, soldOut } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">POS</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          Choose a single facility in the switcher above. Money is taken at one counter, so this
          screen needs to know which.
        </p>
      </div>
    )
  }
  const facilityId = selected.facility.id

  const results = q ? await searchTenants(actor, q) : []
  const [selectedTenant, unitTypes, rates] = await Promise.all([
    tenantId
      ? prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            leases: {
              where: { facilityId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
              select: { id: true, unit: { select: { number: true } } },
            },
          },
        })
      : null,
    prisma.unitType.findMany({
      where: { facilityId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        _count: { select: { units: { where: { status: 'available' } } } },
      },
    }),
    currentRatesForFacility(facilityId),
  ])

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">POS — {selected.facility.name}</h1>
        <div className="flex flex-wrap gap-4">
          <Link href="/admin/pos/drawer" className="text-sm underline underline-offset-2">
            Drawer
          </Link>
          <Link href="/admin/pos/merchandise" className="text-sm underline underline-offset-2">
            Merchandise
          </Link>
          <Link href="/admin/pos/summary" className="text-sm underline underline-offset-2">
            Today&apos;s payments &amp; deposit slip
          </Link>
        </div>
      </div>

      {soldOut && (
        <p role="alert" className="border-input rounded-md border p-3 text-sm">
          That size has nothing available right now. Pick another, or check the units screen.
        </p>
      )}

      <section aria-labelledby="payment-heading" className="flex flex-col gap-3">
        <h2 id="payment-heading" className="font-medium">
          Take a payment
        </h2>

        <form method="GET" role="search" className="flex flex-wrap items-end gap-2">
          <label htmlFor="q" className="flex flex-col gap-1 text-sm">
            Find the tenant — name, phone, email, or unit
            <input
              id="q"
              name="q"
              defaultValue={q ?? ''}
              className="border-input bg-background h-9 w-72 rounded-md border px-2"
            />
          </label>
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
          >
            Search
          </button>
        </form>

        {q && results.length === 0 && (
          <p className="text-muted-foreground text-sm">No tenants match &ldquo;{q}&rdquo;.</p>
        )}

        {results.length > 0 && !selectedTenant && (
          <ul className="flex flex-col gap-1 text-sm">
            {results.map((result) => (
              <li key={result.tenantId}>
                <Link
                  href={`/admin/pos?q=${encodeURIComponent(q ?? '')}&tenant=${result.tenantId}`}
                  className="underline underline-offset-2"
                >
                  {result.name}
                </Link>{' '}
                <span className="text-muted-foreground">
                  {result.units.map((u) => u.unitNumber).join(', ') || 'no active unit'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {selectedTenant && (
          <div className="border-input rounded-lg border p-4">
            <p className="text-sm font-medium">
              {selectedTenant.firstName} {selectedTenant.lastName}
            </p>
            {selectedTenant.leases.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">
                No active unit at this facility, so there is nothing to post a payment against.
              </p>
            ) : (
              <AdminForm
                action={takePaymentAction}
                label="Take a payment"
                className="mt-3 grid max-w-lg grid-cols-2 gap-3"
              >
                <input type="hidden" name="facilityId" value={facilityId} />
                <input type="hidden" name="tenantId" value={selectedTenant.id} />
                <Field name="leaseId" label="Unit" as="select" required className={FIELD_CLASS}>
                  {selectedTenant.leases.map((lease) => (
                    <option key={lease.id} value={lease.id}>
                      {lease.unit.number}
                    </option>
                  ))}
                </Field>
                <Field name="method" label="Method" as="select" defaultValue="cash" required className={FIELD_CLASS}>
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="money_order">Money order</option>
                </Field>
                <Field
                  name="amount"
                  label="Amount ($)"
                  inputMode="decimal"
                  required
                  className={FIELD_CLASS}
                />
                <Field
                  name="tendered"
                  label="Cash tendered ($)"
                  inputMode="decimal"
                  hint="Cash only — change is worked out for you."
                  className={FIELD_CLASS}
                />
                <Field
                  name="checkNumber"
                  label="Check / money-order number"
                  hint="Required for check and money order."
                  className={`${FIELD_CLASS} col-span-2`}
                />
                <button
                  type="submit"
                  className="bg-primary text-primary-foreground col-span-2 inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
                >
                  Record payment
                </button>
              </AdminForm>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="movein-heading" className="flex flex-col gap-3">
        <h2 id="movein-heading" className="font-medium">
          Walk-in move-in
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">
          Starts the same move-in the website uses — lease, signature, protection and gate code —
          quoted at the in-store price.
        </p>
        <ul className="flex flex-col gap-2">
          {unitTypes.map((unitType) => {
            const rate = rates.get(unitType.id)
            const available = unitType._count.units
            return (
              <li
                key={unitType.id}
                className="border-input flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
              >
                <span>
                  <span className="font-medium">{unitType.name}</span>{' '}
                  <span className="text-muted-foreground">
                    · {available} available
                    {rate && ` · ${formatCents(rate.streetRateCents)}/mo in store`}
                  </span>
                </span>
                {available > 0 && rate && (
                  <form action={startWalkInMoveInAction}>
                    <input type="hidden" name="facilityId" value={facilityId} />
                    <input type="hidden" name="unitTypeId" value={unitType.id} />
                    <button
                      type="submit"
                      className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                    >
                      Start move-in
                    </button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
