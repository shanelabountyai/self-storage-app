import { prisma } from '@storage/db'
import { can, facilityAccess } from '@/lib/rbac/authorize'
import type { PermissionKey } from '@storage/db/rbac-catalog'
import { overlockReconciliation } from '@/lib/delinquency/overlock-reconciliation'
import { formerTenantDebts } from '@/lib/admin/move-out'
import { coverageGaps } from '@/lib/protection/coverage'
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

// PRD 02 §4.1 US-1, US-2 (B-235, operator review finding 7, 2026-09-01).
//
// Thirty-two admin screens hard-refuse "All facilities" and five had a roll-up
// behind the refusal, which leaves US-2's own criterion — "in the All
// facilities context, every roll-up-capable screen renders a roll-up, not a
// refusal" — unmet exactly where the refusal costs most. A regional over ten
// sites who has to approve every lien sale and every ECRI batch was switching
// facility ten times a morning with no signal about which sites had anything
// waiting. Staff time is the first cost; the compliance edge is real, because
// an auction approval sitting unseen past its sale date means the
// advertisement ran for a sale that did not happen.
//
// Each row counts WHAT IS WAITING, never what merely exists, so a site with
// nothing pending reads as empty rather than as unvisited. The roll-up stays a
// router: the link carries `?facility=` into that facility's own screen, and
// no list is merged across sites — the reasons those screens refuse a merged
// list (a lien sale is governed by its state, a notice period is per facility)
// are all still true.

/// One row per facility the actor can both see and act on, with the figure
/// stated in words.
///
/// `count` is the screen's OWN call wherever there is one, so the roll-up and
/// the screen cannot disagree about what is waiting — D-25's rule, and the
/// reason `moneyOwedRollup` above reads `delinquencyReport` rather than
/// summing its own.
///
/// Filtered by `permissions` before calling, because those calls throw rather
/// than return empty for a facility the actor lacks the permission at: the
/// access scope says which sites are visible, the permission says which of
/// them this screen is answerable for.
async function waitingRollup(
  actor: Actor,
  permissions: readonly PermissionKey[],
  path: string,
  phrase: (waiting: number) => string,
  count: (facilityId: string) => Promise<number>,
): Promise<RollupRow[]> {
  const facilities = await accessibleFacilities(actor)
  const allowed = facilities.filter((facility) =>
    permissions.some((permission) => can(actor, permission, facility.id)),
  )
  if (allowed.length === 0) return []

  return Promise.all(
    allowed.map(async (facility) => ({
      facilityId: facility.id,
      facilityName: facility.name,
      href: `${path}?facility=${facility.id}`,
      summary: phrase(await count(facility.id)),
    })),
  )
}

/// Lien sales waiting on a regional's signature.
///
/// Counted rather than read through `auctionCasesFor`, which resolves each
/// case in full — a per-facility screen can afford that and a portfolio
/// roll-up cannot. The filter is the screen's: an open case (`eligible` or
/// `scheduled`) that nobody has approved.
export async function auctionApprovalRollup(actor: Actor): Promise<RollupRow[]> {
  return waitingRollup(
    actor,
    ['auctions:approve'],
    '/admin/auctions',
    (n) => (n === 0 ? 'Nothing waiting for approval' : `${n} waiting for approval`),
    (facilityId) =>
      prisma.auctionCase.count({
        where: { facilityId, status: { in: ['eligible', 'scheduled'] }, approvedAt: null },
      }),
  )
}

/// Rate increases waiting on the same signature — US-11's "regional/owner
/// approval is required before notices go out", which is a whole ECRI batch at
/// a time.
export async function rateIncreaseApprovalRollup(actor: Actor): Promise<RollupRow[]> {
  return waitingRollup(
    actor,
    ['rates:tenant_increase', 'credits:manual'],
    '/admin/rate-increases',
    (n) => (n === 0 ? 'Nothing waiting for approval' : `${n} waiting for approval`),
    (facilityId) =>
      prisma.tenantRateIncrease.count({ where: { facilityId, status: 'pending_approval' } }),
  )
}

/// Overlocks the controller and our records disagree about, plus locks left on
/// units with no lease behind them — the two states the screen itself calls
/// out, counted together because both mean somebody walks to a unit.
export async function overlockRollup(actor: Actor): Promise<RollupRow[]> {
  return waitingRollup(
    actor,
    ['tenants:view'],
    '/admin/overlocks',
    (n) => (n === 0 ? 'Nothing to reconcile' : `${n} to reconcile`),
    async (facilityId) => {
      const rows = await overlockReconciliation(actor, facilityId)
      return rows.filter((row) => row.mismatch || row.state === 'stuck_no_lease').length
    },
  )
}

/// Whether today's walk has been confirmed. A count of one is not a useful
/// figure here — the task is one per facility per day — so the row says which
/// of the two states the site is in, in words.
export async function walkthroughRollup(actor: Actor): Promise<RollupRow[]> {
  return waitingRollup(
    actor,
    ['tenants:view'],
    '/admin/walkthrough',
    (n) => (n === 0 ? 'Walk confirmed, or not yet raised' : 'Walk not confirmed today'),
    (facilityId) =>
      prisma.task.count({ where: { facilityId, type: 'daily_walkthrough', status: 'open' } }),
  )
}

/// Balances left behind at move-out. `formerTenantDebts` is the screen's own
/// call, so the count is that list's length by construction.
export async function formerTenantRollup(actor: Actor): Promise<RollupRow[]> {
  return waitingRollup(
    actor,
    ['reports:financial', 'tenants:view'],
    '/admin/tenants/former',
    (n) => (n === 0 ? 'Nobody owing' : `${n} still owing`),
    async (facilityId) => (await formerTenantDebts(actor, facilityId)).length,
  )
}

/// Occupied units carrying neither our protection nor the tenant's own cover.
///
/// The figure means different things at two sites and deliberately does not
/// say so here: at a facility that requires protection every row is a lease out
/// of line with its own policy, and at one where it is optional they are simply
/// the uninsured units. The screen says which; a roll-up row has no space to,
/// and stating it wrong would be worse than counting.
export async function protectionGapRollup(actor: Actor): Promise<RollupRow[]> {
  return waitingRollup(
    actor,
    ['reports:operational'],
    '/admin/reports/protection',
    (n) => (n === 0 ? 'No uncovered units' : `${n} uncovered unit${n === 1 ? '' : 's'}`),
    async (facilityId) => (await coverageGaps(actor, facilityId)).rows.length,
  )
}
