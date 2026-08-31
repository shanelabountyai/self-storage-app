import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { plansAndHoldsReport, type HaltedLeaseRow } from '@/lib/admin/plans-holds-report'
import { formatCents } from '@/lib/format'

export const metadata = { title: 'Plans & holds' }

// PRD 02 §4.7 US-39.4, §4.6 US-25/US-26, §4.5 US-42 (B-195). The list behind
// the aging report's "halted" column.
//
// Two clocks on one screen, and the page says which is which rather than
// leaving a reader to assume the month picker governs everything (D-65): the
// plan figures answer for the month, the halted list answers for right now,
// because holds and plan status keep no history to answer a range with.

export const dynamic = 'force-dynamic'

const PLAN_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  broken: 'Broken',
  cancelled: 'Cancelled',
}

const LEASE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  active: 'Active',
  delinquent: 'Delinquent',
  pending_auction: 'Pending auction',
  ended: 'Moved out',
}

function monthBounds(month: string): { start: Date; end: Date; label: string } {
  const [year, monthIndex] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, monthIndex - 1, 1))
  const end = new Date(Date.UTC(year, monthIndex, 1))
  return {
    start,
    end,
    label: new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(start),
  }
}

function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function formatInstant(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/// What is meant to happen next on this lease, in words.
///
/// A hold with no plan is the case worth spotting: it is deferral with nothing
/// agreed in return, and it reads the same as a plan on this screen unless the
/// cell says so.
function nextStepText(row: HaltedLeaseRow): string {
  if (!row.plan) return 'No plan — halted by the hold alone'
  if (row.plan.status !== 'active') {
    return `Plan ${PLAN_STATUS_LABELS[row.plan.status].toLowerCase()} — no installment due`
  }
  if (!row.plan.nextInstallment) return 'Every installment covered'
  const { dueDate, amountCents } = row.plan.nextInstallment
  return `${formatCents(amountCents)} on ${formatDate(dueDate)}`
}

export default async function PlansHoldsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const actor = await getAdminActor()

  if (!hasPermissionAnywhere(actor, ['reports:financial'])) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have access to financial reports.
      </p>
    )
  }

  const selectedMonth = month ?? currentMonth()
  const { start, end, label } = monthBounds(selectedMonth)
  const report = await plansAndHoldsReport(actor, start, end)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Plans &amp; holds</h1>
          <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
            The money the delinquency ladder is <strong>not</strong> chasing, and why. Every lease
            under a hold that stops collections — an agreed payment plan, a bankruptcy, a
            deployment, a death — with what is deferred and how long it has been that way.
          </p>
        </div>
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <label htmlFor="month" className="flex flex-col gap-1 text-sm">
            Month for the plan figures
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

      <nav aria-label="Related reports" className="flex flex-wrap gap-3">
        {/* B-207. Named for what it exports rather than for the page it sits
            on. The file carries the halted list as of now and nothing else —
            the plan-effectiveness figures below answer for the chosen month,
            and a file where half the rows answered for a month and half did
            not would be worse than two files. That was already the deliberate
            design (see the route's own note); the only thing missing was
            saying so on the screen, where a reader picks a month, presses
            Download and gets a file the month never touched. */}
        <Link
          href="/admin/reports/plans-holds.csv"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Download the halted list (CSV)
        </Link>
        <Link
          href="/admin/reports/delinquency"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Delinquency aging
        </Link>
        <Link
          href="/admin/reports"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          All reports
        </Link>
      </nav>
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        The CSV is the halted list as it stands right now. It does not carry the plan
        effectiveness figures, and the month above does not change it.
      </p>

      <section aria-labelledby="halted-heading" className="flex flex-col gap-3">
        <h2 id="halted-heading" className="font-medium">
          Halted right now
        </h2>
        {/* D-65. Holds and plan status keep no history, so this half of the
            page answers for one instant and cannot answer for the month
            chosen above. Said out loud rather than left to be inferred from a
            picker sitting at the top of the screen. */}
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          As of {formatInstant(report.asOf)}. This list is point-in-time — a hold records when it
          started and whether it is still on, not what was halted on a date in the past, so the
          month above changes the plan figures below and nothing here.
        </p>

        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Leases halted</dt>
            <dd className="text-xl font-semibold">{report.haltedLeaseCount}</dd>
          </div>
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Deferred behind a hold</dt>
            <dd className="text-xl font-semibold">
              {formatCents(report.totalDeferredCents)}
              <p className="text-muted-foreground mt-1 text-xs font-normal text-pretty">
                Owed, and not being chased. The same money the aging report shows as halted.
              </p>
            </dd>
          </div>
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">On a live plan</dt>
            <dd className="text-xl font-semibold">
              {report.facilities.reduce(
                (count, facility) =>
                  count + facility.rows.filter((row) => row.plan?.status === 'active').length,
                0,
              )}
              <p className="text-muted-foreground mt-1 text-xs font-normal text-pretty">
                Of the halted leases, how many have something agreed in return.
              </p>
            </dd>
          </div>
        </dl>

        {report.haltedLeaseCount === 0 ? (
          <p className="text-sm">
            Nothing is halted at any facility you can see. Every balance is in the delinquency
            ladder&apos;s hands.
          </p>
        ) : (
          report.facilities
            .filter((facility) => facility.rows.length > 0)
            .map((facility) => (
              <details key={facility.facilityId} className="border-input rounded-lg border p-4">
                {/* Named after the facility, not "Details" repeated once per
                    site — a screen-reader user listing the page's disclosures
                    hears which one is which (2.4.6). */}
                <summary className="cursor-pointer text-sm font-medium">
                  {facility.facilityName} — {facility.rows.length}{' '}
                  {facility.rows.length === 1 ? 'lease' : 'leases'} halted,{' '}
                  {formatCents(facility.deferredCents)} deferred
                </summary>
                <div tabIndex={0} className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-4xl border-collapse text-sm">
                    <caption className="sr-only">
                      Leases halted at {facility.facilityName}, longest halted first
                    </caption>
                    <thead>
                      <tr className="border-input border-b text-left">
                        <th scope="col" className="py-2 pr-4">
                          Tenant
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Unit
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Lease
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Halted by
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right">
                          Days halted
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Plan
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Next due
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right">
                          Deferred
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {facility.rows.map((row) => (
                        <tr key={row.leaseId} className="border-input border-b">
                          <th scope="row" className="py-2 pr-4 text-left font-medium">
                            <Link
                              href={`/admin/tenants/${row.tenantId}`}
                              className="underline underline-offset-2"
                            >
                              {row.tenantName}
                            </Link>
                          </th>
                          <td className="py-2 pr-4">{row.unitNumber}</td>
                          <td className="py-2 pr-4">
                            {LEASE_STATUS_LABELS[row.leaseStatus] ?? row.leaseStatus}
                          </td>
                          {/* The reason in words. Never a badge colour — a
                              bankruptcy and a payment plan are opposite
                              situations and both are "halted" (1.4.1). */}
                          <td className="py-2 pr-4">
                            {row.holdLabels.join(', ')}
                            {row.otherHoldLabels.length > 0 && (
                              <span className="text-muted-foreground block text-xs">
                                Also on: {row.otherHoldLabels.join(', ')}
                              </span>
                            )}
                            <span className="text-muted-foreground block text-xs">
                              Since {formatDate(row.haltedSince)}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">{row.daysHalted}</td>
                          <td className="py-2 pr-4">
                            {row.plan ? (
                              <>
                                {PLAN_STATUS_LABELS[row.plan.status]}
                                <span className="text-muted-foreground block text-xs">
                                  {formatCents(row.plan.collectedCents)} of{' '}
                                  {formatCents(row.plan.totalCents)} cleared
                                  {row.plan.missedCount > 0 && (
                                    <> · {row.plan.missedCount} missed</>
                                  )}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">None</span>
                            )}
                          </td>
                          <td className="py-2 pr-4">{nextStepText(row)}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {formatCents(row.deferredCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))
        )}
      </section>

      <section aria-labelledby="effectiveness-heading" className="flex flex-col gap-3">
        <h2 id="effectiveness-heading" className="font-medium">
          Do the plans work — {label}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Plans agreed in this month, and what became of them. <strong>Collected</strong> is money
          somebody paid; <strong>waived</strong> is arrears a manager forgave by voiding an
          invoice. The debt came down either way, which is why they sit side by side — plans made
          agreeable by writing the fees off are not plans that worked. Collected, waived and{' '}
          <strong>still owed on broken plans</strong> are read from the invoices as they stand
          today, not as they stood at the end of the month — a tenant who pays late moves those
          figures for a month already past, and a plan agreed in one month can break in another,
          which is why a broken plan is counted in the month it broke rather than the month it was
          agreed.
        </p>
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse text-sm">
            <caption className="sr-only">
              Payment plans agreed, collected, waived, broken and completed in {label}, per facility
            </caption>
            <thead>
              <tr className="border-input border-b text-left">
                <th scope="col" className="py-2 pr-4">
                  Facility
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Plans agreed
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Put on plans
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Collected
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Waived
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Plans broken
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Still owed on those
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Plans completed
                </th>
              </tr>
            </thead>
            <tbody>
              {report.facilities.map((facility) => (
                <tr key={facility.facilityId} className="border-input border-b">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">
                    {facility.facilityName}
                  </th>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {facility.effectiveness.agreedCount}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(facility.effectiveness.agreedCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(facility.effectiveness.collectedCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(facility.effectiveness.waivedCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {facility.effectiveness.brokenCount}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(facility.effectiveness.brokenCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {facility.effectiveness.completedCount}
                  </td>
                </tr>
              ))}
              {report.facilities.length > 0 && (
                <tr className="border-input border-b font-semibold">
                  <th scope="row" className="py-2 pr-4 text-left">
                    All facilities
                  </th>
                  <td className="py-2 pr-4 text-right tabular-nums">{report.total.agreedCount}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(report.total.agreedCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(report.total.collectedCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(report.total.waivedCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{report.total.brokenCount}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(report.total.brokenCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {report.total.completedCount}
                  </td>
                </tr>
              )}
              {report.facilities.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-muted-foreground py-3">
                    No facilities you can see money for.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
