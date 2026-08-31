import { prisma } from '@storage/db'
import {
  arAgingSplit,
  attachRate,
  daysPastDue,
  economicOccupancy,
  moveCounts,
  normalizeChannel,
  normalizeSource,
  occupancy,
  rateVariance,
  reservationConversion,
  sumArAging,
  sumArAgingSplit,
  sumAttachRate,
  sumEconomicOccupancy,
  sumMoveCounts,
  sumOccupancy,
  UNASSIGNED_STAFF,
  wholeMonthsBetween,
  type ArAging,
  type ArAgingSplit,
  type AttachRateResult,
  type ConversionResult,
  type EconomicOccupancyResult,
  type MoveCounts,
  type OccupancyResult,
  type RateVarianceRow,
} from '@storage/core/metrics'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { effectsByLease } from '@/lib/admin/holds'
import { facilityAccess, ForbiddenError, can } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 US-39 / US-2. The adapter between real rows and @storage/core/metrics.
//
// This file fetches and shapes; it never computes a metric. Every ratio,
// bucket and count comes back from the core module, which is what makes
// §4.11's "one metrics definition layer" true rather than aspirational.

/// Facilities this actor may report on. Everything below scopes through here,
/// so a roll-up can never include a facility the viewer cannot open.
export async function reportableFacilities(
  actor: Actor,
): Promise<{ id: string; name: string; timezone: string }[]> {
  const access = facilityAccess(actor)
  return prisma.facility.findMany({
    where: access.all ? {} : { id: { in: access.facilityIds } },
    orderBy: { name: 'asc' },
    // B-150. `timezone` so a point-in-time figure can name the instant it
    // describes in the operator's own clock rather than in UTC.
    select: { id: true, name: true, timezone: true },
  })
}

/// Facilities this actor may see MONEY for.
///
/// A narrower list than `reportableFacilities`, and the distinction is the
/// catalog's own: `reports:financial` is described as "Revenue, AR, and
/// delinquency aging", while `reports:operational` is "Occupancy, move-ins,
/// and daily activity". A role holding only the operational key — the counter
/// agent — has no business reading the portfolio's receivables.
///
/// Filters rather than throwing, because a regional manager can legitimately
/// hold financial access at one site and operational at another; throwing
/// would deny them the report entirely instead of showing the half they are
/// entitled to.
export async function financialFacilities(
  actor: Actor,
): Promise<{ id: string; name: string; timezone: string }[]> {
  const facilities = await reportableFacilities(actor)
  return facilities.filter((facility) => can(actor, 'reports:financial', facility.id))
}

export function assertCanReport(actor: Actor, facilityId: string): void {
  if (!can(actor, 'reports:operational', facilityId) && !can(actor, 'reports:financial', facilityId)) {
    throw new ForbiddenError('Missing permission to run reports', 'reports:operational', facilityId)
  }
}

export type FacilityOccupancy = {
  facilityId: string
  facilityName: string
  occupancy: OccupancyResult
  economic: EconomicOccupancyResult
  /// B-131. Unit and square-foot occupancy describe ONE INSTANT, not a range,
  /// so the report has to say which instant — a screen with a date picker on it
  /// implies an answer for the range it shows, and for most of this product's
  /// life it quietly returned today's unit statuses under a past month's
  /// heading. Economic occupancy is unaffected: it comes from dated ledger
  /// rows and genuinely covers the period.
  unitOccupancy: UnitOccupancyProvenance
}

export type UnitOccupancyProvenance = {
  /// The instant the unit and square-foot figures describe.
  asAt: Date
  /// True when `asAt` is the end of the period asked for — i.e. the date range
  /// actually applied. False means the figures are current statuses shown
  /// because the period predates `historyBegins` (or has not ended yet), and
  /// every surface that renders them must say so.
  followsPeriod: boolean
  /// Why. Carried rather than re-derived at each surface, because "the month is
  /// older than the history" and "the month has not finished" are different
  /// sentences to a reader and both were reachable by the same false flag.
  reason: 'as-at-period-end' | 'period-not-ended' | 'before-history' | 'no-units'
  /// When this facility's status history starts. Null for a facility with no
  /// units. Nothing before it is answerable and nothing pretends otherwise.
  historyBegins: Date | null
}

