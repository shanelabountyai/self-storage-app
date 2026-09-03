import Link from 'next/link'
import { prisma } from '@storage/db'
import { localDayBounds } from '@storage/core/jobs'
import { assertFacilityAccess } from '@/lib/rbac/authorize'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { formatCents } from '@/lib/format'
import { delinquencyReport } from '@/lib/admin/reports'
import { dashboardRollup } from '@/lib/admin/rollups'
import { FacilityRollup } from '@/components/admin/facility-rollup'
import { FacilityReadinessBanner } from '@/components/admin/facility-readiness-banner'
import { can } from '@/lib/rbac/authorize'

/// PRD 02 US-2: every metric links to its facility-scoped detail. A tile with
/// no destination makes the reader's next question — "which ones?" — a dead
/// end.
///
/// B-113 made `href` REQUIRED. Five of the seven tiles had none, including both
/// of the two that mean somebody has to act: "Failed payments today: 3 · needs
/// attention" with nowhere to go teaches the reader to skip the row, which is
/// the exact failure that tile's own rewrite was meant to prevent. A tile
/// without a destination is now a type error rather than a judgement call.
function Tile({
  label,
  value,
  hint,
  href,
}: {
  label: string
  value: string
  hint?: string
  href: string
}) {
  return (
    <Link href={href} className="hover:bg-accent block rounded-lg border p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </Link>
  )
}

// Facility dashboard (default landing), PRD 02 FR-3. The portfolio roll-up
// (US-2, "All facilities" view with per-facility cards) is out of B-007's
// scope — it belongs with the reporting item, B-042.
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string }>
}) {
  const { facility: facilityParam } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  // Same convention as `/admin/tasks`: the roll-up links into one facility
  // without changing the switcher's persistent choice, so an owner looking at
  // one site does not have to remember to switch back.
  const requested = facilityParam ? facilities.find((f) => f.id === facilityParam) : undefined
  const selected = requested
    ? { mode: 'single' as const, facility: requested }
    : resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode === 'none') {
    return (
      <p className="text-muted-foreground text-sm">
        No facility is assigned to your account yet. Ask an owner to grant access.
      </p>
    )
  }

  if (selected.mode === 'all') {
    // D-12: owner + all-facilities is the ordinary unrestricted account, so
    // this is the owner's own default context — not an exotic state to be sent
    // away from. It answers the two questions the portfolio is opened on and
    // links each row into that facility's own dashboard.
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">All facilities</h1>
        <FacilityRollup heading="Across your facilities" rows={await dashboardRollup(actor)} />
        <p className="text-muted-foreground text-sm">
          For revenue, occupancy and move figures across the portfolio, see{' '}
          <Link href="/admin/reports" className="underline underline-offset-4">
            Reports
          </Link>
          .
          {/* B-237. The only screen an owner with no facility at all can reach,
              since `/admin/settings` asks for one to be picked first. */}
          {can(actor, 'org:defaults', null) && (
            <>
              {' '}
              To take on a new site,{' '}
              <Link
                href="/admin/settings/facilities/new"
                className="underline underline-offset-4"
              >
                add a facility
              </Link>
              .
            </>
          )}
        </p>
      </div>
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
    delinquency,
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
    // Money, not a count of a status nothing sets.
    //
    // This was `Lease.status = 'delinquent'`, and nothing writes that status
    // until B-057 — so the tile read 0 beside real receivables, on the one
    // screen an owner checks to find out whether anybody is paying. It now
    // comes from the same `delinquencyReport` the Delinquency report renders,
    // which is D-25's rule: `packages/core/metrics` owns every figure and no
    // tile computes one inline. A test asserts the two agree.
    delinquencyReport(actor),
  ])

  const occupancyPct = totalUnits === 0 ? 0 : Math.round((occupiedUnits / totalUnits) * 100)
  // Absent for a role without `reports:financial` — `delinquencyReport` scopes
  // to the financial facilities, so the tile is omitted rather than rendered as
  // a zero the reader would believe.
  const owedRow = delinquency.rows.find((row) => row.facilityId === facilityId)
  const owed = owedRow?.aging
  const seriouslyLate = owed ? owed.d31to60 + owed.d61to90 + owed.over90 : 0
  // B-207. The tile's hint said how much was over 30 days and never whether
  // anyone was chasing it, which is the difference between a facility that is
  // working its list and one where a bankruptcy hold stopped the ladder four
  // months ago. Halted money is the half a manager cannot fix by making calls.
  const halted = owedRow?.split.halted.totalCents ?? 0

  return (
    <div>
      <h1 className="text-lg font-semibold">{facility.name}</h1>
      {/* B-237. A site that bills rent and collects nothing else looks healthy
          on exactly this screen for a month — the tiles all read normally. */}
      <div className="mt-4">
        <FacilityReadinessBanner facilityId={facilityId} />
      </div>
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
        {/* Both move tiles land on the report's own move-in/move-out section
            rather than on a list that does not exist yet — B-114 builds the
            tenant list these will point at. */}
        <Tile
          label="Move-ins today"
          value={String(movedInToday)}
          href="/admin/reports#moves-heading"
        />
        <Tile
          label="Move-outs today"
          value={String(movedOutToday)}
          href="/admin/reports#moves-heading"
        />
        <Tile
          label="Payments today"
          value={formatCents(paymentsToday._sum.amountCents ?? 0)}
          hint={`${paymentsToday._count} payment${paymentsToday._count === 1 ? '' : 's'}`}
          // The deposit slip: the day's payments, itemised, with who took them.
          href="/admin/pos/summary"
        />
        {/* The time window is in the label, not just the query: a count whose
            period the reader has to guess is a count they cannot act on. */}
        <Tile
          label="Failed payments today"
          value={String(failedPayments)}
          hint="needs attention"
          href="/admin/billing"
        />
        {owed && (
          <Tile
            label="Money owed"
            value={formatCents(owed.totalCents)}
            // The window, on the tile rather than in the query. "Delinquent
            // leases: 0" said nothing and was wrong; this says how much and how
            // bad.
            hint={[
              seriouslyLate > 0
                ? `${formatCents(seriouslyLate)} over 30 days`
                : 'nothing over 30 days',
              halted > 0 ? `${formatCents(halted)} halted` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            href="/admin/delinquency"
          />
        )}
      </div>
    </div>
  )
}
