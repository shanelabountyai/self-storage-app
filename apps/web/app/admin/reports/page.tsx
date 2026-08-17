import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { delinquencyReport, movesReport, occupancyReport } from '@/lib/admin/reports'
import { formatCents } from '@/lib/format'

export const metadata = { title: 'Reports' }

// PRD 02 US-2 / US-39(1–3). The portfolio view: one row per facility, a
// roll-up that is the sum of them, and a link out of every figure.
//
// Not one number on this page is computed here — every ratio, bucket and
// count comes from @storage/core/metrics via lib/admin/reports.ts (§4.11:
// "No screen, tile, or export computes any of these inline").

// US-39.4's buckets, in the order the PRD lists them. Labels say "days" once,
// in the header, rather than repeating it in five column titles.
const AR_BUCKET_LABELS = [
  ['d0to10', '0–10'],
  ['d11to30', '11–30'],
  ['d31to60', '31–60'],
  ['d61to90', '61–90'],
  ['over90', 'Over 90'],
] as const

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

// B-082 part 1. Operator-facing names for the two acquisition vocabularies.
// Written out rather than title-cased from the key, because "Walk in" and
// "Referral tenant" are what mechanical prettifying produces and neither is
// what a manager calls the thing.
const CHANNEL_LABELS: Record<string, string> = {
  aggregator: 'Marketplace / aggregator',
  paid_search: 'Paid search',
  paid_social: 'Paid social',
  organic: 'Organic search',
  organic_social: 'Organic social',
  email: 'Email',
  referral: 'Referral site',
  referral_tenant: 'Tenant referral',
  direct: 'Direct',
  phone: 'Phone',
  walk_in: 'Walk-in',
  unknown: 'Unknown',
}

const SOURCE_LABELS: Record<string, string> = {
  web: 'Web',
  phone: 'Phone',
  walk_in: 'Walk-in',
  referral: 'Referral',
  drive_by: 'Drive-by',
  unknown: 'Unknown',
}

/// One acquisition split. Rows with no move-ins are omitted — eleven channels
/// of which nine read zero is a table nobody scans — except `unknown`, which
/// is shown whenever it is non-zero and never quietly folded into a real
/// channel, and which is the only honest answer for a lease that predates
/// capture.
function MoveSplit({
  heading,
  hint,
  counts,
  labels,
  total,
}: {
  heading: string
  hint: string
  counts: Record<string, number>
  labels: Record<string, string>
  total: number
}) {
  const rows = Object.entries(counts).filter(([, count]) => count > 0)

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{heading}</h3>
      <p className="text-muted-foreground text-sm text-pretty">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No move-ins in this period.</p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">{heading}</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2 font-medium">
                {heading.replace('Move-ins by ', '').replace(/^./, (c) => c.toUpperCase())}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Move-ins
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, count]) => (
              <tr key={key} className="border-b">
                <th scope="row" className="py-2 font-normal">
                  {labels[key] ?? key}
                </th>
                <td className="py-2 text-right tabular-nums">{count}</td>
                <td className="py-2 text-right tabular-nums">
                  {total === 0 ? '—' : percent(count / total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function monthBounds(month: string): { start: Date; end: Date; label: string } {
  const [year, monthIndex] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, monthIndex - 1, 1))
  const end = new Date(Date.UTC(year, monthIndex, 1))
  return {
    start,
    end,
    label: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start),
  }
}

