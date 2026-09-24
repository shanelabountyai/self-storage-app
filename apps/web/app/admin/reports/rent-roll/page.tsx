import Link from 'next/link'
import { EmptyState } from '@/components/ui/empty-state'
import { DataTable } from '@/components/ui/data-table'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { rentRoll } from '@/lib/admin/reports'
import { formatCents } from '@/lib/format'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Rent roll' }

// PRD 02 US-39.1's rent roll, which is also US-39.2's rate-variance worklist
// — §4.11: "in-place rate vs current street rate per occupied unit, sorted by
// gap, with months since the last change. That report is the worklist the
// Phase-2 rate-increase workflow runs from."
//
// One list, not two screens: the sort order comes from the metrics module's
// `rateVariance`, so the worklist ordering is part of the definition rather
// than a choice this page makes.

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

export default async function RentRollPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string }>
}) {
  const { facility: facilityParam } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const requested = facilityParam ? facilities.find((f) => f.id === facilityParam) : undefined
  const selected = requested
    ? { mode: 'single' as const, facility: requested }
    : resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Rent roll</h1>
        <p className="text-muted-foreground text-sm">
          Choose a single facility in the switcher above — a rent roll is a per-site list.
        </p>
      </div>
    )
  }

  const rows = await rentRoll(actor, selected.facility.id)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Rent roll — {selected.facility.name}</h1>
        <div className="flex gap-4">
          <Link
            href={`/admin/reports/rent-roll.csv?facility=${selected.facility.id}`}
            className="text-sm underline underline-offset-2"
          >
            Export CSV
          </Link>
          <Link href="/admin/reports" className="text-sm underline underline-offset-2">
            All reports
          </Link>
        </div>
      </div>

      <p className="text-muted-foreground text-sm text-pretty">
        Occupied units only, biggest rate gap first — the units where the in-place rate trails the
        current street rate by the most.
      </p>

      {rows.length === 0 ? (
        <EmptyState>No occupied units at this facility.</EmptyState>
      ) : (
        <ScrollRegion aria-label="Rent roll">
          <DataTable className="min-w-max">
            <caption className="sr-only">
              Occupied units at {selected.facility.name}, with in-place rate against current street
              rate, sorted by the largest gap
            </caption>
            <DataTable.Head>
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Unit</th>
                <th scope="col" className="px-3 py-2 font-semibold">Size</th>
                <th scope="col" className="px-3 py-2 font-semibold">Tenant</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">In place</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Street</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Gap</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Months since change</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Balance</th>
                <th scope="col" className="px-3 py-2 font-semibold">Started</th>
              </tr>
            </DataTable.Head>
            <tbody>
              {rows.map((row) => (
                <DataTable.Row key={row.unitNumber} className="border-b">
                  <td className="px-3 py-2">{row.unitNumber}</td>
                  <td className="px-3 py-2">{row.unitTypeName}</td>
                  <td className="px-3 py-2">{row.tenantName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(row.inPlaceRateCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(row.streetRateCents)}</td>
                  {/* Not colour alone (1.4.1) — the sign is in the number. */}
                  <td className={`py-2 text-right tabular-nums ${row.gapCents > 0 ? 'font-medium' : ''}`}>
                    {row.gapCents > 0 ? `+${formatCents(row.gapCents)}` : formatCents(row.gapCents)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.monthsSinceLastChange ?? '—'}</td>
                  <td className={`py-2 text-right tabular-nums ${row.balanceCents > 0 ? 'font-medium text-danger-fg' : ''}`}>
                    {formatCents(row.balanceCents)}
                  </td>
                  <td className="px-3 py-2">{formatDate(row.startDate)}</td>
                </DataTable.Row>
              ))}
            </tbody>
          </DataTable>
        </ScrollRegion>
      )}
    </div>
  )
}
