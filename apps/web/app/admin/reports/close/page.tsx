import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { driftFor, periodsFor, type PeriodRow } from '@/lib/admin/accounting-close'
import { driftSummary, type DriftRow } from '@storage/core/accounting'
import { formatCents } from '@/lib/format'
import { closePeriodAction, reopenPeriodAction } from './actions'

export const metadata = { title: 'Monthly close' }

// PRD 02 §8, US-40 (B-084 part 1). Filing a month's books.
//
// The screen is built around the distinction the feature turns on: the figures
// that can only ever be observed once are labelled as such, and the drift
// check is offered only against the ones a later run can genuinely reproduce.
// Presenting one undifferentiated table would either cry wolf about occupancy
// changing (it always will) or imply AR aging is checkable (it is not).

export const dynamic = 'force-dynamic'

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

function formatDrift(row: DriftRow, value: number): string {
  if (row.kind === 'cents') return formatCents(value)
  if (row.kind === 'ratio') return percent(value)
  return String(value)
}

function FiledFigures({ period }: { period: PeriodRow }) {
  if (!period.snapshot) return null
  const { pointInTime: point, periodDerived: derived } = period.snapshot

  return (
    <div className="mt-3 grid gap-4 sm:grid-cols-2">
      <div>
        <h4 className="text-xs font-medium">Only knowable at the time</h4>
        <p className="text-muted-foreground mt-1 text-xs text-pretty">
          Nothing records what a unit&apos;s status was, and the aging report takes no date — so
          these are the only record of this month that will ever exist.
        </p>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 text-sm">
          <dt className="text-muted-foreground">Unit occupancy</dt>
          <dd className="tabular-nums">{percent(point.unitOccupancyRatio)}</dd>
          <dt className="text-muted-foreground">Occupied of rentable</dt>
          <dd className="tabular-nums">
            {point.occupiedUnits} of {point.rentableUnits}
          </dd>
          <dt className="text-muted-foreground">Square-foot occupancy</dt>
          <dd className="tabular-nums">{percent(point.squareFootRatio)}</dd>
          <dt className="text-muted-foreground">Owed, not yet due</dt>
          <dd className="tabular-nums">{formatCents(point.arD0to10Cents)}</dd>
          <dt className="text-muted-foreground">11–30 days</dt>
          <dd className="tabular-nums">{formatCents(point.arD11to30Cents)}</dd>
          <dt className="text-muted-foreground">31–60 days</dt>
          <dd className="tabular-nums">{formatCents(point.arD31to60Cents)}</dd>
          <dt className="text-muted-foreground">61–90 days</dt>
          <dd className="tabular-nums">{formatCents(point.arD61to90Cents)}</dd>
          <dt className="text-muted-foreground">Over 90 days</dt>
          <dd className="tabular-nums">{formatCents(point.arOver90Cents)}</dd>
          <dt className="font-medium">Total owed</dt>
          <dd className="font-medium tabular-nums">{formatCents(point.arTotalCents)}</dd>
        </dl>
      </div>

      <div>
        <h4 className="text-xs font-medium">Recomputable from dated rows</h4>
        <p className="text-muted-foreground mt-1 text-xs text-pretty">
          These come from rows carrying their own dates, so the same query can be run again — which
          is what makes the check below meaningful.
        </p>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 text-sm">
          <dt className="text-muted-foreground">Billed</dt>
          <dd className="tabular-nums">{formatCents(derived.billedCents)}</dd>
          <dt className="text-muted-foreground">Collected</dt>
          <dd className="tabular-nums">{formatCents(derived.collectedCents)}</dd>
          <dt className="text-muted-foreground">Discounts given</dt>
          <dd className="tabular-nums">{formatCents(derived.discountsCents)}</dd>
          <dt className="text-muted-foreground">Referral rewards</dt>
          <dd className="tabular-nums">{formatCents(derived.referralRewardsCents)}</dd>
          <dt className="text-muted-foreground">Written off</dt>
          <dd className="tabular-nums">{formatCents(derived.writeOffsCents)}</dd>
          <dt className="text-muted-foreground">Refunded</dt>
          <dd className="tabular-nums">{formatCents(derived.refundsCents)}</dd>
          <dt className="text-muted-foreground">Unapplied</dt>
          <dd className="tabular-nums">{formatCents(derived.unappliedCents)}</dd>
          <dt className="text-muted-foreground">Economic occupancy</dt>
          <dd className="tabular-nums">{percent(derived.economicOccupancyRatio)}</dd>
          <dt className="text-muted-foreground">Move-ins / outs</dt>
          <dd className="tabular-nums">
            {derived.moveIns} / {derived.moveOuts}
          </dd>
        </dl>
      </div>
    </div>
  )
}

