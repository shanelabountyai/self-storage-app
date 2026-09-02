import { prisma } from '@storage/db'
import { facilityAccess } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { delinquencyReport } from '@/lib/admin/reports'
import { taskRollup } from '@/lib/admin/tasks'
import { formatCents } from '@/lib/format'
import type { RollupRow } from '@/components/admin/facility-rollup'

// PRD 02 §4.1 US-2 / §5.5 FR-23 (B-113). The per-facility figures behind the
// "All facilities" roll-ups.
//
// Every one of these is scoped by the actor's real access rather than by the
// switcher's rendered options — the switcher is UX, this is the gate (RBAC-1),
// and D-12 is explicit that owner + all-facilities assignment is the only
// unrestricted access there is.

async function accessibleFacilities(actor: Actor): Promise<{ id: string; name: string }[]> {
  const access = facilityAccess(actor)
  return prisma.facility.findMany({
    where: access.all ? {} : { id: { in: access.facilityIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

/// Units available and total, per facility.
export async function unitRollup(actor: Actor): Promise<RollupRow[]> {
  const facilities = await accessibleFacilities(actor)
  if (facilities.length === 0) return []
  const ids = facilities.map((facility) => facility.id)

  const [totals, available] = await Promise.all([
    prisma.unit.groupBy({ by: ['facilityId'], where: { facilityId: { in: ids } }, _count: true }),
    prisma.unit.groupBy({
      by: ['facilityId'],
      where: { facilityId: { in: ids }, status: 'available' },
      _count: true,
    }),
  ])
  const totalBy = new Map(totals.map((row) => [row.facilityId, row._count]))
  const availableBy = new Map(available.map((row) => [row.facilityId, row._count]))

  return facilities.map((facility) => ({
    facilityId: facility.id,
    facilityName: facility.name,
    href: `/admin/units?facility=${facility.id}`,
    summary: `${availableBy.get(facility.id) ?? 0} available of ${totalBy.get(facility.id) ?? 0}`,
  }))
}

/// Open inquiries, per facility.
export async function inquiryRollup(actor: Actor): Promise<RollupRow[]> {
  const facilities = await accessibleFacilities(actor)
  if (facilities.length === 0) return []

  const open = await prisma.lead.groupBy({
    by: ['facilityId'],
    where: { facilityId: { in: facilities.map((facility) => facility.id) }, status: 'new' },
    _count: true,
  })
  const openBy = new Map(open.map((row) => [row.facilityId, row._count]))

  return facilities.map((facility) => ({
    facilityId: facility.id,
    facilityName: facility.name,
    href: `/admin/leads?facility=${facility.id}`,
    summary: `${openBy.get(facility.id) ?? 0} new`,
  }))
}

/// Money owed, per facility.
///
/// Straight off `delinquencyReport` — the same call the Delinquency report
/// itself makes, so the roll-up, the tile and the report cannot disagree. That
/// is the whole reason this does not compute its own sum (D-25).
export async function moneyOwedRollup(actor: Actor): Promise<RollupRow[]> {
  const report = await delinquencyReport(actor)
  return report.rows.map((row) => ({
    facilityId: row.facilityId,
    facilityName: row.facilityName,
    href: `/admin/delinquency?facility=${row.facilityId}`,
    summary: formatCents(row.aging.totalCents),
  }))
}

/// The dashboard's own roll-up: what is rentable, and what is owed.
///
/// Two figures rather than one because they are the two questions an owner
/// opens the portfolio on — "can I rent anything" and "is anyone not paying" —
/// and a roll-up that answers neither is the "pick a facility" message with
/// extra steps.
export async function dashboardRollup(actor: Actor): Promise<RollupRow[]> {
  const [units, owed, tasks] = await Promise.all([
    unitRollup(actor),
    moneyOwedRollup(actor),
    taskRollup(actor),
  ])
  const owedBy = new Map(owed.map((row) => [row.facilityId, row.summary]))
  // B-229. A third figure, and only when it is not zero: a site whose nightly
  // biller failed reads as a perfectly healthy site on the two above — the
  // units are still rentable and yesterday's balances are still what they were.
  const failuresBy = new Map(tasks.map((row) => [row.facilityId, row.jobFailureCount]))
  // B-234. A fourth, on the same "only when it is not zero" rule. An overdue
  // surplus is money the business is holding past its own deadline, and it is
  // invisible on the three above — the units are rentable and nobody owes us
  // anything, because we owe THEM.
  const surplusesBy = new Map(tasks.map((row) => [row.facilityId, row.overdueSurplusCount]))

  return units.map((row) => ({
    ...row,
    href: `/admin?facility=${row.facilityId}`,
    // `moneyOwedRollup` is gated on `reports:financial`, so a manager without
    // it simply sees the units half rather than a blank or an error.
    summary: [
      row.summary,
      owedBy.has(row.facilityId) ? `${owedBy.get(row.facilityId)} owed` : '',
      (failuresBy.get(row.facilityId) ?? 0) > 0
        ? `${failuresBy.get(row.facilityId)} nightly job failure${failuresBy.get(row.facilityId) === 1 ? '' : 's'}`
        : '',
      (surplusesBy.get(row.facilityId) ?? 0) > 0
        ? `${surplusesBy.get(row.facilityId)} overdue sale surplus${surplusesBy.get(row.facilityId) === 1 ? '' : 'es'}`
        : '',
    ]
      .filter(Boolean)
      .join(' · '),
  }))
}
