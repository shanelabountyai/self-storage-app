import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { agingByFacility, delinquencyDetail } from '@/lib/admin/delinquency-detail'
import { AR_BUCKETS, type ArAging } from '@storage/core/metrics'
import { formatCents } from '@/lib/format'

export const metadata = { title: 'Delinquency aging' }

// PRD 02 US-39.4 (B-055). The aging report, tenant by tenant.
//
// The one thing this screen must never do is filter by lease status. US-14's
// AC: "an ended lease carrying a balance... never simply disappears from the
// delinquency view, and it stays inside the AR aging report." A move-out is
// when a balance is least likely to be paid and most likely to be forgotten.
//
// B-195: every bucket is split into money being CHASED and money HALTED behind
// a hold. The arithmetic was always right and never said the one thing that
// decides what to do about it — $40,000 in the 90+ bucket is a different
// problem depending on whether the ladder is working it or a bankruptcy hold
// stopped it four months ago, and summed together the figure means neither.
// The `Total` column is unchanged and still ties out; the split sits beside it.

const BUCKET_LABELS: Record<string, string> = {
  d0to10: '0–10',
  d11to30: '11–30',
  d31to60: '31–60',
  d61to90: '61–90',
  over90: 'Over 90',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  active: 'Active',
  delinquent: 'Delinquent',
  pending_auction: 'Pending auction',
  ended: 'Moved out',
}

/// One facility's row of buckets, labelled by what is happening to the money.
///
/// The label is a `<th scope="row">` rather than a plain cell, so a screen
/// reader announcing a figure says which half of the split it belongs to.
function SplitCells({ label, aging }: { label: string; aging: ArAging }) {
  return (
    <>
      <th scope="row" className="py-2 pr-4 text-left font-normal">
        {label}
      </th>
      {AR_BUCKETS.map((bucket) => (
        <td key={bucket} className="py-2 pr-4 text-right tabular-nums">
          {formatCents(aging[bucket])}
        </td>
      ))}
      <td className="py-2 pr-4 text-right tabular-nums">{formatCents(aging.totalCents)}</td>
    </>
  )
}

