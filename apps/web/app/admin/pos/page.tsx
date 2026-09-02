import Link from 'next/link'
import { prisma } from '@storage/db'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { searchTenants } from '@/lib/admin/tenants'
import { counterPayableLeases } from '@/lib/admin/pos'
import { currentRatesForFacility } from '@/lib/pricing/unit-type-rates'
import { formatCents } from '@/lib/format'
import { CounterPaymentForm } from '@/components/admin/counter-payment-form'
import { startWalkInMoveInAction } from './actions'

export const metadata = { title: 'POS' }

// PRD 02 §4.8 US-32. Two things happen at a counter: someone pays, or someone
// rents. Drawer sessions (open float, close-out, over/short) are B-078 per
// D-1 — this screen is a payment recorder and a read over `Payment`.

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tenant?: string; lease?: string; soldOut?: string }>
}) {
  // B-231. `lease` preselects a unit, so `/admin/tenants/former`'s "Take
  // payment" link lands on the right one rather than on whichever the sort
  // happened to put first.
  const { q, tenant: tenantId, lease: preselectedLeaseId, soldOut } = await searchParams
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
  const [selectedTenant, payableLeases, unitTypes, rates] = await Promise.all([
    tenantId
      ? prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, firstName: true, lastName: true },
        })
      : null,
    tenantId ? counterPayableLeases(actor, tenantId, facilityId) : [],
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
            {payableLeases.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">
                No unit at this facility with anything to pay — no open lease, and no ended
                one still owing.
              </p>
            ) : (
              <CounterPaymentForm
                facilityId={facilityId}
                tenantId={selectedTenant.id}
                leases={payableLeases}
                defaultLeaseId={preselectedLeaseId}
              />
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