function formatDay(at: Date): string {
  return at.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/// B-150. The one sentence a surface prints under an AR aging table.
///
/// The sibling of `unitOccupancyNote`, and it exists for the identical reason:
/// the reports screen puts a MONTH PICKER above both, which implies every
/// figure beneath it answers for the month chosen. Unit occupancy got this
/// sentence in B-131; the aging table one section below did not, so a month-end
/// AR figure and the aging table under it disagreed with nothing on screen
/// explaining why.
///
/// This one has no `as-at-period-end` branch to offer, and that is D-65 rather
/// than an omission: AR aging is stored as the sole record of a closed month
/// and is never recomputed, so there is no past instant to answer for. The
/// honest move is the second one B-150 allows — name the instant it does
/// answer for.
///
/// `timeZoneName: 'short'` always, so the sentence carries its own clock
/// ("CDT", "UTC") and cannot be read against the wrong one. When the facilities
/// in scope span zones there is no single local clock, so it says UTC and the
/// suffix makes that visible rather than implied.
export function arAgingNote(asOf: Date, timezone: string | null, periodLabel: string): string {
  // Spelled out rather than `dateStyle`/`timeStyle`: `timeZoneName` cannot be
  // combined with either, and the zone suffix is the half that matters here.
  const at = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone ?? 'UTC',
    timeZoneName: 'short',
  }).format(asOf)
  const scope = timezone
    ? ''
    : ' These facilities span more than one timezone, so this is stated in UTC.'
  return `Balances are aged as at ${at}. The ${periodLabel} range above does not apply to them.${scope}`
}

/// The one sentence every surface prints under a unit-occupancy figure.
///
/// Written once because the screen, the CSV and the scheduled email each show
/// the same number and a reader who sees two different explanations of it
/// trusts neither — the same argument `@storage/core/metrics` makes about the
/// figure itself, applied to the caveat.
export function unitOccupancyNote(
  provenance: UnitOccupancyProvenance,
  periodLabel: string,
): string {
  const { reason, historyBegins } = provenance
  switch (reason) {
    case 'as-at-period-end':
      return `Unit and square-foot occupancy are as at the end of ${periodLabel}.`
    case 'period-not-ended':
      return `Unit and square-foot occupancy are as of today — ${periodLabel} has not ended yet. Economic occupancy covers the days so far.`
    case 'before-history':
      return `Unit and square-foot occupancy are as of today, not ${periodLabel}: unit status was not recorded before ${formatDay(historyBegins!)}. Economic occupancy does cover ${periodLabel}.`
    case 'no-units':
      return `No units at this facility, so there is no occupancy to report for ${periodLabel}.`
  }
}

/// The as-at status of every unit at a facility that existed at `asAt`.
///
/// `DISTINCT ON` rather than a fetch-and-dedupe in JS because the history grows
/// without bound while the unit count does not — the row this needs is the last
/// one per unit, and Postgres can find it from the `(facilityId, effectiveFrom)`
/// index instead of shipping five years of changes to Node.
///
/// A unit with no row at or before `asAt` did not exist yet, and is absent from
/// the result rather than counted at its founding status — a building opened in
/// August is correctly not part of July's denominator.
async function unitStatusesAsAt(facilityId: string, asAt: Date) {
  return prisma.$queryRaw<{ unitId: string; status: string }[]>`
    SELECT DISTINCT ON (h."unitId") h."unitId" AS "unitId", h."status"::text AS "status"
    FROM "unit_status_history" h
    WHERE h."facilityId" = ${facilityId} AND h."effectiveFrom" < ${asAt}
    ORDER BY h."unitId", h."effectiveFrom" DESC, h."id" DESC
  `
}

