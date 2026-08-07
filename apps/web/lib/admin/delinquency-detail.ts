import { prisma } from '@storage/db'
import { arAging, arBucketFor, daysPastDue, sumArAging, type ArAging, type ArBucket } from '@storage/core/metrics'
import { stepsFrom } from '@storage/core/billing'
import { financialFacilities } from '@/lib/admin/reports'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 US-39.4 (B-055). The aging report, tenant by tenant.
//
// The portfolio tiles (B-042) answer "how much is out there". This answers the
// question an owner asks next — "who" — and it is the one the PRD is most
// specific about, because of a failure mode named in US-14:
//
//   "an ended lease carrying a balance lands somewhere... It never simply
//    disappears from the delinquency view, and it stays inside the AR aging
//    report (US-39.4)."
//
// A move-out is the moment a balance becomes least likely to be paid and most
// likely to be forgotten. A report that filtered to `status: 'active'` would be
// tidier, would tie out against nothing, and would quietly write off every
// former tenant's debt by omission. This one filters on the BALANCE, never on
// the lease status, and shows the status as a column so a former tenant is
// visible as a former tenant rather than absent.

export type DelinquentLeaseRow = {
  leaseId: string
  facilityId: string
  facilityName: string
  tenantId: string
  tenantName: string
  unitNumber: string
  /// `ended` here is the whole point of the report — see the note above.
  leaseStatus: string
  daysPastDue: number
  bucket: ArBucket
  outstandingCents: number
  /// US-39.4's "delinquency step distribution": which rung of the facility's
  /// own dunning ladder (CN-3) this lease has reached. 0 means past due but not
  /// yet at the first step.
  dunningStep: number
  /// The first ladder day this lease has NOT yet crossed, or null at the top.
  /// What an owner wants beside the step: how much runway is left.
  nextStepDay: number | null
}

export type DelinquencyDetailReport = {
  rows: DelinquentLeaseRow[]
  aging: ArAging
  /// Count of leases per step, so the distribution is a distribution and not a
  /// number an operator has to tally off the table by hand.
  stepCounts: { step: number; day: number | null; leases: number; outstandingCents: number }[]
  /// US-39.4's "total exposure": every dollar owed, including the leases that
  /// have already ended.
  totalExposureCents: number
  endedLeaseExposureCents: number
}

/// Every lease carrying a balance, aged, across the facilities this actor may
/// see money for.
///
/// Point-in-time by nature: aging is measured `asOf` an instant, not over a
/// range, because "how old is this debt" has no meaning across a period. The
/// screen passes `now`; the parameter exists so a test can pin it.
export async function delinquencyDetail(
  actor: Actor,
  asOf: Date = new Date(),
): Promise<DelinquencyDetailReport> {
  const facilities = await financialFacilities(actor)
  if (facilities.length === 0) {
    return {
      rows: [],
      aging: arAging([]),
      stepCounts: [],
      totalExposureCents: 0,
      endedLeaseExposureCents: 0,
    }
  }

  const facilityIds = facilities.map((facility) => facility.id)
  const facilityNames = new Map(facilities.map((facility) => [facility.id, facility.name]))

  const ladders = new Map(
    (
      await prisma.facility.findMany({
        where: { id: { in: facilityIds } },
        select: { id: true, dunningDays: true },
      })
    ).map((facility) => [facility.id, stepsFrom(facility.dunningDays)]),
  )

  // No lease-status filter, deliberately. See the note at the top of the file.
  const leases = await prisma.lease.findMany({
    where: { facilityId: { in: facilityIds } },
    select: {
      id: true,
      facilityId: true,
      status: true,
      tenantId: true,
      tenant: { select: { firstName: true, lastName: true } },
      unit: { select: { number: true } },
      invoices: { select: { dueDate: true, totalCents: true, amountPaidCents: true } },
    },
  })

  // The ledger is the source of truth for balance (PRD 01 §7.3), the same
  // choice `delinquencyReport` made — so a lease carrying a pre-billing
  // move-in charge still shows the money it owes.
  const balances = await prisma.ledgerEntry.groupBy({
    by: ['leaseId'],
    where: { leaseId: { in: leases.map((lease) => lease.id) } },
    _sum: { amountCents: true },
  })
  const balanceByLease = new Map(balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))

  const rows: DelinquentLeaseRow[] = []
  for (const lease of leases) {
    const outstandingCents = balanceByLease.get(lease.id) ?? 0
    if (outstandingCents <= 0) continue

    const days = daysPastDue(lease.invoices, asOf)
    const steps = ladders.get(lease.facilityId) ?? []
    const crossed = steps.filter((step) => days >= step.day)
    const next = steps.find((step) => days < step.day) ?? null

    rows.push({
      leaseId: lease.id,
      facilityId: lease.facilityId,
      facilityName: facilityNames.get(lease.facilityId) ?? '',
      tenantId: lease.tenantId,
      tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      unitNumber: lease.unit?.number ?? '—',
      leaseStatus: lease.status,
      daysPastDue: days,
      bucket: arBucketFor(days),
      outstandingCents,
      dunningStep: crossed.length > 0 ? crossed[crossed.length - 1].position : 0,
      nextStepDay: next?.day ?? null,
    })
  }

  // Oldest debt first, then largest — the order somebody working the list
  // actually wants, rather than alphabetical by whoever happens to be first.
  rows.sort(
    (a, b) => b.daysPastDue - a.daysPastDue || b.outstandingCents - a.outstandingCents,
  )

  const aging = arAging(rows)
  const stepCounts = summariseSteps(rows)

  return {
    rows,
    aging,
    stepCounts,
    totalExposureCents: aging.totalCents,
    endedLeaseExposureCents: rows
      .filter((row) => row.leaseStatus === 'ended')
      .reduce((sum, row) => sum + row.outstandingCents, 0),
  }
}

function summariseSteps(rows: readonly DelinquentLeaseRow[]) {
  const byStep = new Map<number, { leases: number; outstandingCents: number; day: number | null }>()
  for (const row of rows) {
    const existing = byStep.get(row.dunningStep) ?? { leases: 0, outstandingCents: 0, day: null }
    existing.leases += 1
    existing.outstandingCents += row.outstandingCents
    byStep.set(row.dunningStep, existing)
  }
  return [...byStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, totals]) => ({ step, ...totals }))
}

/// Per-facility aging that sums to the same total as the detail rows.
///
/// US-39's roll-up rule ("the total equals the sum of the facility reports")
/// is asserted rather than assumed: both this and `aging` above are built from
/// the same `rows`, so they cannot disagree.
export function agingByFacility(
  rows: readonly DelinquentLeaseRow[],
): { facilityId: string; facilityName: string; aging: ArAging }[] {
  const byFacility = new Map<string, { name: string; rows: DelinquentLeaseRow[] }>()
  for (const row of rows) {
    const entry = byFacility.get(row.facilityId) ?? { name: row.facilityName, rows: [] }
    entry.rows.push(row)
    byFacility.set(row.facilityId, entry)
  }
  return [...byFacility.entries()]
    .map(([facilityId, entry]) => ({
      facilityId,
      facilityName: entry.name,
      aging: arAging(entry.rows),
    }))
    .sort((a, b) => a.facilityName.localeCompare(b.facilityName))
}

export function totalAging(
  byFacility: readonly { aging: ArAging }[],
): ArAging {
  return sumArAging(byFacility.map((row) => row.aging))
}
