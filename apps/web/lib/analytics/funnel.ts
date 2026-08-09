import { prisma, type Prisma } from '@storage/db'
import { emptyFunnel, FUNNEL_STEPS, funnelFrom, type FunnelStepResult } from '@storage/core/analytics'
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

export type FunnelReport = {
  steps: FunnelStepResult[]
  /// Which channels appear in this range, for the filter control. Read from the
  /// same rows the report counts, so the dropdown can never offer a value that
  /// produces an empty report.
  channels: string[]
}

export async function funnelReport(actor: Actor, filters: FunnelFilters): Promise<FunnelReport> {
  const facilities = await reportableFacilities(actor)
  const allowed = facilities.filter((facility) => can(actor, 'reports:operational', facility.id))
  if (allowed.length === 0) return { steps: funnelFrom(emptyFunnel()), channels: [] }

  const facilityIds = filters.facilityId
    ? allowed.filter((facility) => facility.id === filters.facilityId).map((f) => f.id)
    : allowed.map((facility) => facility.id)
  if (facilityIds.length === 0) return { steps: funnelFrom(emptyFunnel()), channels: [] }

  const where: Prisma.AnalyticsEventWhereInput = {
    facilityId: { in: facilityIds },
    occurredAt: { gte: filters.from, lt: filters.to },
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.utmSource ? { utmSource: filters.utmSource } : {}),
    ...(filters.utmMedium ? { utmMedium: filters.utmMedium } : {}),
  }

  // Distinct SESSIONS per step, not events. One person refreshing a facility
  // page six times is one session; counting events would make the top of the
  // funnel look wide and every conversion rate look terrible.
  const counts = emptyFunnel()
  for (const step of FUNNEL_STEPS) {
    const rows = await prisma.analyticsEvent.findMany({
      where: { ...where, name: step.event },
      select: { sessionId: true },
      distinct: ['sessionId'],
    })
    counts[step.key] = rows.length
  }

  const channelRows = await prisma.analyticsEvent.findMany({
    where: { facilityId: { in: facilityIds }, occurredAt: { gte: filters.from, lt: filters.to } },
    select: { channel: true },
    distinct: ['channel'],
  })

  return {
    steps: funnelFrom(counts),
    channels: channelRows
      .map((row) => row.channel)
      .filter((channel): channel is string => Boolean(channel))
      .sort(),
  }
}