export default async function DelinquencyPage() {
  const actor = await getAdminActor()

  if (!hasPermissionAnywhere(actor, ['reports:financial'])) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have access to financial reports.
      </p>
    )
  }

  const report = await delinquencyDetail(actor)
  const byFacility = agingByFacility(report.rows)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Delinquency aging</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Every lease carrying a balance, aged from the <strong>original</strong> due date of its
          oldest unpaid invoice — never from a retry attempt. Point-in-time, as of now: how old a
          debt is has no meaning across a date range.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/admin/reports/delinquency.csv"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Download CSV
        </Link>
        <Link
          href="/admin/reports/revenue"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Revenue report
        </Link>
      </div>

      <section aria-labelledby="exposure-heading" className="flex flex-col gap-3">
        <h2 id="exposure-heading" className="font-medium">
          Total exposure
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Owed across every lease</dt>
            <dd className="text-xl font-semibold">{formatCents(report.totalExposureCents)}</dd>
          </div>
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Of which former tenants</dt>
            {/* B-119 (test gap 3): axe's `definition-list` rule — a <div>
                inside <dl> may hold only <dt>/<dd> pairs, and this note was a
                third sibling. Nested inside the <dd> instead, which is valid
                flow content, rather than dropped or moved outside the pair it
                explains. */}
            <dd className="text-xl font-semibold">
              {formatCents(report.endedLeaseExposureCents)}
              <p className="text-muted-foreground mt-1 text-xs font-normal text-pretty">
                Leases that have already ended. Still here on purpose — this is the money that goes
                missing when a report filters to active tenants.
              </p>
            </dd>
          </div>
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Of which halted</dt>
            <dd className="text-xl font-semibold">
              {formatCents(report.haltedExposureCents)}
              <p className="text-muted-foreground mt-1 text-xs font-normal text-pretty">
                Behind a hold — a plan, a bankruptcy, a deployment, a death — so nothing is being
                sent about it.{' '}
                <Link href="/admin/reports/plans-holds" className="underline underline-offset-2">
                  Who, and why
                </Link>
                .
              </p>
            </dd>
          </div>
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Leases with a balance</dt>
            <dd className="text-xl font-semibold">{report.rows.length}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="buckets-heading" className="flex flex-col gap-3">
        <h2 id="buckets-heading" className="font-medium">
          By facility
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Each facility reads twice: what the delinquency ladder is still chasing, and what is
          halted behind a hold. They add up to the total, and they are never shown added together
          — a bucket that mixes them is a figure nobody can act on.
        </p>
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse text-sm">
            <caption className="sr-only">
              Outstanding balance by aging bucket, per facility, split into money being chased and
              money halted behind a hold
            </caption>
            <thead>
              <tr className="border-input border-b text-left">
                <th scope="col" className="py-2 pr-4">
                  Facility
                </th>
                <th scope="col" className="py-2 pr-4">
                  Collections
                </th>
                {AR_BUCKETS.map((bucket) => (
                  <th key={bucket} scope="col" className="py-2 pr-4 text-right">
                    {BUCKET_LABELS[bucket]} days
                  </th>
                ))}
                <th scope="col" className="py-2 pr-4 text-right">
                  Total
                </th>
              </tr>
            </thead>
            {/* One <tbody> per facility, with the name as a `scope="rowgroup"`
                header spanning its two rows. That is what makes the halted row
                announce as "Cedar Park, Halted, 61–90 days" rather than as a
                row of figures with no owner — a rowSpan cell with `scope="row"`
                would claim only the first of the two. */}
            {byFacility.map((row) => (
              <tbody key={row.facilityId}>
                <tr className="border-input border-b">
                  <th scope="rowgroup" rowSpan={2} className="py-2 pr-4 text-left align-top font-medium">
                    {row.facilityName}
                  </th>
                  <SplitCells label="Being chased" aging={row.split.chased} />
                </tr>
                <tr className="border-input border-b">
                  <SplitCells label="Halted" aging={row.split.halted} />
                </tr>
              </tbody>
            ))}
            {byFacility.length > 0 && (
              <tfoot>
                <tr className="border-input border-b font-semibold">
                  <th scope="rowgroup" rowSpan={3} className="py-2 pr-4 text-left align-top">
                    All facilities
                  </th>
                  <SplitCells label="Being chased" aging={report.split.chased} />
                </tr>
                <tr className="border-input border-b font-semibold">
                  <SplitCells label="Halted" aging={report.split.halted} />
                </tr>
                <tr className="border-input border-b font-semibold">
                  <SplitCells label="Total" aging={report.aging} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
        <h2 id="steps-heading" className="font-medium">
          Where they are on the ladder
        </h2>
        <ul className="flex flex-wrap gap-3">
          {report.stepCounts.map((step) => (
            <li key={step.step} className="border-input rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {step.step === 0 ? 'Not yet chased' : `Step ${step.step}`}
              </p>
              <p className="text-muted-foreground text-xs">
                {step.leases} lease{step.leases === 1 ? '' : 's'} ·{' '}
                {formatCents(step.outstandingCents)}
              </p>
            </li>
          ))}
          {report.stepCounts.length === 0 && (
            <li className="text-muted-foreground text-sm">Nothing outstanding.</li>
          )}
        </ul>
      </section>

      <section aria-labelledby="detail-heading" className="flex flex-col gap-3">
        <h2 id="detail-heading" className="font-medium">
          Tenant detail
        </h2>
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-4xl border-collapse text-sm">
            <caption className="sr-only">
              Every lease carrying a balance, oldest debt first
            </caption>
            <thead>
              <tr className="border-input border-b text-left">
                <th scope="col" className="py-2 pr-4">
                  Tenant
                </th>
                <th scope="col" className="py-2 pr-4">
                  Facility
                </th>
                <th scope="col" className="py-2 pr-4">
                  Unit
                </th>
                <th scope="col" className="py-2 pr-4">
                  Lease
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Days
                </th>
                <th scope="col" className="py-2 pr-4">
                  Bucket
                </th>
                <th scope="col" className="py-2 pr-4">
                  Step
                </th>
                <th scope="col" className="py-2 pr-4">
                  Collections
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Owed
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.leaseId} className="border-input border-b">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">
                    <Link
                      href={`/admin/tenants/${row.tenantId}`}
                      className="underline underline-offset-2"
                    >
                      {row.tenantName}
                    </Link>
                  </th>
                  <td className="py-2 pr-4">{row.facilityName}</td>
                  <td className="py-2 pr-4">{row.unitNumber}</td>
                  {/* The status is text, never a colour alone (WCAG 1.4.1) —
                      and "Moved out" is the word that has to be readable. */}
                  <td className="py-2 pr-4">{STATUS_LABELS[row.leaseStatus] ?? row.leaseStatus}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{row.daysPastDue}</td>
                  <td className="py-2 pr-4">{BUCKET_LABELS[row.bucket]}</td>
                  <td className="py-2 pr-4">
                    {row.dunningStep === 0 ? '—' : row.dunningStep}
                    {row.nextStepDay !== null && (
                      <span className="text-muted-foreground text-xs">
                        {' '}
                        (next at {row.nextStepDay}d)
                      </span>
                    )}
                  </td>
                  {/* B-195. Words, never a colour or a missing badge: the
                      step column cannot say this — a halted lease keeps the
                      rung it had reached, so it reads "step 2" for ever while
                      nothing at all is being sent (1.4.1). */}
                  <td className="py-2 pr-4">
                    {row.halted ? (
                      <>
                        Halted — {row.haltReasons.join(', ')}
                        {row.daysHalted !== null && (
                          <span className="text-muted-foreground block text-xs">
                            {row.daysHalted} day{row.daysHalted === 1 ? '' : 's'}
                          </span>
                        )}
                      </>
                    ) : (
                      'Being chased'
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(row.outstandingCents)}
                  </td>
                </tr>
              ))}
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-muted-foreground py-3">
                    Nobody owes anything. Worth checking the date on that.
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
