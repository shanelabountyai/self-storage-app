import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { reportRange } from '@/lib/admin/report-range'
import { funnelReport } from '@/lib/analytics/funnel'

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

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; channel?: string }>
}) {
  const params = await searchParams
  const range = reportRange(params)
  const actor = await getAdminActor()

  if (!hasPermissionAnywhere(actor, ['reports:operational'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to reports.</p>
  }

  const report = await funnelReport(actor, {
    from: range.start,
    to: range.end,
    channel: params.channel || undefined,
  })

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Funnel — {range.label}</h1>
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
            {report.channels.map((channel) => (
              <option key={channel} value={channel}>
                {channel.replace(/_/g, ' ')}
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

      <div tabIndex={0} className="overflow-x-auto">
        <table className="w-full min-w-2xl border-collapse text-sm">
          <caption className="sr-only">
            Funnel steps with conversion rates for {range.label}
          </caption>
          <thead>
            <tr className="border-input border-b text-left">
              <th scope="col" className="py-2 pr-4">Step</th>
              <th scope="col" className="py-2 pr-4 text-right">Sessions</th>
              <th scope="col" className="py-2 pr-4 text-right">From the step above</th>
              <th scope="col" className="py-2 pr-4 text-right">From the top</th>
            </tr>
          </thead>
          <tbody>
            {report.steps.map((step) => (
              <tr key={step.key} className="border-input border-b">
                <th scope="row" className="py-2 pr-4 text-left font-medium">
                  {step.label}
                </th>
                <td className="py-2 pr-4 text-right tabular-nums">{step.count}</td>
                {/* "From the step above" first, because it is the number
                    somebody can act on: "half the people who started a hold
                    finished it" is a fixable problem, while "0.3% of sessions
                    moved in" is a statistic. */}
                <td className="py-2 pr-4 text-right tabular-nums">{percent(step.fromPrevious)}</td>
                <td className="text-muted-foreground py-2 pr-4 text-right tabular-nums">
                  {percent(step.fromTop)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground max-w-prose text-xs text-pretty">
        Counted from this site&apos;s own server-side log, one session per step rather than one
        event — so a visitor who reloads a page six times is one session. Ad blockers and declined
        cookie consent do not remove anyone from these numbers, which is why they are the ones to
        trust when they disagree with an outside analytics tool.
      </p>

      {report.abandonmentRecovery.moveIns > 0 && (
        <p className="text-sm">
          <span className="font-medium">{report.abandonmentRecovery.recovered}</span> of{' '}
          {report.abandonmentRecovery.moveIns} move-ins in this range came from a checkout the
          abandonment follow-up brought back (
          {percent(report.abandonmentRecovery.recovered / report.abandonmentRecovery.moveIns)}).
        </p>
      )}
    </div>
  )
}
