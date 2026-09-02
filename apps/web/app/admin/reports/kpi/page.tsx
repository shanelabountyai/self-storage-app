import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { formatCents } from '@/lib/format'
import { DEFAULT_MONTHS, delta, kpiTrend, type KpiPoint } from '@/lib/admin/kpi-trend'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'KPI trend' }

// PRD 00 §6 Phase 3 — the owner KPI dashboard (B-088 part 2).
//
// **What this adds that the two existing surfaces do not is TIME.** `/admin`
// (B-042) answers "how are we doing right now" and every report answers "how
// did we do in this period"; neither answers "is it getting better", which is
// the only question an owner who is not running the counter actually asks.
//
// It reads the FILED month-end snapshots and never recomputes a past month —
// see lib/admin/kpi-trend.ts for why that is correctness rather than speed.

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

function monthLabel(point: { year: number; month: number }): string {
  return `${MONTH_NAMES[point.month - 1]} ${point.year}`
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

/// A change, in words as well as a sign — FR-23 forbids colour as the only
/// carrier, and a bare arrow is the same failure with a different glyph.
function Delta({ value, format }: { value: number | null; format: (v: number) => string }) {
  if (value === null) {
    return <span className="text-muted-foreground text-xs">no earlier month to compare</span>
  }
  if (value === 0) return <span className="text-muted-foreground text-xs">unchanged</span>
  const up = value > 0
  return (
    <span className={`text-xs ${up ? 'text-green-800' : 'text-red-800'}`}>
      {up ? 'up' : 'down'} {format(Math.abs(value))} on the month before
    </span>
  )
}

function Headline({
  label,
  value,
  change,
}: {
  label: string
  value: string
  change: React.ReactNode
}) {
  return (
    <div className="border-input flex flex-col gap-1 rounded-md border p-3">
      <h3 className="text-muted-foreground text-sm">{label}</h3>
      <p className="text-xl font-semibold">{value}</p>
      {change}
    </div>
  )
}

export default async function OwnerKpiPage() {
  const actor = await getAdminActor()

  if (!hasPermissionAnywhere(actor, ['reports:rollup', 'reports:financial'])) {
    return (
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        The KPI trend is a portfolio view, so it is for an owner or a manager assigned to every
        facility.
      </p>
    )
  }

  const { points, missing, facilityCount } = await kpiTrend(actor)
  const latest: KpiPoint | undefined = points[points.length - 1]

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">KPI trend</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          The last {DEFAULT_MONTHS} months across {facilityCount}{' '}
          {facilityCount === 1 ? 'facility' : 'facilities'}, from the figures each month was closed
          with. Today&apos;s numbers are on the{' '}
          <Link href="/admin" className="underline underline-offset-2">
            dashboard
          </Link>
          ; this page is about the direction they are moving.
        </p>
      </header>

      {points.length === 0 ? (
        <p className="border-input rounded-md border p-3 text-sm text-pretty">
          No month has been closed yet, so there is nothing to trend. Figures appear here once a
          month is closed on{' '}
          <Link href="/admin/reports/close" className="underline underline-offset-2">
            the monthly close
          </Link>{' '}
          — which is deliberate: occupancy and receivables cannot be recovered accurately after the
          fact, so the closed figures are the only honest record of a past month.
        </p>
      ) : (
        <>
          <section aria-labelledby="latest-heading" className="flex flex-col gap-3">
            <h2 id="latest-heading" className="font-medium">
              {monthLabel(latest!)}, the most recent closed month
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Headline
                label="Unit occupancy"
                value={percent(latest!.unitOccupancyRatio)}
                change={
                  <Delta
                    value={delta(points, (p) => p.unitOccupancyRatio)}
                    format={(v) => `${(v * 100).toFixed(1)} points`}
                  />
                }
              />
              <Headline
                label="Economic occupancy"
                value={percent(latest!.economicOccupancyRatio)}
                change={
                  <Delta
                    value={delta(points, (p) => p.economicOccupancyRatio)}
                    format={(v) => `${(v * 100).toFixed(1)} points`}
                  />
                }
              />
              <Headline
                label="Collected"
                value={formatCents(latest!.collectedCents)}
                change={
                  <Delta value={delta(points, (p) => p.collectedCents)} format={formatCents} />
                }
              />
              <Headline
                label="Receivables outstanding"
                value={formatCents(latest!.arTotalCents)}
                change={<Delta value={delta(points, (p) => p.arTotalCents)} format={formatCents} />}
              />
              <Headline
                label="Net moves"
                value={`${latest!.netMoves > 0 ? '+' : ''}${latest!.netMoves}`}
                change={
                  <Delta value={delta(points, (p) => p.netMoves)} format={(v) => `${v} units`} />
                }
              />
            </div>
            {latest!.facilityIds.length < facilityCount && (
              // The failure this prevents: one site not closing its books looks
              // exactly like the portfolio falling off a cliff.
              <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-pretty text-amber-900">
                Only {latest!.facilityIds.length} of {facilityCount} facilities have closed{' '}
                {monthLabel(latest!)}. These totals cover those sites alone, so they are not
                comparable with a month where every site filed.
              </p>
            )}
          </section>

          <section aria-labelledby="trend-heading" className="flex flex-col gap-3">
            <h2 id="trend-heading" className="font-medium">
              Month by month
            </h2>
            <ScrollRegion aria-label="Closed-month figures">
              <table className="w-full min-w-3xl text-left text-sm">
                <caption className="sr-only">
                  Closed-month figures across the portfolio, oldest first
                </caption>
                <thead>
                  <tr className="border-input border-b">
                    <th scope="col" className="py-2 pr-4 font-medium">Month</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Sites filed</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Unit occ.</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Economic occ.</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Collected</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Receivables</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Net moves</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((point) => (
                    <tr key={`${point.year}-${point.month}`} className="border-input border-b">
                      <td className="py-2 pr-4 whitespace-nowrap">{monthLabel(point)}</td>
                      <td className="py-2 pr-4">
                        {point.facilityIds.length} of {facilityCount}
                      </td>
                      <td className="py-2 pr-4">{percent(point.unitOccupancyRatio)}</td>
                      <td className="py-2 pr-4">{percent(point.economicOccupancyRatio)}</td>
                      <td className="py-2 pr-4">{formatCents(point.collectedCents)}</td>
                      <td className="py-2 pr-4">{formatCents(point.arTotalCents)}</td>
                      <td className="py-2 pr-4">
                        {point.netMoves > 0 ? '+' : ''}
                        {point.netMoves}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </section>
        </>
      )}

      {missing.length > 0 && (
        // Named, never drawn as a zero. A gap plotted at zero is a collapse
        // that did not happen, and it is the most dangerous thing a trend can
        // show an owner.
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Not shown, because no facility has closed them yet:{' '}
          {missing.map(monthLabel).join(', ')}. A month with no closed books is left out rather than
          drawn as zero.
        </p>
      )}
    </div>
  )
}
