import Link from 'next/link'
import { EmptyState } from '@/components/ui/empty-state'
import { DataTable } from '@/components/ui/data-table'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { funnelReport } from '@/lib/analytics/funnel'
import { reportRangeForActor } from '@/lib/admin/reports'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Funnel' }

// PRD 04 US-15 AC4 (B-069). "Sessions → leads → reservations started →
// completed → move-ins, filterable by date range and source/medium; conversion
// rates at each step."
//
// Every number here comes from the SERVER event log, not a vendor — FR-AN-2.
// That is what makes it survive an ad blocker and a declined consent, and it is
// why the page can say what it says at the bottom.

function percent(ratio: number | null): string {
  return ratio === null ? '—' : `${(ratio * 100).toFixed(1)}%`
}

/// The options a filter dropdown offers, always including whatever is
/// currently applied.
///
/// Found while building B-082 part 4, and it was already true of the channel
/// filter B-069 shipped. The lists come from the rows in range, so a filter
/// carried in from a bookmark, a shared link or the back button for a value
/// that no longer appears there renders as "Every source" — while the report
/// underneath it IS still filtered and shows almost nothing. The control and
/// the data disagree, and the control is the half a person believes.
///
/// Adding the applied value back is the whole fix: the dropdown then always
/// says what is actually being shown, and picking "Every source" clears it.
function optionsFor(available: string[], selected: string | undefined): string[] {
  if (!selected || available.includes(selected)) return available
  return [...available, selected].sort()
}

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string
    to?: string
    channel?: string
    /// B-082 part 4. `funnelReport` has accepted these since B-069 and nothing
    /// could set them — the exact shape of this repo's "a field that changes
    /// behaviour ships with its control" rule, in a report rather than a form.
    source?: string
    medium?: string
  }>
}) {
  const params = await searchParams
  const actor = await getAdminActor()
  const range = await reportRangeForActor(actor, params)

  if (!hasPermissionAnywhere(actor, ['reports:operational'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to reports.</p>
  }

  const report = await funnelReport(actor, {
    from: range.start,
    to: range.end,
    channel: params.channel || undefined,
    utmSource: params.source || undefined,
    utmMedium: params.medium || undefined,
  })

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Funnel — {range.label}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          How many people got from looking to moving in.{' '}
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
        <label className="flex flex-col gap-1 text-sm">
          Channel
          <select
            name="channel"
            defaultValue={params.channel ?? ''}
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          >
            <option value="">Every channel</option>
            {optionsFor(report.channels, params.channel).map((channel) => (
              <option key={channel} value={channel}>
                {channel.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Source
          <select
            name="source"
            defaultValue={params.source ?? ''}
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          >
            <option value="">Every source</option>
            {optionsFor(report.sources, params.source).map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Medium
          <select
            name="medium"
            defaultValue={params.medium ?? ''}
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          >
            <option value="">Every medium</option>
            {optionsFor(report.mediums, params.medium).map((medium) => (
              <option key={medium} value={medium}>
                {medium}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium"
        >
          Apply
        </button>
      </form>

      <ScrollRegion aria-label="Funnel steps">
        <DataTable className="min-w-2xl">
          <caption className="sr-only">
            Funnel steps with conversion rates for {range.label}
          </caption>
          <DataTable.Head>
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Step</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Sessions</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">From the step above</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">From the top</th>
            </tr>
          </DataTable.Head>
          <tbody>
            {report.steps.map((step) => (
              <DataTable.Row key={step.key} className="border-input border-b">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {step.label}
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{step.count}</td>
                {/* "From the step above" first, because it is the number
                    somebody can act on: "half the people who started a hold
                    finished it" is a fixable problem, while "0.3% of sessions
                    moved in" is a statistic. */}
                <td className="px-3 py-2 text-right tabular-nums">{percent(step.fromPrevious)}</td>
                <td className="px-3 text-muted-foreground py-2 text-right tabular-nums">
                  {percent(step.fromTop)}
                </td>
              </DataTable.Row>
            ))}
          </tbody>
        </DataTable>
      </ScrollRegion>

      <p className="text-muted-foreground max-w-prose text-xs text-pretty">
        Counted from this site&apos;s own server-side log, one session per step rather than one
        event — so a visitor who reloads a page six times is one session. Ad blockers and declined
        cookie consent do not remove anyone from these numbers, which is why they are the ones to
        trust when they disagree with an outside analytics tool.
      </p>

      {/* B-082 part 4. The funnel split by campaign source and medium.
          Every session is attributed to exactly one row, from its earliest
          event in the range (D-61), so these columns foot to the table above —
          which is the property that makes the breakdown worth reading rather
          than a second set of numbers to reconcile. */}
      <section aria-labelledby="by-source" className="flex flex-col gap-2">
        <h2 id="by-source" className="text-base font-semibold">
          By source and medium
        </h2>
        {report.bySourceMedium.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing in this range to break down.
          </p>
        ) : (
          <ScrollRegion aria-label="Funnel by source and medium">
            <DataTable className="min-w-2xl">
              <caption className="sr-only">
                Funnel steps by campaign source and medium for {range.label}. Rows total the
                figures in the funnel table above.
              </caption>
              <DataTable.Head>
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Source / medium</th>
                  {report.steps.map((step) => (
                    <th key={step.key} scope="col" className="px-3 py-2 text-right font-semibold">
                      {step.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Session to move-in</th>
                </tr>
              </DataTable.Head>
              <tbody>
                {report.bySourceMedium.map((row) => (
                  <DataTable.Row key={`${row.source ?? ''}/${row.medium ?? ''}`} className="border-input border-b">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {/* Untagged traffic is named, never dropped. It is
                          normally the largest row, and a breakdown that omits
                          its biggest row is worse than no breakdown at all. */}
                      {row.source || row.medium
                        ? `${row.source ?? '—'} / ${row.medium ?? '—'}`
                        : 'Direct or untagged'}
                    </th>
                    {row.steps.map((step) => (
                      <td key={step.key} className="px-3 py-2 text-right tabular-nums">
                        {step.count}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {percent(row.steps[row.steps.length - 1].fromTop)}
                    </td>
                  </DataTable.Row>
                ))}
              </tbody>
            </DataTable>
          </ScrollRegion>
        )}
      </section>

      {/* B-082 part 4. US-9 AC4 widened from the one sequence B-073 shipped to
          every sequence that can bring somebody back. */}
      <section aria-labelledby="sequences" className="flex flex-col gap-2">
        <h2 id="sequences" className="text-base font-semibold">
          Move-ins a follow-up brought back
        </h2>
        {report.sequenceMoveIns === 0 ? (
          <EmptyState>No move-ins in this range.</EmptyState>
        ) : (
          <>
            <DataTable>
              <caption className="sr-only">
                Move-ins credited to each follow-up sequence, out of{' '}
                {report.sequenceMoveIns} in {range.label}
              </caption>
              <DataTable.Head>
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Sequence</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Move-ins</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Share</th>
                </tr>
              </DataTable.Head>
              <tbody>
                {report.sequences.map((sequence) => (
                  <DataTable.Row key={sequence.key} className="border-input border-b">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {sequence.label}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{sequence.moveIns}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {percent(sequence.moveIns / report.sequenceMoveIns)}
                    </td>
                  </DataTable.Row>
                ))}
              </tbody>
            </DataTable>
            {/* Said in words rather than left for a reader to work out from a
                column that does not add up to 100%. One renter can be chased by
                the drip, abandon a checkout, and be brought back by the
                abandonment follow-up — all three are true of them. */}
            <p className="text-muted-foreground max-w-prose text-xs text-pretty">
              Out of {report.sequenceMoveIns} move-ins in this range. A renter can be counted in
              more than one row — being chased by the lead drip and then brought back from an
              abandoned checkout are both true of the same person — so these do not add up to the
              total and are not meant to.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
