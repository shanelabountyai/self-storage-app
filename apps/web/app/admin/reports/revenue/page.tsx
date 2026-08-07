import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { reportRange } from '@/lib/admin/report-range'
import { billedTotal, collectedTotal, revenueReport, type RevenueRow } from '@/lib/admin/revenue-report'
import { REVENUE_CATEGORIES } from '@storage/core/metrics'
import { formatCents } from '@/lib/format'

export const metadata = { title: 'Revenue' }

// PRD 02 US-39.5 (B-055). Billed vs collected, by category.
//
// Not one figure on this page is computed here — the categories, the splits and
// the roll-up all come from lib/admin/revenue-report.ts over @storage/core
// (§4.11: "No screen, tile, or export computes any of these inline").

const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Rent',
  fee: 'Fees',
  protection: 'Protection',
  tax: 'Tax',
}

function collectionRate(row: RevenueRow): string {
  const billed = billedTotal(row)
  // No rate rather than 0% or a dash when nothing was billed: dividing by zero
  // to make a tile look complete is how a facility that billed nothing appears
  // to be collecting nothing, which is a different and much worse statement.
  if (billed <= 0) return '—'
  return `${((collectedTotal(row) / billed) * 100).toFixed(1)}%`
}

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const params = await searchParams
  const range = reportRange(params)
  const actor = await getAdminActor()

  if (!hasPermissionAnywhere(actor, ['reports:financial'])) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have access to financial reports.
      </p>
    )
  }

  const report = await revenueReport(actor, range.start, range.end)
  const query = `from=${range.fromValue}&to=${range.toValue}`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Revenue — {range.label}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          <strong>Billed</strong> is what invoices issued in this range charged.{' '}
          <strong>Collected</strong> is what payments received in this range settled. They are
          deliberately on different bases: the gap between them is money owed, and it is the same
          money the{' '}
          <Link href="/admin/reports/delinquency" className="underline underline-offset-2">
            aging report
          </Link>{' '}
          is looking at from the other end.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3">
        {/* Native date inputs: keyboard-operable, localised by the browser, and
            no client JS. */}
        <label className="flex flex-col gap-1 text-sm">
          From
          <input
            type="date"
            name="from"
            defaultValue={range.fromValue}
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input
            type="date"
            name="to"
            defaultValue={range.toValue}
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          />
        </label>
        <button
          type="submit"
          className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium"
        >
          Apply
        </button>
        <Link
          href={`/admin/reports/revenue.csv?${query}`}
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Download CSV
        </Link>
      </form>

      <section aria-labelledby="totals-heading" className="flex flex-col gap-3">
        <h2 id="totals-heading" className="font-medium">
          All facilities
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Billed</dt>
            <dd className="text-xl font-semibold">{formatCents(billedTotal(report.total))}</dd>
          </div>
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Collected</dt>
            <dd className="text-xl font-semibold">{formatCents(collectedTotal(report.total))}</dd>
          </div>
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Collected ÷ billed</dt>
            <dd className="text-xl font-semibold">{collectionRate(report.total)}</dd>
          </div>
        </dl>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full min-w-4xl border-collapse text-sm">
          <caption className="sr-only">
            Billed and collected by category, per facility, for {range.label}
          </caption>
          <thead>
            <tr className="border-input border-b text-left">
              <th scope="col" className="py-2 pr-4">
                Facility
              </th>
              {REVENUE_CATEGORIES.map((category) => (
                <th key={category} scope="col" className="py-2 pr-4 text-right">
                  {CATEGORY_LABELS[category]}
                </th>
              ))}
              <th scope="col" className="py-2 pr-4 text-right">
                Unapplied
              </th>
              <th scope="col" className="py-2 pr-4 text-right">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <RowPair key={row.facilityId} row={row} />
            ))}
            {report.rows.length > 0 && <RowPair row={report.total} emphasis />}
          </tbody>
        </table>
        {report.rows.length === 0 && (
          <p className="text-muted-foreground mt-3 text-sm">
            No facilities you can see financial reports for.
          </p>
        )}
      </div>

      <section aria-labelledby="adjustments-heading" className="flex flex-col gap-3">
        <h2 id="adjustments-heading" className="font-medium">
          Given away and written off
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Discounts and promos</dt>
            <dd className="text-lg font-semibold">{formatCents(report.total.discountsCents)}</dd>
            <p className="text-muted-foreground mt-1 text-xs text-pretty">
              On invoices issued in this range. Not deducted from billed above — billed is what was
              charged, this is what was let go.
            </p>
          </div>
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Written off</dt>
            <dd className="text-lg font-semibold">{formatCents(report.total.writeOffsCents)}</dd>
            <p className="text-muted-foreground mt-1 text-xs text-pretty">
              Balances given up on in this range. Gone from AR, never collected.
            </p>
          </div>
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Refunded</dt>
            <dd className="text-lg font-semibold">{formatCents(report.total.refundsCents)}</dd>
            <p className="text-muted-foreground mt-1 text-xs text-pretty">
              Shown for information only. A refund unwinds the original payment, so collected above
              is <em>already</em> net of this — adding it again would double-count.
            </p>
          </div>
        </dl>
      </section>
    </div>
  )
}

/// Two rows per facility: billed above, collected below. A single row with
/// eight money columns is unreadable, and the comparison the report exists for
/// is vertical — this rent number against that rent number.
function RowPair({ row, emphasis = false }: { row: RevenueRow; emphasis?: boolean }) {
  const weight = emphasis ? 'font-semibold' : ''
  return (
    <>
      <tr className={`border-input border-b ${weight}`}>
        <th scope="rowgroup" rowSpan={2} className="py-2 pr-4 text-left align-top font-medium">
          {row.facilityName}
          {emphasis && <span className="sr-only"> (roll-up of every facility above)</span>}
        </th>
        {REVENUE_CATEGORIES.map((category) => (
          <td key={category} className="py-2 pr-4 text-right tabular-nums">
            <span className="text-muted-foreground mr-2 text-xs uppercase">Billed</span>
            {formatCents(row.billed[category])}
          </td>
        ))}
        <td className="text-muted-foreground py-2 pr-4 text-right">—</td>
        <td className="py-2 pr-4 text-right tabular-nums">{formatCents(billedTotal(row))}</td>
      </tr>
      <tr className={`border-input border-b ${weight}`}>
        {REVENUE_CATEGORIES.map((category) => (
          <td key={category} className="py-2 pr-4 text-right tabular-nums">
            <span className="text-muted-foreground mr-2 text-xs uppercase">Coll.</span>
            {formatCents(row.collected[category])}
          </td>
        ))}
        <td className="py-2 pr-4 text-right tabular-nums">{formatCents(row.unappliedCents)}</td>
        <td className="py-2 pr-4 text-right tabular-nums">{formatCents(collectedTotal(row))}</td>
      </tr>
    </>
  )
}