/// US-39.1 + US-39.2 for one facility.
///
/// `collectedCents` is rent actually collected in the window — read from the
/// ledger, which is the tenant-facing source of truth (§7.3) and the only
/// place payments exist until invoicing lands (B-044).
/// Exported for B-084 part 3's scheduled emails, which report on ONE facility
/// that a permitted staff member already subscribed. Authorization happened at
/// subscribe time; re-deriving it from an actor the job does not have would
/// mean either inventing a staff identity or making the system actor a
/// superuser, and both are worse than a facility-explicit function.
export async function occupancyForFacility(
  facilityId: string,
  facilityName: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<FacilityOccupancy> {
  const [units, rates, collected, history] = await Promise.all([
    prisma.unit.findMany({
      where: { facilityId },
      select: {
        id: true,
        status: true,
        unitTypeId: true,
        unitType: { select: { widthFt: true, lengthFt: true } },
      },
    }),
    prisma.unitTypeRate.findMany({
      where: { facilityId, effectiveFrom: { lte: periodEnd } },
      orderBy: { effectiveFrom: 'desc' },
      select: { unitTypeId: true, streetRateCents: true, effectiveFrom: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { facilityId, type: 'payment', occurredAt: { gte: periodStart, lt: periodEnd } },
      _sum: { amountCents: true },
    }),
    // B-131. The earliest thing this facility can answer for. Null means no
    // units at all, which is the one case where the question is trivial.
    prisma.unitStatusHistory.aggregate({
      where: { facilityId },
      _min: { effectiveFrom: true },
    }),
  ])

  const historyBegins = history._min.effectiveFrom
  const now = new Date()
  // Three ways the range cannot apply, and they are different sentences to a
  // reader: no units at all, the month is older than the history, or the month
  // has not finished. All three land on the same figures — today's — so the
  // reason is carried, not re-derived from a bare false.
  const reason: UnitOccupancyProvenance['reason'] =
    historyBegins === null
      ? 'no-units'
      : periodEnd.getTime() > now.getTime()
        ? 'period-not-ended'
        : historyBegins >= periodEnd
          ? 'before-history'
          : 'as-at-period-end'
  const followsPeriod = reason === 'as-at-period-end'
  const asAt = followsPeriod ? periodEnd : now

  // Absent from the as-at map = the unit did not exist yet, so it drops out of
  // BOTH the numerator and the denominator rather than being counted at some
  // status it did not have.
  const asAtStatus = followsPeriod
    ? new Map((await unitStatusesAsAt(facilityId, asAt)).map((row) => [row.unitId, row.status]))
    : null
  const effectiveUnits = asAtStatus
    ? units.flatMap((unit) => {
        const status = asAtStatus.get(unit.id)
        return status ? [{ ...unit, status: status as (typeof unit)['status'] }] : []
      })
    : units

  // The rate in force at period end, per unit type — first row wins because
  // the query is already ordered newest-effective-first.
  const streetRateByType = new Map<string, number>()
  for (const rate of rates) {
    if (!streetRateByType.has(rate.unitTypeId)) streetRateByType.set(rate.unitTypeId, rate.streetRateCents)
  }

  // Unit TYPE is read as it stands today, not as at the period: nothing
  // historises a retype, so square footage is current even when the status is
  // not. In practice a retype is rare and a resize rarer still; when that stops
  // being true this is the second table, not a patch to this one.
  const forOccupancy = effectiveUnits.map((unit) => ({
    status: unit.status,
    squareFeet: unit.unitType.widthFt * unit.unitType.lengthFt,
  }))

  // Payments are stored negative on the ledger (they reduce what is owed);
  // collected revenue is the positive magnitude of that.
  const collectedCents = Math.abs(collected._sum.amountCents ?? 0)

  return {
    facilityId,
    facilityName,
    occupancy: occupancy(forOccupancy),
    economic: economicOccupancy(
      collectedCents,
      // Same unit set as the occupancy above, on purpose — this module exists
      // to stop two figures on one page disagreeing about which units count.
      effectiveUnits.map((unit) => ({
        rentable: unit.status !== 'unrentable',
        streetRateCents: streetRateByType.get(unit.unitTypeId) ?? 0,
      })),
    ),
    unitOccupancy: { asAt, followsPeriod, reason, historyBegins },
  }
}

export type OccupancyReport = {
  rows: FacilityOccupancy[]
  total: {
    occupancy: OccupancyResult
    economic: EconomicOccupancyResult
    /// B-131. The portfolio total follows the period only if EVERY facility in
    /// it does. A total assembled from one historical row and one current one
    /// is a number with no instant, and it is the number that gets quoted.
    unitOccupancy: UnitOccupancyProvenance
  }
}

export async function occupancyReport(
  actor: Actor,
  periodStart: Date,
  periodEnd: Date,
): Promise<OccupancyReport> {
  const facilities = await reportableFacilities(actor)
  for (const facility of facilities) assertCanReport(actor, facility.id)

  const rows = await Promise.all(
    facilities.map((facility) =>
      occupancyForFacility(facility.id, facility.name, periodStart, periodEnd),
    ),
  )

  return {
    rows,
    total: {
      occupancy: sumOccupancy(rows.map((row) => row.occupancy)),
      economic: sumEconomicOccupancy(rows.map((row) => row.economic)),
      unitOccupancy: combineProvenance(rows.map((row) => row.unitOccupancy)),
    },
  }
}

/// The weakest claim any row makes, which is the only claim the total can make.
/// `historyBegins` is the LATEST of the facilities' starts for the same reason:
/// the portfolio can answer as-at only from the moment its newest site could.
export function combineProvenance(
  parts: readonly UnitOccupancyProvenance[],
): UnitOccupancyProvenance {
  const now = new Date()
  // A facility with no units has no history and no units to count. It cannot
  // make the portfolio less answerable, so it is dropped rather than allowed
  // to drag `followsPeriod` false for sites that DO have a recorded past.
  const speaking = parts.filter((part) => part.historyBegins !== null)
  if (speaking.length === 0) {
    return { asAt: now, followsPeriod: false, reason: 'no-units', historyBegins: null }
  }

  const followsPeriod = speaking.every((part) => part.followsPeriod)
  const failing = speaking.find((part) => !part.followsPeriod)
  return {
    // Rows that follow the period share its end; rows that do not are each
    // "now", and a mixed total is only honest as now.
    asAt: followsPeriod ? speaking[0]!.asAt : now,
    followsPeriod,
    reason: failing?.reason ?? 'as-at-period-end',
    historyBegins: new Date(Math.max(...speaking.map((part) => part.historyBegins!.getTime()))),
  }
}

export type RentRollRow = {
  facilityName: string
  unitNumber: string
  unitTypeName: string
  tenantName: string
  inPlaceRateCents: number
  streetRateCents: number
  gapCents: number
  monthsSinceLastChange: number | null
  balanceCents: number
  startDate: Date
}

/// US-39.1's rent roll, which doubles as US-39.2's rate-variance worklist —
/// the same rows, sorted by the gap. Occupied units only: a rent roll is what
/// is being paid, so an empty unit has no line.
export async function rentRoll(actor: Actor, facilityId: string): Promise<RentRollRow[]> {
  const access = facilityAccess(actor)
  if (!access.all && !access.facilityIds.includes(facilityId)) {
    throw new ForbiddenError(`No access to facility ${facilityId}`, undefined, facilityId)
  }
  assertCanReport(actor, facilityId)

  const leases = await prisma.lease.findMany({
    where: { facilityId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: {
      id: true,
      monthlyRateCents: true,
      startDate: true,
      facility: { select: { name: true } },
      tenant: { select: { firstName: true, lastName: true } },
      unit: {
        select: { number: true, unitTypeId: true, unitType: { select: { name: true } } },
      },
      rateChanges: { orderBy: { effectiveFrom: 'desc' }, take: 1, select: { effectiveFrom: true } },
    },
  })
  if (leases.length === 0) return []

  const [rates, balances] = await Promise.all([
    prisma.unitTypeRate.findMany({
      where: { facilityId, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
      select: { unitTypeId: true, streetRateCents: true },
    }),
    prisma.ledgerEntry.groupBy({
      by: ['leaseId'],
      where: { leaseId: { in: leases.map((lease) => lease.id) } },
      _sum: { amountCents: true },
    }),
  ])

  const streetRateByType = new Map<string, number>()
  for (const rate of rates) {
    if (!streetRateByType.has(rate.unitTypeId)) streetRateByType.set(rate.unitTypeId, rate.streetRateCents)
  }
  const balanceByLease = new Map(balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))

  const now = new Date()
  const rows: (RentRollRow & RateVarianceRow)[] = leases.map((lease) => {
    const streetRateCents = streetRateByType.get(lease.unit.unitTypeId) ?? 0
    const lastChange = lease.rateChanges[0]?.effectiveFrom ?? lease.startDate
    return {
      facilityName: lease.facility.name,
      unitNumber: lease.unit.number,
      unitTypeName: lease.unit.unitType.name,
      tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      inPlaceRateCents: lease.monthlyRateCents,
      streetRateCents,
      gapCents: streetRateCents - lease.monthlyRateCents,
      monthsSinceLastChange: wholeMonthsBetween(lastChange, now),
      balanceCents: balanceByLease.get(lease.id) ?? 0,
      startDate: lease.startDate,
    }
  })

  // Sorted by the core module, not here — the ordering IS part of the rate
  // variance definition (§4.11: "sorted by gap").
  return rateVariance(rows) as (RentRollRow & RateVarianceRow)[]
}

export type FacilityMoves = {
  facilityId: string
  facilityName: string
  moves: MoveCounts
  conversion: ConversionResult
}

export type MovesReport = {
  rows: FacilityMoves[]
  total: { moves: MoveCounts; conversion: ConversionResult }
}

/// US-39.3, the report §4.11 calls out as having been orphaned: counts and
/// net by facility and date range, by source, with reservation conversion and
/// average days to move-in.
export async function movesReport(
  actor: Actor,
  periodStart: Date,
  periodEnd: Date,
): Promise<MovesReport> {
  const facilities = await reportableFacilities(actor)
  for (const facility of facilities) assertCanReport(actor, facility.id)

  const rows = await Promise.all(
    facilities.map((facility) =>
      movesForFacility(facility.id, facility.name, periodStart, periodEnd),
    ),
  )

  return {
    rows,
    total: {
      moves: sumMoveCounts(rows.map((row) => row.moves)),
      // Reconstructed rather than summed: `reservationConversion` also
      // computes an average time-to-convert, which cannot be averaged from
      // per-facility averages without weighting. The synthetic dates are
      // deliberate — only the COUNTS feed the portfolio figure.
      conversion: reservationConversion(
        rows.flatMap((row) =>
          Array.from({ length: row.conversion.reservations }, (_, index) => ({
            createdAt: new Date(0),
            convertedAt: index < row.conversion.converted ? new Date(0) : null,
          })),
        ),
      ),
    },
  }
}

/// One facility's moves. Same reasoning as `occupancyForFacility` above: a
/// scheduled report knows its facility explicitly and has no actor to scope by.
export async function movesForFacility(
  facilityId: string,
  facilityName: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<FacilityMoves> {
  const [moveIns, moveOutCount, reservations] = await Promise.all([
    prisma.lease.findMany({
      where: { facilityId, startDate: { gte: periodStart, lt: periodEnd } },
      select: { id: true, acquisitionSource: true, acquisitionChannel: true },
    }),
    prisma.lease.count({
      where: { facilityId, moveOutDate: { gte: periodStart, lt: periodEnd }, status: 'ended' },
    }),
    // Serves every source (B-140): an aggregate count of holds created in the
    // period, not a per-tenant message — a transfer hold belongs in this
    // total the same as a web one.
    prisma.reservation.findMany({
      where: { facilityId, createdAt: { gte: periodStart, lt: periodEnd } },
      select: { createdAt: true, status: true, updatedAt: true },
    }),
  ])

  // B-097 filled the gap this comment used to describe. `acquisitionSource`
  // is stamped at move-in from the reservation that produced it, so a phone
  // lead that became a rental reports as `phone` rather than as `web`. A lease
  // from before capture has a null column and reports as `unknown`, which stays
  // visible rather than being folded into `web` — quietly crediting the channel
  // this report exists to evaluate is the failure the whole item was written to
  // prevent.
  //
  // B-082 part 1 added the second axis. `acquisitionSource` says how the deal
  // was taken; `acquisitionChannel` says where the renter came from, and until
  // it existed every marketplace rental reported as `web` — identical to an
  // organic one, in the report an owner uses to decide what to keep paying for.
  // Both splits count the SAME move-ins, so the two totals agree by
  // construction.
  return {
    facilityId,
    facilityName,
    moves: moveCounts(
      moveIns.map((lease) => ({
        source: normalizeSource(lease.acquisitionSource),
        channel: normalizeChannel(lease.acquisitionChannel),
      })),
      moveOutCount,
    ),
    conversion: reservationConversion(
      reservations.map((reservation) => ({
        createdAt: reservation.createdAt,
        // `updatedAt` is when the status last moved; for a converted
        // reservation that is the conversion itself. Approximate, and noted as
        // such — a dedicated `convertedAt` column belongs with whichever item
        // next touches the reservation lifecycle.
        convertedAt: reservation.status === 'converted' ? reservation.updatedAt : null,
      })),
    ),
  }
}

export type DelinquencyReport = {
  rows: { facilityId: string; facilityName: string; aging: ArAging; split: ArAgingSplit }[]
  total: ArAging
  /// B-207. The same money, split by whether the delinquency ladder is still
  /// working it. `totalSplit.total` is `total` by construction, so everything
  /// that tied out before still ties out.
  totalSplit: ArAgingSplit
  /// B-150. The instant every bucket in this report describes.
  ///
  /// AR aging is point-in-time and D-65 settled that it stays that way — how
  /// old a debt is has no meaning across a range, and the frozen month-end copy
  /// is the only record a past month will ever have. So the report cannot
  /// answer for a past date, and the fix is the one D-68 chose for unit
  /// occupancy one section above it on the same screen: say which instant it
  /// DOES answer for, rather than let a month picker imply an answer it never
  /// gave.
  asOf: Date
  /// The timezone to read `asOf` in: the one every facility in scope shares, or
  /// null when they do not agree and no single local clock is the right one.
  timezone: string | null
}

/// US-39.4's aging.
///
/// Live since B-044: `Invoice` rows with real original due dates now exist, so
/// the buckets report rather than collapsing every lease into the first one.
/// The ageing is `daysPastDue` from @storage/core/metrics — the single shared
/// definition (D-25), anchored to the OLDEST unpaid invoice's ORIGINAL due
/// date and never to a retry attempt, which is what keeps a lease that has
/// declined four times (B-046) ageing rather than resetting to current.
///
/// The outstanding figure is still the ledger balance rather than a sum of
/// invoice remainders. They agree once every charge is invoiced, and the
/// ledger is the source of truth for balance by PRD 01 §7.3 — so a lease
/// carrying a pre-billing move-in charge still shows the money it owes.
export async function delinquencyReport(actor: Actor): Promise<DelinquencyReport> {
  // Financial, not operational: AR is money. Before B-055 this used the looser
  // either-or check, which put the portfolio's receivables in front of a role
  // whose only reporting key is `reports:operational`.
  const facilities = await financialFacilities(actor)

  // One clock for every facility, not one per call. Each `agingForFacility`
  // would otherwise take its own `new Date()`, so the instant the note names
  // would be none of the instants the buckets were actually cut at.
  const asOf = new Date()
  const rows = await Promise.all(
    facilities.map((facility) => agingForFacility(facility.id, facility.name, asOf)),
  )

  const zones = new Set(facilities.map((facility) => facility.timezone))
  return {
    rows,
    total: sumArAging(rows.map((row) => row.aging)),
    totalSplit: sumArAgingSplit(rows.map((row) => row.split)),
    asOf,
    timezone: zones.size === 1 ? [...zones][0]! : null,
  }
}

/// One facility's aging, as of now.
///
/// Takes no date and cannot be given one — see D-65. Exported for the same
/// reason as `occupancyForFacility`: a scheduled report knows its facility and
/// has no actor to scope by.
///
/// B-207: the split is computed HERE, not by each caller, because this one
/// function is what the AR table, the dashboard tile, the scheduled
/// delinquency email and the accounting close all read. B-195 built
/// `arAgingSplit` and only the tenant-level drill-down used it, so the four
/// surfaces that actually get forwarded to an owner still could not say
/// whether anyone was chasing the money. `aging` is `split.total` by
/// construction and is deliberately still returned — nothing that tied out
/// stops tying out.
export async function agingForFacility(
  facilityId: string,
  facilityName: string,
  asOf: Date = new Date(),
): Promise<{
  facilityId: string
  facilityName: string
  aging: ArAging
  split: ArAgingSplit
}> {
  const leases = await prisma.lease.findMany({
    where: { facilityId },
    select: {
      id: true,
      invoices: { select: { dueDate: true, totalCents: true, amountPaidCents: true } },
    },
  })
  if (leases.length === 0) {
    const empty = arAgingSplit([])
    return { facilityId, facilityName, aging: empty.total, split: empty }
  }

  const leaseIds = leases.map((lease) => lease.id)
  const [balances, halted] = await Promise.all([
    prisma.ledgerEntry.groupBy({
      by: ['leaseId'],
      where: { leaseId: { in: leaseIds } },
      _sum: { amountCents: true },
    }),
    // `halt_dunning` and not "has any hold", for the reason `delinquencyDetail`
    // gives at length: the catalog decides which holds stop the ladder, not
    // this file (US-42).
    effectsByLease(leaseIds, 'halt_dunning', asOf),
  ])
  const balanceByLease = new Map(balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))

  const split = arAgingSplit(
    leases.map((lease) => ({
      daysPastDue: daysPastDue(lease.invoices, asOf),
      outstandingCents: balanceByLease.get(lease.id) ?? 0,
      halted: halted.has(lease.id),
    })),
  )

  return { facilityId, facilityName, aging: split.total, split }
}

export type FacilityAttachRate = {
  facilityId: string
  facilityName: string
  attach: AttachRateResult
}

export type AttachRateReport = {
  rows: FacilityAttachRate[]
  total: AttachRateResult
  /// Display name for every staffId that appears in any row's `byStaff`,
  /// keyed the same way. `UNASSIGNED_STAFF` is not a real id and is not a key
  /// here — the caller labels that bucket itself.
  staffNames: Record<string, string>
}

/// PRD 02 US-44 / §4.11's AC (B-155, operator review 2026-08-21): "Dollars
/// are reported and the ratio is not." Plan-enrolled leases ÷ new move-ins,
/// per facility, per month, by channel and by staff member.
///
/// US-44 also says a **new** move-in is enrolled the moment it does not carry
/// `protectionWaivedAt` — `provisionLease` (B-026) sets `protectionPlanName`
/// to null exactly when the tenant waives, so "enrolled" is just "the column
/// is not null" and needs no second flag.
export async function attachRateReport(
  actor: Actor,
  periodStart: Date,
  periodEnd: Date,
): Promise<AttachRateReport> {
  const facilities = await reportableFacilities(actor)
  for (const facility of facilities) assertCanReport(actor, facility.id)

  const rows = await Promise.all(
    facilities.map((facility) =>
      attachRateForFacility(facility.id, facility.name, periodStart, periodEnd),
    ),
  )

  const total = sumAttachRate(rows.map((row) => row.attach))

  // Names for the coaching table. `UNASSIGNED_STAFF` is excluded — it is not
  // a StaffUser row, and the report labels that bucket itself ("Web /
  // self-service").
  const staffIds = Object.keys(total.byStaff).filter((id) => id !== UNASSIGNED_STAFF)
  const staff =
    staffIds.length === 0
      ? []
      : await prisma.staffUser.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, firstName: true, lastName: true },
        })

  return {
    rows,
    total,
    staffNames: Object.fromEntries(staff.map((s) => [s.id, `${s.firstName} ${s.lastName}`])),
  }
}

