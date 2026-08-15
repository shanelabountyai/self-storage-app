import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { reportRange } from '@/lib/admin/report-range'
import { depositsReport } from '@/lib/admin/deposits-report'
import { formatCents } from '@/lib/format'

export const metadata = { title: 'Deposits' }

// PRD 02 US-39 item 6 (B-078). Recorded payments by method against what was
// counted into the drawer, with variances flagged.

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; facility?: string }>
}) {
  const params = await searchParams
  const range = reportRange(params)
  const actor = await getAdminActor()

  if (!hasPermissionAnywhere(actor, ['reports:financial'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to financial reports.</p>
  }

  const report = await depositsReport(actor, range.start, range.end, params.facility || undefined)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Deposits — {range.label}</h1>
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

      <div tabIndex={0} className="overflow-x-auto">
        <table className="w-full min-w-2xl border-collapse text-sm">
          <caption className="sr-only">
            Recorded payments by method against drawer close-outs, per facility per day
          </caption>
          <thead>
            <tr className="border-input border-b text-left">
              <th scope="col" className="py-2 pr-4">Day</th>
              <th scope="col" className="py-2 pr-4">Facility</th>
              <th scope="col" className="py-2 pr-4 text-right">Cash</th>
              <th scope="col" className="py-2 pr-4 text-right">Cheques</th>
              <th scope="col" className="py-2 pr-4 text-right">Card</th>
              <th scope="col" className="py-2 pr-4 text-right">Counted</th>
              <th scope="col" className="py-2 pr-4 text-right">Over/short</th>
              <th scope="col" className="py-2 pr-4 text-right">Unreconciled</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-muted-foreground py-4 text-center">
                  Nothing taken in this range.
                </td>
              </tr>
            )}
            {report.rows.map((row) => (
              <tr key={`${row.facilityId}-${row.businessDate}`} className="border-input border-b">
                <th scope="row" className="py-2 pr-4 text-left font-normal">{row.businessDate}</th>
                <td className="py-2 pr-4">{row.facilityName}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.cashRecordedCents)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.checksRecordedCents)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.cardRecordedCents)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {row.countedCashCents === null ? '—' : formatCents(row.countedCashCents)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {row.varianceCents === null || row.varianceCents === 0
                    ? '—'
                    : `${row.varianceCents > 0 ? 'over ' : 'short '}${formatCents(Math.abs(row.varianceCents))}`}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {row.unreconciledCents === 0 ? '—' : formatCents(row.unreconciledCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
