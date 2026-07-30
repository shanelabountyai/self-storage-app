import { prisma } from '@storage/db'
import { localDayBounds } from '@storage/core/jobs'
import { assertFacilityAccess } from '@/lib/rbac/authorize'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { formatCents } from '@/lib/format'

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </div>
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
        Portfolio roll-up across every facility arrives with reporting (B-042).
        Pick a single facility above to see today&apos;s activity.
      </p>
    )
  }

  // Defense in depth: re-check against the actor's real access rather than
  // trusting the switcher's rendered option list.
  assertFacilityAccess(actor, selected.facility.id)
  const facilityId = selected.facility.id

  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: facilityId } })
  const { start, end } = localDayBounds(new Date(), facility.timezone)

  const [totalUnits, occupiedUnits, movedInToday, movedOutToday, paymentsToday, failedPayments, delinquentLeases] =
    await Promise.all([
      prisma.unit.count({ where: { facilityId } }),
      prisma.unit.count({ where: { facilityId, status: 'occupied' } }),
      prisma.lease.count({ where: { facilityId, startDate: { gte: start, lt: end } } }),
      prisma.lease.count({ where: { facilityId, status: 'ended', endDate: { gte: start, lt: end } } }),
      prisma.payment.aggregate({
        where: { facilityId, status: 'succeeded', receivedAt: { gte: start, lt: end } },
        _sum: { amountCents: true },
        _count: true,
      }),
      prisma.payment.count({ where: { facilityId, status: 'failed' } }),
      prisma.lease.count({ where: { facilityId, status: 'delinquent' } }),
    ])

  const occupancyPct = totalUnits === 0 ? 0 : Math.round((occupiedUnits / totalUnits) * 100)

  return (
    <div>
      <h1 className="text-lg font-semibold">{facility.name}</h1>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Occupancy" value={`${occupancyPct}%`} hint={`${occupiedUnits}/${totalUnits} units`} />
        <Tile label="Move-ins today" value={String(movedInToday)} />
        <Tile label="Move-outs today" value={String(movedOutToday)} />
        <Tile
          label="Payments today"
          value={formatCents(paymentsToday._sum.amountCents ?? 0)}
          hint={`${paymentsToday._count} payment${paymentsToday._count === 1 ? '' : 's'}`}
        />
        <Tile label="Failed payments" value={String(failedPayments)} hint="needs attention" />
        <Tile label="Delinquent leases" value={String(delinquentLeases)} />
        {/* Walkthrough status has no data source yet — field ops (B-060). */}
        <Tile label="Walkthrough status" value="—" hint="not available yet" />
      </div>
    </div>
  )
}