/// One facility's attach rate. Same reasoning as `movesForFacility` above: a
/// scheduled report knows its facility explicitly and has no actor to scope
/// by.
export async function attachRateForFacility(
  facilityId: string,
  facilityName: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<FacilityAttachRate> {
  const leases = await prisma.lease.findMany({
    where: { facilityId, startDate: { gte: periodStart, lt: periodEnd } },
    select: { id: true, protectionPlanName: true, acquisitionSource: true },
  })

  if (leases.length === 0) return { facilityId, facilityName, attach: attachRate([]) }

  // "The staff member who completed the move-in" has no column of its own —
  // a move-in is finalized by `provisionLease` from a Stripe webhook (B-026),
  // with no staff actor in that path at all. What DOES name a person is
  // `Payment.receivedByStaffId` (US-32): required for cash, check and money
  // order, and exactly who was behind the counter for a phone or walk-in
  // rental. The move-in's EARLIEST payment is that attribution; a card
  // payment taken online legitimately has nobody there, and reports as
  // `UNASSIGNED_STAFF` rather than crediting (or blaming) a real staffer for
  // a deal they never touched.
  const allocations = await prisma.paymentAllocation.findMany({
    where: { invoice: { leaseId: { in: leases.map((lease) => lease.id) } } },
    select: {
      invoice: { select: { leaseId: true } },
      payment: { select: { receivedAt: true, receivedByStaffId: true } },
    },
  })

  const earliestPaymentByLease = new Map<string, { receivedAt: Date; receivedByStaffId: string | null }>()
  for (const allocation of allocations) {
    const leaseId = allocation.invoice.leaseId
    const current = earliestPaymentByLease.get(leaseId)
    if (!current || allocation.payment.receivedAt < current.receivedAt) {
      earliestPaymentByLease.set(leaseId, allocation.payment)
    }
  }

  return {
    facilityId,
    facilityName,
    attach: attachRate(
      leases.map((lease) => ({
        enrolled: lease.protectionPlanName !== null,
        channel: normalizeSource(lease.acquisitionSource),
        staffId: earliestPaymentByLease.get(lease.id)?.receivedByStaffId ?? null,
      })),
    ),
  }
}
