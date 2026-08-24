import Link from 'next/link'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { coverageGaps } from '@/lib/protection/coverage'

export const metadata = { title: 'Uncovered units' }

// PRD 02 §4.3 US-44 (B-163). The number the protection policy is actually about.
//
// US-44 says every move-in "either carries a plan or carries evidence of the
// tenant's own cover", and until this nothing counted the leases that carry
// neither. B-155's attach rate is a period metric about how last month's
// move-ins were sold; a tenant who waived at signing two years ago and let the
// certificate lapse has never appeared in it, and is exactly who the policy is
// for. This is a list rather than a percentage for the same reason the
// delinquency queue is: somebody has to ring these people.

export const dynamic = 'force-dynamic'

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export default async function ProtectionCoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string }>
}) {
  const { facility: facilityParam } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()

  if (!hasPermissionAnywhere(actor, ['reports:operational'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to reports.</p>
  }

  const requested = facilityParam ? facilities.find((one) => one.id === facilityParam) : undefined
  const selected = requested
    ? { mode: 'single' as const, facility: requested }
    : resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">Uncovered units</h1>
        <p className="text-muted-foreground text-sm">
          Choose a single facility in the switcher above — the protection policy is a per-facility
          setting, so a combined list would mix sites that require cover with sites that do not.
        </p>
      </div>
    )
  }

  const gap = await coverageGaps(actor, selected.facility.id)

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Uncovered units — {gap.facilityName}</h1>
        <Link href="/admin/reports" className="text-sm underline underline-offset-2">
          All reports
        </Link>
      </div>

      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        Occupied units carrying <strong>neither</strong> one of our protection plans nor an
        unexpired certificate of the tenant&apos;s own cover.{' '}
        {gap.protectionRequired
          ? 'This facility requires protection, so every row here is a lease out of line with its own policy.'
          : 'Protection is optional at this facility, so these rows are not policy breaches — they are the units that are uninsured if something happens to them.'}{' '}
        A waiver a manager accepted without an expiry date is treated as cover: it is a decision on
        the record, not an absence.
      </p>

      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Uncovered</dt>
          <dd className="text-lg font-medium tabular-nums">{gap.rows.length}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Occupied units</dt>
          <dd className="text-lg font-medium tabular-nums">{gap.occupiedLeases}</dd>
        </div>
      </dl>

      {gap.rows.length === 0 ? (
        <p className="text-sm">
          Every occupied unit here carries a plan or a current certificate. Nothing to chase.
        </p>
      ) : (
        <div tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-2xl border-collapse text-sm">
            <caption className="sr-only">
              Occupied units with no protection plan and no unexpired proof of insurance, longest
              uncovered first
            </caption>
            <thead>
              <tr className="border-input border-b text-left">
                <th scope="col" className="py-2 pr-4">
                  Unit
                </th>
                <th scope="col" className="py-2 pr-4">
                  Tenant
                </th>
                <th scope="col" className="py-2 pr-4">
                  Why
                </th>
                <th scope="col" className="py-2 pr-4">
                  Since
                </th>
                <th scope="col" className="py-2 pr-4">
                  Days
                </th>
              </tr>
            </thead>
            <tbody>
              {gap.rows.map((row) => (
                <tr key={row.leaseId} className="border-input border-b">
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    {row.unitNumber}
                  </th>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/tenants/${row.tenantId}`}
                      className="underline underline-offset-2"
                    >
                      {row.tenantName}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {/* The two reasons are different conversations: one tenant
                        had cover and let it run out, the other never showed us
                        any. Never colour alone (WCAG 1.4.1) — the words say it. */}
                    {row.reason === 'lapsed'
                      ? 'Certificate expired'
                      : 'No certificate was ever recorded'}
                  </td>
                  <td className="text-muted-foreground py-2 pr-4">
                    {formatDay(row.proofExpiredOn ?? row.startDate)}
                    {row.reason === 'never_recorded' && (
                      <span className="block text-xs">lease started</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {row.daysUncovered === null ? '—' : row.daysUncovered}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
