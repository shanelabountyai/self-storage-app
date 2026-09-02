import Link from 'next/link'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { formerTenantDebts } from '@/lib/admin/move-out'
import { formerTenantRollup } from '@/lib/admin/rollups'
import { FacilityRollup } from '@/components/admin/facility-rollup'
import { formatCents } from '@/lib/format'

export const metadata = { title: 'Former tenants owing' }

// PRD 02 US-14's former-tenant AR list. A read, not a queue: collections
// disposition and after-the-fact write-offs are B-048's. Its value now is
// that a balance left behind at move-out stops being invisible the moment the
// lease closes.

function formatDate(date: Date | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export default async function FormerTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string }>
}) {
  const { facility: facilityParam } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  // B-235. Drill in from the roll-up without switching the persistent context.
  const requested = facilityParam ? facilities.find((one) => one.id === facilityParam) : undefined
  const selected = requested
    ? { mode: 'single' as const, facility: requested }
    : resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Former tenants owing</h1>
        <FacilityRollup heading="Balances left behind, by facility" rows={await formerTenantRollup(actor)} />
        <p className="text-muted-foreground text-sm">
          Open a facility to see who owes what — a balance belongs to the lease that left it, at one
          site.
        </p>
      </div>
    )
  }

  const debts = await formerTenantDebts(actor, selected.facility.id)
  const total = debts.reduce((sum, row) => sum + row.balanceCents, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Former tenants owing — {selected.facility.name}</h1>
        <Link href="/admin/tenants" className="text-sm underline underline-offset-2">
          Tenant search
        </Link>
      </div>

      {debts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No ended lease at this facility has a balance left on it.
        </p>
      ) : (
        <>
          <p className="text-sm">
            {debts.length} account{debts.length === 1 ? '' : 's'} · {formatCents(total)} outstanding
          </p>
          <table className="w-full text-sm">
            <caption className="sr-only">Ended leases with a balance still owing</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 font-medium">Tenant</th>
                <th scope="col" className="py-2 font-medium">Unit</th>
                <th scope="col" className="py-2 font-medium">Moved out</th>
                <th scope="col" className="py-2 text-right font-medium">Balance</th>
                <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {debts.map((row) => (
                <tr key={row.leaseId} className="border-b">
                  <td className="py-2">
                    <Link href={`/admin/tenants/${row.tenantId}`} className="underline underline-offset-2">
                      {row.tenantName}
                    </Link>
                  </td>
                  <td className="py-2">{row.unitNumber}</td>
                  <td className="py-2">{formatDate(row.moveOutDate)}</td>
                  <td className="py-2 text-right font-medium tabular-nums text-red-800">
                    {formatCents(row.balanceCents)}
                  </td>
                  {/* B-231. The other half of "a read, not a queue": it was a
                      read of money that could not be collected anywhere in the
                      product, because the counter's unit picker excluded ended
                      leases. This lands on POS with the right tenant AND the
                      right unit already chosen. */}
                  <td className="py-2">
                    <Link
                      href={`/admin/pos?tenant=${row.tenantId}&lease=${row.leaseId}`}
                      className="underline underline-offset-2"
                    >
                      Take payment
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
