import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { reportRange } from '@/lib/admin/report-range'
import { formatCents } from '@/lib/format'
import { promoRoiReport } from '@/lib/analytics/promo-roi'
import { paybackMonths } from '@storage/core/promotions'

export const metadata = { title: 'Promotions' }

// PRD 04 §3.2 US-4 (B-082 part 4). Promo ROI.
//
// The report an operator opens to answer one question: is this promotion worth
// running? Every column is here because that question needs it, and the two
// discount columns are separate because reporting them as one is the mistake
// this report exists to stop.

function months(value: number | null): string {
  if (value === null) return '—'
  return value < 10 ? value.toFixed(1) : Math.round(value).toString()
}

export default async function PromotionsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const params = await searchParams
  const range = reportRange(params)
  const actor = await getAdminActor()

  if (!hasPermissionAnywhere(actor, ['reports:operational'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to reports.</p>
  }

  const report = await promoRoiReport(actor, { from: range.start, to: range.end })

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Promotions — {range.label}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          What each discount gave away, and what it bought.{' '}
          <Link href="/admin/reports" className="underline underline-offset-2">
            Back to reports
          </Link>
          .
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3">
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
      </form>

      {report.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No promotions were redeemed in this range.
        </p>
      ) : (
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse text-sm">
            <caption className="sr-only">
              Promotions redeemed in {range.label}, with discount given, discount still owed, and
              the rent the discount bought
            </caption>
            <thead>
              <tr className="border-input border-b text-left">
                <th scope="col" className="py-2 pr-4">Promotion</th>
                <th scope="col" className="py-2 pr-4 text-right">Redeemed</th>
                <th scope="col" className="py-2 pr-4 text-right">Moved in</th>
                <th scope="col" className="py-2 pr-4 text-right">Still renting</th>
                <th scope="col" className="py-2 pr-4 text-right">Discount given</th>
                <th scope="col" className="py-2 pr-4 text-right">Still to give</th>
                <th scope="col" className="py-2 pr-4 text-right">Rent per month</th>
                <th scope="col" className="py-2 pr-4 text-right">Months to earn back</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.promotionId} className="border-input border-b">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">
                    {row.name}
                  </th>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.redemptions}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.moveIns}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.stillRenting}</td>
                  {/* Given, then still to give. Two columns and never one:
                      "first month free" commits the whole discount on the day
                      it is redeemed and realises it only when billing writes
                      the line, so a single figure either overstates the cost of
                      every short tenancy or understates the exposure of every
                      promotion still running. */}
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(row.realisedCents)}
                  </td>
                  <td className="text-muted-foreground py-2 pr-4 text-right tabular-nums">
                    {formatCents(row.outstandingCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(row.monthlyRentCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {months(paybackMonths(row))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <th scope="row" className="py-2 pr-4 text-left">
                  All promotions
                </th>
                <td className="py-2 pr-4 text-right tabular-nums">{report.totals.redemptions}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{report.totals.moveIns}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{report.totals.stillRenting}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {formatCents(report.totals.realisedCents)}
                </td>
                <td className="text-muted-foreground py-2 pr-4 text-right tabular-nums">
                  {formatCents(report.totals.outstandingCents)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {formatCents(report.totals.monthlyRentCents)}
                </td>
                {/* No total payback. It is a ratio, and summing ratios across
                    rows produces a number that is not the portfolio's payback
                    and that somebody will quote anyway. */}
                <td className="py-2 pr-4 text-right">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="text-muted-foreground flex max-w-prose flex-col gap-2 text-xs text-pretty">
        <p>
          <span className="font-medium">Discount given</span> is what has actually come off an
          invoice. <span className="font-medium">Still to give</span> is what these redemptions
          have promised and not yet discounted — it falls to zero as the promotion runs out, or
          when a tenant leaves before it does.
        </p>
        <p>
          <span className="font-medium">Months to earn back</span> is the discount already given
          divided by the rent those tenants pay each month. It is blank where nobody who took the
          promotion is still renting — that is not a very long payback, it is no payback.
        </p>
        <p>
          Redemptions that never reached a move-in are counted in the first column and nowhere
          else. They cost nothing and bought nothing.
        </p>
      </div>
    </div>
  )
}
