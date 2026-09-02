import { prisma } from '@storage/db'
import { buildPack, periodDrift, type PeriodSnapshot } from '@storage/core/accounting'
import { monthBounds } from '@storage/core/billing'
import { surplusObligation } from '@storage/core/auctions'
import { renderReportEmail, type EmailDocument, type RenderedEmail } from '@storage/core/comms'
import { requirePermission, assertFacilityAccess } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { figuresFor, periodLabel } from '@/lib/admin/accounting-close'
import { formatCents } from '@/lib/format'
import { siteOrigin } from '@/lib/marketing/origin'

// PRD 02 US-40 (B-084 part 4). The monthly management pack.
//
// One document, two surfaces: the screen renders it and part 3's subscription
// emails it. That is why it is built as an `EmailDocument` — a pack an owner
// opens and a pack an owner is sent must not be able to say different things
// about the same month.
//
// **Reads the FILED figures when the month is closed**, which is the whole
// point of the four-part ordering: a pack cut live changes between the day it
// is read and the day it is quoted.

export type ManagementPack = {
  document: EmailDocument
  rendered: RenderedEmail
  filed: boolean
  driftCount: number
}

/// Reporting access is the gate, not `accounting:close`: reading a summary is
/// not the same authority as filing one, and a bookkeeper who may see revenue
/// should be able to read the pack without being able to close the books.
export async function managementPack(
  actor: Actor,
  facilityId: string,
  year: number,
  month: number,
): Promise<ManagementPack> {
  requirePermission(actor, 'reports:financial', facilityId)
  assertFacilityAccess(actor, facilityId)
  return buildManagementPack(facilityId, year, month)
}

/// The pack itself, facility-explicit and with no actor — D-67's rule. The
/// scheduled-report job has already been authorized at subscribe time and has
/// no actor to offer; the screen above checks and then calls this.
export async function buildManagementPack(
  facilityId: string,
  year: number,
  month: number,
): Promise<ManagementPack> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { name: true, timezone: true },
  })
  const stored = await prisma.accountingPeriod.findUnique({
    where: { facilityId_year_month: { facilityId, year, month } },
    select: { closedAt: true, snapshot: true, startsAt: true, endsAt: true },
  })

  const filed = Boolean(stored?.closedAt && stored.snapshot)
  // The window as FILED where there is one, so a later timezone correction
  // cannot move a month that has already been reported on. Same reasoning as
  // the drift check in part 1.
  const bounds = filed
    ? { start: stored!.startsAt, end: stored!.endsAt }
    : monthBounds(year, month, facility.timezone)

  const figures = filed
    ? (stored!.snapshot as unknown as PeriodSnapshot)
    : await figuresFor(facilityId, facility.name, bounds.start, bounds.end)

  // Only meaningful for a filed month; `driftFor` returns null otherwise, which
  // is why the empty array below is reached only when there genuinely is no
  // drift rather than when there was nothing to compare.
  const drift = filed ? periodDrift(
        (stored!.snapshot as unknown as PeriodSnapshot).periodDerived,
        (await figuresFor(facilityId, facility.name, bounds.start, bounds.end)).periodDerived,
      )
    : []

  // B-234. Point-in-time, deliberately not month-scoped: a surplus held today
  // is a liability today, and the pack says so in the section itself. Read
  // here rather than through `outstandingSurpluses` because that call takes an
  // actor and this path has none by design (D-67) — the subscription job was
  // authorized at subscribe time. The FILTER is the same one, and it has to
  // stay so: sold, still `held`.
  const held = await prisma.auctionCase.findMany({
    where: { facilityId, status: 'sold', surplusDisposition: 'held', surplusCents: { gt: 0 } },
    orderBy: { surplusHoldUntil: 'asc' },
    select: {
      surplusCents: true,
      surplusHoldUntil: true,
      surplusTenantNotifiedAt: true,
      unit: { select: { number: true } },
      lease: { select: { tenant: { select: { firstName: true, lastName: true } } } },
    },
  })
  const now = new Date()

  const document = buildPack(
    {
      facilityName: facility.name,
      periodLabel: periodLabel(year, month),
      pointInTime: figures.pointInTime,
      periodDerived: figures.periodDerived,
      filed,
      driftLabels: drift.map((row) => row.label),
      heldSurpluses: held.map((row) => ({
        unitNumber: row.unit.number,
        tenantName: `${row.lease.tenant.firstName} ${row.lease.tenant.lastName}`,
        amountCents: row.surplusCents ?? 0,
        holdUntil: row.surplusHoldUntil,
        overdue: surplusObligation(
          {
            surplusCents: row.surplusCents ?? 0,
            disposition: 'held',
            holdUntil: row.surplusHoldUntil,
            notifiedAt: row.surplusTenantNotifiedAt,
          },
          now,
        ).overdue,
        notified: row.surplusTenantNotifiedAt !== null,
      })),
      links: [
        { label: 'Open the monthly close', url: `${siteOrigin()}/admin/reports/close` },
        { label: 'Open the revenue report', url: `${siteOrigin()}/admin/reports/revenue` },
      ],
    },
    formatCents,
  )

  return { document, rendered: renderReportEmail(document), filed, driftCount: drift.length }
}
