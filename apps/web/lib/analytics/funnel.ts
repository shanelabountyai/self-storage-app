import { prisma, type Prisma } from '@storage/db'
import {
  emptyFunnel,
  FUNNEL_STEPS,
  funnelFrom,
  type FunnelCounts,
  type FunnelStepResult,
} from '@storage/core/analytics'
import { reportableFacilities } from '@/lib/admin/reports'
import { can } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// PRD 04 US-15 AC4 / FR-AN-3 (B-069). "Per-facility funnel report: sessions →
// leads → reservations started → completed → move-ins, filterable by date range
// and source/medium; conversion rates at each step."
//
// Computed from `AnalyticsEvent` alone — the server log — rather than by
// counting `Lead` and `Reservation` rows. Those would be more accurate for two
// of the five steps and impossible for the other three, and a funnel whose
// steps come from different sources cannot be reasoned about: a conversion rate
// between a session count and a lead-table count is comparing a measurement to
// a record, and the ratio moves when either definition shifts.

export type FunnelFilters = {
  facilityId?: string
  from: Date
  /// Exclusive.
  to: Date
  channel?: string
  utmSource?: string
  utmMedium?: string
}

/// B-082 part 4. One row of the source/medium breakdown.
///
/// `source` and `medium` are null for a session that arrived with no campaign
/// tags — most of them. Rendered as "direct or organic" rather than dropped:
/// a breakdown that silently omits the largest row is worse than no breakdown.
export type SourceMediumRow = {
  source: string | null
  medium: string | null
  counts: FunnelCounts
  steps: FunnelStepResult[]
}

/// B-082 part 4. PRD 04 US-9 AC4 generalised: which follow-up sequence, if any,
/// a move-in came back through.
export type SequenceResult = {
  key: string
  label: string
  moveIns: number
}

export type FunnelReport = {
  steps: FunnelStepResult[]
  /// Which channels appear in this range, for the filter control. Read from the
  /// same rows the report counts, so the dropdown can never offer a value that
  /// produces an empty report.
  channels: string[]
  /// Same rule, for the source/medium controls this report has accepted since
  /// B-069 and had no way to set until B-082 part 4.
  sources: string[]
  mediums: string[]
  /// B-082 part 4. The funnel split by campaign source/medium. Every session is
  /// in exactly ONE row (D-61), so these foot to `steps` above.
  bySourceMedium: SourceMediumRow[]
  /// PRD 04 US-9 AC4 (B-073), widened by B-082 part 4 from one sequence to
  /// every sequence that can bring somebody back. Read off `properties` on the
  /// same `move_in_completed` events the funnel's last step already counts, not
  /// a second query against `CheckoutSession` or `Lead`.
  sequences: SequenceResult[]
  /// Move-ins in range, the denominator for `sequences`. Equal to the last
  /// funnel step by construction — it is the same query.
  sequenceMoveIns: number
}

/// The sequences a move-in can be credited to, and the property that says so.
///
/// A catalog rather than two ad-hoc reads, because the report renders one row
/// per entry and a sequence added to the product with no entry here is a
/// sequence nobody can see the value of — which is how the abandonment
/// follow-up went a whole item before anything reported on it.
///
/// These are NOT mutually exclusive and the report does not pretend they are:
/// a renter can be chased by the lead drip, abandon a checkout, and be brought
/// back by the abandonment sequence. Percentages are of move-ins, and they can
/// legitimately sum to more than 100%.
const SEQUENCES = [
  {
    key: 'abandonment',
    label: 'Abandoned-checkout follow-up',
    property: 'recoveredByAbandonment',
  },
  {
    key: 'lead_drip',
    label: 'Lead follow-up drip',
    property: 'fromLeadDrip',
  },
] as const