export default async function MonthlyClosePage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (!hasPermissionAnywhere(actor, ['accounting:close'])) {
    return (
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        You don&apos;t have access to the monthly close. Filing a month fixes the figures a site is
        measured on, so it is held above facility settings.
      </p>
    )
  }
  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm text-pretty">
        Pick a specific facility above — each one keeps its own books, on its own timezone, so a
        month is closed per facility rather than across the portfolio.
      </p>
    )
  }

  const facilityId = selected.facility.id
  const periods = await periodsFor(actor, facilityId)
  // Drift only for closed months, and only the most recent handful — each one
  // re-runs the report layer, and an operator opening this screen is looking at
  // the months they might still restate.
  const closed = periods.filter((period) => period.closedAt !== null).slice(0, 3)
  const drifts = new Map<string, DriftRow[]>()
  for (const period of closed) {
    const rows = await driftFor(actor, facilityId, period.year, period.month)
    if (rows) drifts.set(`${period.year}-${period.month}`, rows)
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Monthly close — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Filing a month freezes its figures so they stop moving. Two of them cannot be recovered
          any other way: nothing here records what a unit&apos;s status used to be, and the aging
          report has no date parameter — so once a month has passed, &ldquo;what did we look like on
          the last day of it&rdquo; is a question only a filed copy can answer.{' '}
          <Link href="/admin/reports" className="underline underline-offset-2">
            Back to reports
          </Link>
          .
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {periods.map((period) => {
          const drift = drifts.get(`${period.year}-${period.month}`)
          const isClosed = period.closedAt !== null

          return (
            <li key={period.label} className="border-input rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">{period.label}</h2>
                  <p className="text-muted-foreground mt-1 text-xs text-pretty">
                    {/* The word, never a colour alone (WCAG 1.4.1). */}
                    {isClosed ? (
                      <>
                        <span className="font-medium">Closed</span>
                        {period.closedBy ? ` by ${period.closedBy}` : ''} on{' '}
                        {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(
                          period.closedAt!,
                        )}
                      </>
                    ) : period.ended ? (
                      <span className="font-medium">Open — ready to close</span>
                    ) : (
                      <span className="font-medium">Open — this month has not finished yet</span>
                    )}
                  </p>
                </div>

                {!isClosed && period.ended && (
                  <AdminForm
                    action={closePeriodAction}
                    label={`Close ${period.label}`}
                    className="flex flex-col gap-2"
                  >
                    <input type="hidden" name="facilityId" value={facilityId} />
                    <input type="hidden" name="year" value={period.year} />
                    <input type="hidden" name="month" value={period.month} />
                    <Button type="submit">Close {period.label}</Button>
                  </AdminForm>
                )}
              </div>

              {isClosed && <FiledFigures period={period} />}

              {isClosed && drift && (
                <div className="mt-4 border-t pt-3">
                  <h3 className="text-sm font-medium">Since it was filed</h3>
                  <p
                    className={
                      drift.length > 0
                        ? 'mt-1 rounded-md border-2 border-amber-500 bg-amber-50 p-3 text-sm text-pretty text-amber-950'
                        : 'text-muted-foreground mt-1 text-sm text-pretty'
                    }
                    {...(drift.length > 0 ? { role: 'alert' as const } : {})}
                  >
                    {driftSummary(drift)}
                  </p>

                  {drift.length > 0 && (
                    <div tabIndex={0} className="mt-3 overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <caption className="sr-only">
                          Figures that no longer match what was filed for {period.label}
                        </caption>
                        <thead>
                          <tr className="text-muted-foreground">
                            <th scope="col" className="pb-1 font-normal">
                              Figure
                            </th>
                            <th scope="col" className="pb-1 text-right font-normal">
                              Filed
                            </th>
                            <th scope="col" className="pb-1 text-right font-normal">
                              Today
                            </th>
                            <th scope="col" className="pb-1 text-right font-normal">
                              Difference
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {drift.map((row) => (
                            <tr key={row.key}>
                              <th scope="row" className="py-1 text-left font-normal">
                                {row.label}
                              </th>
                              <td className="py-1 text-right tabular-nums">
                                {formatDrift(row, row.filedValue)}
                              </td>
                              <td className="py-1 text-right tabular-nums">
                                {formatDrift(row, row.currentValue)}
                              </td>
                              <td className="py-1 text-right tabular-nums">
                                {/* Signed, because the direction is the
                                    information — money appearing after a close
                                    is a different problem from money going. */}
                                {row.deltaValue > 0 ? '+' : ''}
                                {formatDrift(row, row.deltaValue)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {isClosed && (
                <AdminForm
                  action={reopenPeriodAction}
                  label={`Reopen ${period.label}`}
                  className="mt-4 flex flex-col gap-2 border-t pt-3"
                >
                  <input type="hidden" name="facilityId" value={facilityId} />
                  <input type="hidden" name="year" value={period.year} />
                  <input type="hidden" name="month" value={period.month} />
                  <Field
                    name="reason"
                    label="Why is this month being reopened?"
                    hint="Reopening means restating figures that have already been reported. The filed set is kept in the audit log and nowhere else."
                  />
                  <Button type="submit" variant="outline" className="self-start">
                    Reopen {period.label}
                  </Button>
                </AdminForm>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
