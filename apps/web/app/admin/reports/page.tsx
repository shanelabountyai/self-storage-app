import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import {
  arAgingNote,
  attachRateReport,
  delinquencyReport,
  movesReport,
  occupancyReport,
  unitOccupancyNote,
} from '@/lib/admin/reports'
import { formatCents } from '@/lib/format'
import { UNASSIGNED_STAFF, type AttachRateBucket } from '@storage/core/metrics'

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

/// The attach-rate table (B-155): same shape for the by-channel and
/// by-staff splits, since both answer "move-ins, enrolled, rate" for a set of
/// buckets — only the row label differs. Rows with no move-ins are omitted,
/// same rule as `MoveSplit` above, for the same reason: a table of mostly
/// zeroes is one nobody scans.
function AttachSplit({
  heading,
  hint,
  buckets,
  labels,
  rowHeading,
}: {
  heading: string
  hint: string
  buckets: Record<string, AttachRateBucket>
  labels: Record<string, string>
  rowHeading: string
}) {
  const rows = Object.entries(buckets).filter(([, bucket]) => bucket.moveIns > 0)

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
                {rowHeading}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Move-ins
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Enrolled
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Attach rate
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, bucket]) => (
              <tr key={key} className="border-b">
                <th scope="row" className="py-2 font-normal">
                  {labels[key] ?? key}
                </th>
                <td className="py-2 text-right tabular-nums">{bucket.moveIns}</td>
                <td className="py-2 text-right tabular-nums">{bucket.enrolled}</td>
                <td className="py-2 text-right tabular-nums">{percent(bucket.rate)}</td>
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

  const [occupancy, moves, attach, delinquency] = await Promise.all([
    occupancyReport(actor, start, end),
    movesReport(actor, start, end),
    attachRateReport(actor, start, end),
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
        {/* B-195. The half of the aging report that has no answer inside it:
            which of the receivable is halted, behind what, and whether the
            plans that halted it are being kept. */}
        <Link
          href="/admin/reports/plans-holds"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Plans &amp; holds — what is not being chased
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
        {/* B-088 part 2. First of the month-level links, because it is the
            only one that answers "is this getting better" rather than "what
            happened". */}
        <Link
          href="/admin/reports/kpi"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          KPI trend — the direction, not just this month
        </Link>
        <Link
          href="/admin/reports/pack"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Management pack — the whole month on one page
        </Link>
        <Link
          href="/admin/reports/subscriptions"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Scheduled reports — send a report by email without opening this
        </Link>
        <Link
          href="/admin/reports/close"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Monthly close — file a month so its figures stop moving
        </Link>
        {/* B-090 part 1. Demand for inventory that does not exist — the one
            thing no other report here can show. */}
        <Link
          href="/admin/reports/waitlist"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Waitlist — who is waiting for a size you are full on
        </Link>
        {/* B-163. Beside the waitlist because both are worklists rather than
            period metrics — the attach-rate table above says how last month's
            move-ins were sold, this says which units are uninsured today, and
            a tenant who waived two years ago and lapsed appears only here. */}
        <Link
          href="/admin/reports/protection"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Uncovered units — occupied, with no plan and no current certificate
        </Link>
        {/* B-087 part 1. Next to indexation and duplicate content: all three
            are about whether what we publish is reaching search engines
            intact. */}
        <Link
          href="/admin/reports/structured-data"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Structured data — markup a page has stopped emitting
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
        {/* B-131. The date picker above implies the range applies to every
            figure in this table, and for unit and square-foot occupancy it
            only does once there is recorded status history covering it. The
            sentence is the TOTAL's, which is the weakest claim any row makes —
            when one facility can answer as-at and another cannot, this
            under-claims for the one that can, which is the safe direction.
            `aria-describedby` rather than a bare paragraph so a reader who
            jumps straight to the table by table navigation still gets it.
            B-183: only labelled "As of right now" when the note is actually
            declining the period — a table that DOES answer for the month
            picked needs no caveat heading at all. */}
        {occupancy.total.unitOccupancy.reason !== 'as-at-period-end' && (
          <h3 className="text-sm font-medium">As of right now</h3>
        )}
        <p id="occupancy-as-at" className="text-sm text-muted-foreground">
          {unitOccupancyNote(occupancy.total.unitOccupancy, label)}
        </p>
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-2xl text-sm" aria-describedby="occupancy-as-at">
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
                  {/* B-150 / FR-22. The facility names this row, so it is a
                      row header — a `<td>` leaves a screen reader announcing
                      "94%" with no way to know which site it belongs to. */}
                  <th scope="row" className="py-2 font-normal">
                    <Link href={`/admin/reports/rent-roll?facility=${row.facilityId}`} className="underline underline-offset-2">
                      {row.facilityName}
                    </Link>
                  </th>
                  <td className="py-2 text-right tabular-nums">{row.occupancy.occupiedCount}</td>
                  <td className="py-2 text-right tabular-nums">{row.occupancy.rentableCount}</td>
                  <td className="py-2 text-right tabular-nums">{percent(row.occupancy.ratio)}</td>
                  <td className="py-2 text-right tabular-nums">{percent(row.occupancy.squareFootRatio)}</td>
                  <td className="py-2 text-right tabular-nums">{formatCents(row.economic.collectedCents)}</td>
                  <td className="py-2 text-right tabular-nums">{percent(row.economic.ratio)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <th scope="row" className="py-2 font-medium">All facilities</th>
                <td className="py-2 text-right tabular-nums">{occupancy.total.occupancy.occupiedCount}</td>
                <td className="py-2 text-right tabular-nums">{occupancy.total.occupancy.rentableCount}</td>
                <td className="py-2 text-right tabular-nums">{percent(occupancy.total.occupancy.ratio)}</td>
                <td className="py-2 text-right tabular-nums">{percent(occupancy.total.occupancy.squareFootRatio)}</td>
                <td className="py-2 text-right tabular-nums">{formatCents(occupancy.total.economic.collectedCents)}</td>
                <td className="py-2 text-right tabular-nums">{percent(occupancy.total.economic.ratio)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="moves-heading" className="flex flex-col gap-3">
        <h2 id="moves-heading" className="font-medium">
          Move-ins and move-outs
        </h2>
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-2xl text-sm">
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
                  <th scope="row" className="py-2 font-normal">{row.facilityName}</th>
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
                <th scope="row" className="py-2 font-medium">All facilities</th>
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
        </div>
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

      {/* B-155 (operator review): US-44 already required attach rate be
          reportable and nothing owned it. Its own two-way split — channel and
          staff — is a coaching table, not a vanity metric (US-44's own
          wording), which is why it sits beside the acquisition splits above
          rather than folded into them: those answer where a move-in came
          from, this answers whether it left with protection. */}
      <section aria-labelledby="attach-heading" className="flex flex-col gap-3">
        <h2 id="attach-heading" className="font-medium">
          Protection attach rate
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">
          {attach.total.overall.enrolled} of {attach.total.overall.moveIns} new move-ins
          ({percent(attach.total.overall.rate)}) enrolled in a protection plan for {label}.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          <AttachSplit
            heading="Attach rate by channel"
            hint="How the deal was taken — same vocabulary as the move-ins-by-source split above."
            buckets={attach.total.byChannel}
            labels={SOURCE_LABELS}
            rowHeading="Channel"
          />
          <AttachSplit
            heading="Attach rate by staff"
            hint="The staff member who took the move-in's first payment. “Web / self-service” is every move-in nobody was behind the counter for — a card payment taken online has no staffer to coach."
            buckets={attach.total.byStaff}
            labels={{ ...attach.staffNames, [UNASSIGNED_STAFF]: 'Web / self-service' }}
            rowHeading="Staff"
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
        {/* B-150. The same defect B-131 fixed two sections up, in the same
            file: the picker above implies these buckets answer for the month
            chosen, and they never have. D-65 rules out making them, so the
            sentence names the instant they DO answer for. `aria-describedby`
            rather than a bare paragraph, for B-131's reason — a reader who
            jumps to the table by table navigation still gets it.
            B-183: AR aging never answers for the period (D-65), so unlike the
            occupancy note above this heading is unconditional — and the
            sentence itself dropped its "because…" justification, which argued
            where a reader needed a fact. */}
        <h3 className="text-sm font-medium">As of right now</h3>
        <p id="ar-as-at" className="text-muted-foreground text-sm text-pretty">
          {arAgingNote(delinquency.asOf, delinquency.timezone, label)}
        </p>
        {/* Wide table: scrolls inside its own container rather than pushing the
            page sideways. */}
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full text-sm" aria-describedby="ar-as-at">
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
                  <th scope="row" className="py-2 font-normal">{row.facilityName}</th>
                  {AR_BUCKET_LABELS.map(([key]) => (
                    <td key={key} className="py-2 text-right tabular-nums">
                      {formatCents(row.aging[key])}
                    </td>
                  ))}
                  <td className="py-2 text-right tabular-nums">{formatCents(row.aging.totalCents)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <th scope="row" className="py-2 font-medium">All facilities</th>
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
