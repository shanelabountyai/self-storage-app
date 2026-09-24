import Link from 'next/link'
import { DataTable } from '@/components/ui/data-table'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { reportRangeForActor } from '@/lib/admin/reports'
import { depositsReport } from '@/lib/admin/deposits-report'
import { formatCents } from '@/lib/format'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Deposits' }

// PRD 02 US-39 item 6 (B-078). Recorded payments by method against what was
// counted into the drawer, with variances flagged.

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; facility?: string }>
}) {
  const params = await searchParams
  const actor = await getAdminActor()
  const range = await reportRangeForActor(actor, params)

  if (!hasPermissionAnywhere(actor, ['reports:financial'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to financial reports.</p>
  }

  const report = await depositsReport(actor, range.start, range.end, params.facility || undefined)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deposits — {range.label}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          What the system recorded against what somebody counted.{' '}
          <Link href="/admin/reports" className="underline underline-offset-2">
            Back to reports
          </Link>
          .
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          From
          <input type="date" name="from" defaultValue={range.fromValue} className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input type="date" name="to" defaultValue={range.toValue} className="border-input bg-background min-h-11 rounded-md border px-3 text-sm" />
        </label>
        <button type="submit" className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium">
          Apply
        </button>
        <Link
          href={`/admin/reports/deposits.csv?from=${range.fromValue}&to=${range.toValue}`}
          className="text-sm underline underline-offset-2"
        >
          Export CSV
        </Link>
      </form>

      {(report.totalVarianceCents !== 0 || report.totalUnreconciledCents !== 0) && (
        <p role="alert" className="border-input rounded-md border p-3 text-sm">
          {report.totalVarianceCents !== 0 && (
            <>Drawers are out by {formatCents(Math.abs(report.totalVarianceCents))} across this range. </>
          )}
          {report.totalUnreconciledCents !== 0 && (
            <>{formatCents(report.totalUnreconciledCents)} was taken with no drawer session open.</>
          )}
        </p>
      )}

      <ScrollRegion aria-label="Deposits by method">
        <DataTable className="min-w-2xl">
          <caption className="sr-only">
            Recorded payments by method against drawer close-outs, per facility per day
          </caption>
          <DataTable.Head>
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Day</th>
              <th scope="col" className="px-3 py-2 font-semibold">Facility</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Cash</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Checks</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Card</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Counted</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Over/short</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Unreconciled</th>
            </tr>
          </DataTable.Head>
          <tbody>
            {report.rows.length === 0 && (
              <DataTable.Row>
                <td colSpan={8} className="px-3 text-muted-foreground py-4 text-center">
                  Nothing taken in this range.
                </td>
              </DataTable.Row>
            )}
            {report.rows.map((row) => (
              <DataTable.Row key={`${row.facilityId}-${row.businessDate}`} className="border-input border-b">
                <th scope="row" className="px-3 py-2 text-left font-normal">{row.businessDate}</th>
                <td className="px-3 py-2">{row.facilityName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCents(row.cashRecordedCents)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCents(row.checksRecordedCents)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCents(row.cardRecordedCents)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.countedCashCents === null ? '—' : formatCents(row.countedCashCents)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.varianceCents === null || row.varianceCents === 0
                    ? '—'
                    : `${row.varianceCents > 0 ? 'over ' : 'short '}${formatCents(Math.abs(row.varianceCents))}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.unreconciledCents === 0 ? '—' : formatCents(row.unreconciledCents)}
                </td>
              </DataTable.Row>
            ))}
          </tbody>
        </DataTable>
      </ScrollRegion>

      <p className="text-muted-foreground max-w-prose text-xs text-pretty">
        The card column is what this system recorded, not what the processor says it paid out — no
        settlement-file import exists, so this is a two-way check (recorded vs counted), not the
        three-way tie-out US-39.6 eventually wants. A dash under Counted means no drawer was opened
        that day, which is itself worth looking at. Days are grouped by UTC date; a facility whose
        local day straddles UTC midnight can see a late-evening payment fall on the next row.
      </p>
    </div>
  )
}
