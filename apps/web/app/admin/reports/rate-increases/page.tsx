import { Fragment } from 'react'
import Link from 'next/link'
import { averageIncreaseCents, averageIncreasePercent, OUTCOME_WINDOWS, type RateIncreaseOutcome } from '@storage/core/metrics'
import { DataTable } from '@/components/ui/data-table'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { reportRangeForActor } from '@/lib/admin/reports'
import {
  batchLabel,
  NOT_YET,
  ninetyDayMeasured,
  rateIncreaseOutcomeReport,
  windowCell,
} from '@/lib/admin/rate-increase-outcome-report'
import { formatCents } from '@/lib/format'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Rate increase outcomes' }
export const dynamic = 'force-dynamic'

// PRD 02 US-39 "AC (a rate increase is measured after it lands)" — B-400.

function Cells({ outcome }: { outcome: RateIncreaseOutcome }) {
  const measured = ninetyDayMeasured(outcome)
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{outcome.count}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatCents(averageIncreaseCents(outcome))}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {(averageIncreasePercent(outcome) * 100).toFixed(1)}%
      </td>
      {OUTCOME_WINDOWS.map((days) => (
        <td key={days} className="px-3 py-2 text-right tabular-nums">
          {windowCell(outcome, days)}
        </td>
      ))}
      <td className="px-3 py-2 text-right tabular-nums">
        {measured ? `${outcome.retentionCutLeases} (${formatCents(outcome.retentionCutCents)})` : NOT_YET}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {measured ? formatCents(outcome.netMonthlyCents) : NOT_YET}
      </td>
    </>
  )
}

export default async function RateIncreaseOutcomesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const params = await searchParams
  const actor = await getAdminActor()

  if (!hasPermissionAnywhere(actor, ['reports:financial'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to financial reports.</p>
  }

  const range = await reportRangeForActor(actor, params)
  const report = await rateIncreaseOutcomeReport(actor, range.start, range.end)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rate increase outcomes — {range.label}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Increases that took effect in this range, and what happened next: who moved out within 30,
          60 and 90 days (and how many said the price was why), who was given a retention cut within
          90 days, and the net change in monthly rent — the increase kept on leases still here, less
          any cut, minus the whole old rent of every lease that left. A window that has not passed
          yet says &ldquo;{NOT_YET}&rdquo;; &ldquo;of N&rdquo; means only N of the increases have
          reached it.{' '}
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
          href={`/admin/reports/rate-increases.csv?from=${range.fromValue}&to=${range.toValue}`}
          className="text-sm underline underline-offset-2"
        >
          Export CSV
        </Link>
      </form>

      {report.facilities.length === 0 ? (
        <p className="text-sm">No rate increase took effect in this range.</p>
      ) : (
        <ScrollRegion aria-label="Rate increase outcomes">
          <DataTable className="min-w-4xl">
            <caption className="sr-only">
              Applied rate increases by facility and batch, with move-outs, retention cuts and net
              monthly revenue change
            </caption>
            <DataTable.Head>
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Facility / batch</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Raised</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Avg increase</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Avg %</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Left ≤30 days</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Left ≤60 days</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Left ≤90 days</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Retention cuts ≤90 days</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Net monthly change</th>
              </tr>
            </DataTable.Head>
            <tbody>
              {report.facilities.map((facility) => (
                <Fragment key={facility.facilityId}>
                  <DataTable.Row className="border-input border-b font-medium">
                    <th scope="row" className="px-3 py-2 text-left">{facility.facilityName}</th>
                    <Cells outcome={facility.outcome} />
                  </DataTable.Row>
                  {facility.batches.map((batch) => (
                    <DataTable.Row key={batch.batchId ?? 'one-off'} className="border-input border-b">
                      <th scope="row" className="py-2 pr-3 pl-6 text-left font-normal">
                        <span className="sr-only">{facility.facilityName}: </span>
                        {batchLabel(batch)}
                      </th>
                      <Cells outcome={batch.outcome} />
                    </DataTable.Row>
                  ))}
                </Fragment>
              ))}
              {report.facilities.length > 1 && (
                <DataTable.Row className="font-semibold">
                  <th scope="row" className="px-3 py-2 text-left">All facilities</th>
                  <Cells outcome={report.total} />
                </DataTable.Row>
              )}
            </tbody>
          </DataTable>
        </ScrollRegion>
      )}
    </div>
  )
}