function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const selectedMonth = month ?? currentMonth()
  const { start, end, label } = monthBounds(selectedMonth)
  const actor = await getAdminActor()

  const [occupancy, moves, delinquency] = await Promise.all([
    occupancyReport(actor, start, end),
    movesReport(actor, start, end),
    delinquencyReport(actor),
  ])

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Reports — {label}</h1>
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <label htmlFor="month" className="flex flex-col gap-1 text-sm">
            Month
            <input
              id="month"
              name="month"
              type="month"
              defaultValue={selectedMonth}
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
          >
            Show
          </button>
        </form>
      </div>

      {/* The two money reports live on their own pages: both need a date range
          rather than a month, and the aging one is a per-lease list that would
          swamp this overview. */}
      <nav aria-label="Financial reports" className="flex flex-wrap gap-3">
        <Link
          href="/admin/reports/revenue"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Revenue — billed vs collected
        </Link>
        <Link
          href="/admin/reports/delinquency"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Delinquency aging — tenant detail
        </Link>
        <Link
          href="/admin/reports/funnel"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Funnel — looking to moved in
        </Link>
        <Link
          href="/admin/reports/promotions"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Promotions — what each discount bought
        </Link>
        <Link
          href="/admin/reports/indexation"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Indexation — what Google has indexed
        </Link>
        <Link
          href="/admin/reports/duplicate-content"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Duplicate content — pages that say the same thing
        </Link>
        <Link
          href="/admin/reports/deliverability"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Deliverability — sends, bounces, failure queue
        </Link>
        <Link
          href="/admin/reports/deposits"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Deposits — recorded vs counted
        </Link>
      </nav>

      <section aria-labelledby="occupancy-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="occupancy-heading" className="font-medium">
            Occupancy and economic occupancy
          </h2>
          <Link
            href={`/admin/reports/occupancy.csv?month=${selectedMonth}`}
            className="text-sm underline underline-offset-2"
          >
            Export CSV
          </Link>
        </div>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Unit occupancy, square-foot occupancy and economic occupancy per facility for {label}
          </caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2 font-medium">Facility</th>
              <th scope="col" className="py-2 text-right font-medium">Occupied</th>
              <th scope="col" className="py-2 text-right font-medium">Rentable</th>
              <th scope="col" className="py-2 text-right font-medium">Unit occ.</th>
              <th scope="col" className="py-2 text-right font-medium">Sq-ft occ.</th>
              <th scope="col" className="py-2 text-right font-medium">Collected</th>
              <th scope="col" className="py-2 text-right font-medium">Economic occ.</th>
            </tr>
          </thead>
          <tbody>
            {occupancy.rows.map((row) => (
              <tr key={row.facilityId} className="border-b">
                <td className="py-2">
                  <Link href={`/admin/reports/rent-roll?facility=${row.facilityId}`} className="underline underline-offset-2">
                    {row.facilityName}
                  </Link>
                </td>
                <td className="py-2 text-right tabular-nums">{row.occupancy.occupiedCount}</td>
                <td className="py-2 text-right tabular-nums">{row.occupancy.rentableCount}</td>
                <td className="py-2 text-right tabular-nums">{percent(row.occupancy.ratio)}</td>
                <td className="py-2 text-right tabular-nums">{percent(row.occupancy.squareFootRatio)}</td>
                <td className="py-2 text-right tabular-nums">{formatCents(row.economic.collectedCents)}</td>
                <td className="py-2 text-right tabular-nums">{percent(row.economic.ratio)}</td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-2">All facilities</td>
              <td className="py-2 text-right tabular-nums">{occupancy.total.occupancy.occupiedCount}</td>
              <td className="py-2 text-right tabular-nums">{occupancy.total.occupancy.rentableCount}</td>
              <td className="py-2 text-right tabular-nums">{percent(occupancy.total.occupancy.ratio)}</td>
              <td className="py-2 text-right tabular-nums">{percent(occupancy.total.occupancy.squareFootRatio)}</td>
              <td className="py-2 text-right tabular-nums">{formatCents(occupancy.total.economic.collectedCents)}</td>
              <td className="py-2 text-right tabular-nums">{percent(occupancy.total.economic.ratio)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="moves-heading" className="flex flex-col gap-3">
        <h2 id="moves-heading" className="font-medium">
          Move-ins and move-outs
        </h2>
        <table className="w-full text-sm">
          <caption className="sr-only">Move-ins, move-outs, net and reservation conversion per facility for {label}</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2 font-medium">Facility</th>
              <th scope="col" className="py-2 text-right font-medium">Move-ins</th>
              <th scope="col" className="py-2 text-right font-medium">Move-outs</th>
              <th scope="col" className="py-2 text-right font-medium">Net</th>
              <th scope="col" className="py-2 text-right font-medium">Reservations</th>
              <th scope="col" className="py-2 text-right font-medium">Converted</th>
              <th scope="col" className="py-2 text-right font-medium">Avg days to move-in</th>
            </tr>
          </thead>
          <tbody>
            {moves.rows.map((row) => (
              <tr key={row.facilityId} className="border-b">
                <td className="py-2">{row.facilityName}</td>
                <td className="py-2 text-right tabular-nums">{row.moves.moveIns}</td>
                <td className="py-2 text-right tabular-nums">{row.moves.moveOuts}</td>
                <td className="py-2 text-right tabular-nums">{row.moves.net}</td>
                <td className="py-2 text-right tabular-nums">{row.conversion.reservations}</td>
                <td className="py-2 text-right tabular-nums">
                  {row.conversion.converted} ({percent(row.conversion.conversionRatio)})
                </td>
                <td className="py-2 text-right tabular-nums">
                  {row.conversion.averageDaysToMoveIn === null
                    ? '—'
                    : row.conversion.averageDaysToMoveIn.toFixed(1)}
                </td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-2">All facilities</td>
              <td className="py-2 text-right tabular-nums">{moves.total.moves.moveIns}</td>
              <td className="py-2 text-right tabular-nums">{moves.total.moves.moveOuts}</td>
              <td className="py-2 text-right tabular-nums">{moves.total.moves.net}</td>
              <td className="py-2 text-right tabular-nums">{moves.total.conversion.reservations}</td>
              <td className="py-2 text-right tabular-nums">
                {moves.total.conversion.converted} ({percent(moves.total.conversion.conversionRatio)})
              </td>
              <td className="py-2 text-right tabular-nums">—</td>
            </tr>
          </tbody>
        </table>
        {/* B-082 part 1. Two splits of the SAME move-ins, which is why they are
            two tables and not one: they are different questions, and a reader
            who takes them for one breakdown will double-count. `bySource` has
            been computed since B-097 and rendered nowhere, and the paragraph
            that used to sit here still told the operator that "nothing records
            how a rental was acquired" — untrue for months, on the screen where
            the operator decides what to keep paying for. */}
        <div className="grid gap-6 sm:grid-cols-2">
          <MoveSplit
            heading="Move-ins by channel"
            hint="Where the renter came from. An aggregator charges per completed move-in, so this is the column that has a bill attached."
            counts={moves.total.moves.byChannel}
            labels={CHANNEL_LABELS}
            total={moves.total.moves.moveIns}
          />
          <MoveSplit
            heading="Move-ins by source"
            hint="How the deal was taken. A marketplace rental is “web” here and “aggregator” above — both are true."
            counts={moves.total.moves.bySource}
            labels={SOURCE_LABELS}
            total={moves.total.moves.moveIns}
          />
        </div>
      </section>

      {/* Financial only. `delinquencyReport` scopes to the facilities the
          actor holds `reports:financial` at, so a counter agent with only the
          operational key gets an empty table rather than the portfolio's AR —
          this hides the empty table too. */}
      <section aria-labelledby="ar-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ar-heading" className="font-medium">
            Outstanding balances by age
          </h2>
          <Link href="/admin/reports/delinquency" className="text-sm underline underline-offset-2">
            Tenant detail and CSV
          </Link>
        </div>
        {/* Wide table: scrolls inside its own container rather than pushing the
            page sideways. */}
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Outstanding balances per facility, aged into 0–10, 11–30, 31–60, 61–90 and over-90-day
              buckets
            </caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 font-medium">Facility</th>
                {AR_BUCKET_LABELS.map(([key, label]) => (
                  <th key={key} scope="col" className="py-2 text-right font-medium">
                    {label}
                  </th>
                ))}
                <th scope="col" className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {delinquency.rows.map((row) => (
                <tr key={row.facilityId} className="border-b">
                  <td className="py-2">{row.facilityName}</td>
                  {AR_BUCKET_LABELS.map(([key]) => (
                    <td key={key} className="py-2 text-right tabular-nums">
                      {formatCents(row.aging[key])}
                    </td>
                  ))}
                  <td className="py-2 text-right tabular-nums">{formatCents(row.aging.totalCents)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-2">All facilities</td>
                {AR_BUCKET_LABELS.map(([key]) => (
                  <td key={key} className="py-2 text-right tabular-nums">
                    {formatCents(delinquency.total[key])}
                  </td>
                ))}
                <td className="py-2 text-right tabular-nums">{formatCents(delinquency.total.totalCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-sm text-pretty">
          Days past due are counted from the oldest unpaid invoice&apos;s original due date — not
          from the last card retry, so a lease that has declined several times keeps ageing instead
          of resetting to current.
        </p>
      </section>
    </div>
  )
}
