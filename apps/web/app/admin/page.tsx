import Link from 'next/link'
import { prisma } from '@storage/db'
import { localDayBounds } from '@storage/core/jobs'
import { assertFacilityAccess } from '@/lib/rbac/authorize'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { formatCents } from '@/lib/format'

/// PRD 02 US-2: every metric links to its facility-scoped detail. A tile with
/// no destination makes the reader's next question — "which ones?" — a dead
/// end. `href` is optional only because some tiles have no list to link to
/// until the feature that owns it ships; those render as plain tiles rather
/// than as links that go nowhere.
function Tile({
  label,
  value,
  hint,
  href,
}: {
  label: string
  value: string
  hint?: string
  href?: string
}) {
  const body = (
    <>
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </>
  )

  if (!href) return <div className="rounded-lg border p-4">{body}</div>

  return (
    <Link href={href} className="hover:bg-accent block rounded-lg border p-4">
      {body}
    </Link>
  )
}

// Facility dashboard (default landing), PRD 02 FR-3. The portfolio roll-up
// (US-2, "All facilities" view with per-facility cards) is out of B-007's
// scope — it belongs with the reporting item, B-042.
export default async function AdminDashboardPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode === 'none') {
    return (
      <p className="text-muted-foreground text-sm">
        No facility is assigned to your account yet. Ask an owner to grant access.
      </p>
    )
  }

  if (selected.mode === 'all') {
    return (
      <p className="text-muted-foreground text-sm">
        This dashboard shows one facility at a time — pick one above to see today&apos;s activity.
        For figures across the whole portfolio, use{' '}
        <Link href="/admin/reports" className="underline underline-offset-4">
          Reports
        </Link>
        , which covers every facility you hold.
      </p>
    )
  }

  // Defense in depth: re-check against the actor's real access rather than
  // trusting the switcher's rendered option list.
  assertFacilityAccess(actor, selected.facility.id)
  const facilityId = selected.facility.id

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
  })
  const { start, end } = localDayBounds(new Date(), facility.timezone)

  const [
    totalUnits,
    occupiedUnits,
    availableUnits,
    reservedUnits,
    movedInToday,
    movedOutToday,
    paymentsToday,
    failedPayments,
    delinquentLeases,
  ] = await Promise.all([
    prisma.unit.count({ where: { facilityId } }),
    prisma.unit.count({ where: { facilityId, status: 'occupied' } }),
    // The counter's actual question — "what can I rent right now?" — is not
    // derivable from occupancy: reserved, maintenance and unrentable all sit
    // in the gap between occupied and total.
    prisma.unit.count({ where: { facilityId, status: 'available' } }),
    prisma.unit.count({ where: { facilityId, status: 'reserved' } }),
    prisma.lease.count({
      where: { facilityId, startDate: { gte: start, lt: end } },
    }),
    prisma.lease.count({
      where: { facilityId, status: 'ended', endDate: { gte: start, lt: end } },
    }),
    prisma.payment.aggregate({
      where: {
        facilityId,
        status: 'succeeded',
        receivedAt: { gte: start, lt: end },
      },
      _sum: { amountCents: true },
      _count: true,
    }),
    // Scoped to today's business day, not all time. As a lifetime cumulative
    // count this only ever went up and could never be cleared, so a tile
    // labelled "needs attention" trained the reader to ignore the row. There
    // is no resolution concept to filter on until B-046 builds the failed-
    // payment queue; a time window is the honest interim.
    prisma.payment.count({
      where: {
        facilityId,
        status: 'failed',
        receivedAt: { gte: start, lt: end },
      },
    }),
    prisma.lease.count({ where: { facilityId, status: 'delinquent' } }),
  ])

  const occupancyPct = totalUnits === 0 ? 0 : Math.round((occupiedUnits / totalUnits) * 100)

  return (
    <div>
      <h1 className="text-lg font-semibold">{facility.name}</h1>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {/* "Available now" leads: it is the number the person at the counter
            needs most, and the public site is already computing it. */}
        <Tile
          label="Available now"
          value={String(availableUnits)}
          hint={`${reservedUnits} reserved`}
          href="/admin/units?status=available"
        />
        <Tile
          label="Occupancy"
          value={`${occupancyPct}%`}
          hint={`${occupiedUnits}/${totalUnits} units`}
          href="/admin/units?status=occupied"
        />
        <Tile label="Move-ins today" value={String(movedInToday)} />
        <Tile label="Move-outs today" value={String(movedOutToday)} />
        <Tile
          label="Payments today"
          value={formatCents(paymentsToday._sum.amountCents ?? 0)}
          hint={`${paymentsToday._count} payment${paymentsToday._count === 1 ? '' : 's'}`}
        />
        {/* The time window is in the label, not just the query: a count whose
            period the reader has to guess is a count they cannot act on. */}
        <Tile label="Failed payments today" value={String(failedPayments)} hint="needs attention" />
        <Tile label="Delinquent leases" value={String(delinquentLeases)} />
      </div>
    </div>
  )
}