export async function funnelReport(actor: Actor, filters: FunnelFilters): Promise<FunnelReport> {
  const facilities = await reportableFacilities(actor)
  const allowed = facilities.filter((facility) => can(actor, 'reports:operational', facility.id))
  const empty: FunnelReport = {
    steps: funnelFrom(emptyFunnel()),
    channels: [],
    sources: [],
    mediums: [],
    bySourceMedium: [],
    sequences: SEQUENCES.map((sequence) => ({ key: sequence.key, label: sequence.label, moveIns: 0 })),
    sequenceMoveIns: 0,
  }
  if (allowed.length === 0) return empty

  const facilityIds = filters.facilityId
    ? allowed.filter((facility) => facility.id === filters.facilityId).map((f) => f.id)
    : allowed.map((facility) => facility.id)
  if (facilityIds.length === 0) return empty

  const where: Prisma.AnalyticsEventWhereInput = {
    facilityId: { in: facilityIds },
    occurredAt: { gte: filters.from, lt: filters.to },
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.utmSource ? { utmSource: filters.utmSource } : {}),
    ...(filters.utmMedium ? { utmMedium: filters.utmMedium } : {}),
  }

  // B-082 part 4. Each session's source/medium, decided ONCE from its earliest
  // event in the range (D-61), so a session appears in exactly one breakdown
  // row and the rows foot to the totals below.
  //
  // `distinct` with an ascending `orderBy` gives Postgres's DISTINCT ON — the
  // first row per session — which is what makes "earliest" true rather than
  // "whichever the planner returned first".
  //
  // ponytail: one pass over the range's events to build the map. It is a single
  // indexed read and the row count is one per session, not one per event. The
  // upgrade when that stops being small is a session dimension table written at
  // first touch, and the trigger is this query's row count approaching the
  // event count — which happens when sessions stop firing multiple events, i.e.
  // never, or when the range is a year.
  const attributionRows = await prisma.analyticsEvent.findMany({
    where,
    select: { sessionId: true, utmSource: true, utmMedium: true },
    distinct: ['sessionId'],
    orderBy: { occurredAt: 'asc' },
  })
  const attribution = new Map(
    attributionRows.map((row) => [row.sessionId, { source: row.utmSource, medium: row.utmMedium }]),
  )

  // Distinct SESSIONS per step, not events. One person refreshing a facility
  // page six times is one session; counting events would make the top of the
  // funnel look wide and every conversion rate look terrible.
  const counts = emptyFunnel()
  const byKey = new Map<string, { source: string | null; medium: string | null; counts: FunnelCounts }>()
  let sequenceMoveIns = 0
  const sequenceCounts = new Map<string, number>(SEQUENCES.map((sequence) => [sequence.key, 0]))

  for (const step of FUNNEL_STEPS) {
    // `properties` is read on every step rather than only the last: it is one
    // more column on a query that already runs, and reading it conditionally is
    // how the move-in count and the sequence counts would end up coming from
    // two different queries and disagreeing.
    const rows = await prisma.analyticsEvent.findMany({
      where: { ...where, name: step.event },
      select: { sessionId: true, properties: true },
      distinct: ['sessionId'],
    })
    counts[step.key] = rows.length

    for (const row of rows) {
      const touch = attribution.get(row.sessionId) ?? { source: null, medium: null }
      // A NUL escape as the separator, not a space or a hyphen. UTM values are
      // only CHECKED against the registry, never rejected (`checkUtm` reports
      // rather than refuses, so attribution already paid for is not lost), so
      // an operator's `utm_source=summer sale` would otherwise land in the same
      // bucket as `utm_source=summer` with `utm_medium=sale`.
      const key = `${touch.source ?? ''}\u0000${touch.medium ?? ''}`
      let bucket = byKey.get(key)
      if (!bucket) {
        bucket = { source: touch.source, medium: touch.medium, counts: emptyFunnel() }
        byKey.set(key, bucket)
      }
      bucket.counts[step.key] += 1
    }

    if (step.key === 'move_ins') {
      sequenceMoveIns = rows.length
      for (const sequence of SEQUENCES) {
        const hits = rows.filter(
          (row) => (row.properties as Record<string, unknown> | null)?.[sequence.property] === true,
        ).length
        sequenceCounts.set(sequence.key, hits)
      }
    }
  }

  const channelRows = await prisma.analyticsEvent.findMany({
    where: { facilityId: { in: facilityIds }, occurredAt: { gte: filters.from, lt: filters.to } },
    select: { channel: true, utmSource: true, utmMedium: true },
  })

  const distinct = (values: (string | null)[]) =>
    [...new Set(values.filter((value): value is string => Boolean(value)))].sort()

  return {
    steps: funnelFrom(counts),
    channels: distinct(channelRows.map((row) => row.channel)),
    sources: distinct(channelRows.map((row) => row.utmSource)),
    mediums: distinct(channelRows.map((row) => row.utmMedium)),
    // Biggest first — the row an owner is looking for is almost always the one
    // with the most move-ins, and after that the most sessions.
    bySourceMedium: [...byKey.values()]
      .map((bucket) => ({ ...bucket, steps: funnelFrom(bucket.counts) }))
      .sort(
        (a, b) => b.counts.move_ins - a.counts.move_ins || b.counts.sessions - a.counts.sessions,
      ),
    sequences: SEQUENCES.map((sequence) => ({
      key: sequence.key,
      label: sequence.label,
      moveIns: sequenceCounts.get(sequence.key) ?? 0,
    })),
    sequenceMoveIns,
  }
}
