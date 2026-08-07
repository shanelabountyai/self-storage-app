import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { agingByFacility, delinquencyDetail } from '@/lib/admin/delinquency-detail'
import { AR_BUCKETS } from '@storage/core/metrics'
import { formatCents } from '@/lib/format'

export const metadata = { title: 'Delinquency aging' }

// PRD 02 US-39.4 (B-055). The aging report, tenant by tenant.
//
// The one thing this screen must never do is filter by lease status. US-14's
// AC: "an ended lease carrying a balance... never simply disappears from the
// delinquency view, and it stays inside the AR aging report." A move-out is
// when a balance is least likely to be paid and most likely to be forgotten.

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
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Owed across every lease</dt>
            <dd className="text-xl font-semibold">{formatCents(report.totalExposureCents)}</dd>
          </div>
          <div className="border-input rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">Of which former tenants</dt>
            <dd className="text-xl font-semibold">{formatCents(report.endedLeaseExposureCents)}</dd>
            <p className="text-muted-foreground mt-1 text-xs text-pretty">
              Leases that have already ended. Still here on purpose — this is the money that goes
              missing when a report filters to active tenants.
            </p>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse text-sm">
            <caption className="sr-only">Outstanding balance by aging bucket, per facility</caption>
            <thead>
              <tr className="border-input border-b text-left">
                <th scope="col" className="py-2 pr-4">
                  Facility
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
            <tbody>
              {byFacility.map((row) => (
                <tr key={row.facilityId} className="border-input border-b">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">
                    {row.facilityName}
                  </th>
                  {AR_BUCKETS.map((bucket) => (
                    <td key={bucket} className="py-2 pr-4 text-right tabular-nums">
                      {formatCents(row.aging[bucket])}
                    </td>
                  ))}
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(row.aging.totalCents)}
                  </td>
                </tr>
              ))}
              {byFacility.length > 0 && (
                <tr className="border-input border-b font-semibold">
                  <th scope="row" className="py-2 pr-4 text-left">
                    All facilities
                  </th>
                  {AR_BUCKETS.map((bucket) => (
                    <td key={bucket} className="py-2 pr-4 text-right tabular-nums">
                      {formatCents(report.aging[bucket])}
                    </td>
                  ))}
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(report.aging.totalCents)}
                  </td>
                </tr>
              )}
            </tbody>
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
        <div className="overflow-x-auto">
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
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(row.outstandingCents)}
                  </td>
                </tr>
              ))}
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-muted-foreground py-3">
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
