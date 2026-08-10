import { prisma } from '@storage/db'
import {
  bounceRate,
  deliveryRate,
  emptyMessageCounts,
  smsFailureRate,
  type MessageCounts,
} from '@storage/core/metrics'
import { reportableFacilities } from './reports'
import { can } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// PRD 05 CN-19 (B-075). The adapter between real `Message`/`Task`/
// `EventDelivery` rows and `@storage/core/metrics`. Same rule as
// `lib/admin/reports.ts`: this file fetches and shapes, it never computes a
// rate — every ratio comes back from the metrics module.

export type CommsDashboardFilters = {
  facilityId?: string
  from: Date
  /// Exclusive.
  to: Date
}

export type RateRow = {
  counts: MessageCounts
  deliveryRate: number | null
  bounceRate: number | null
  smsFailureRate: number | null
}

export type TemplateRow = RateRow & { templateKey: string; channel: 'email' | 'sms' }
export type DailyRow = RateRow & { day: string }

export type DeadLetterRow = {
  id: string
  eventName: string
  entityType: string
  entityId: string
  consumer: string
  lastError: string | null
  completedAt: Date | null
}

export type CommsDashboard = {
  templates: TemplateRow[]
  daily: DailyRow[]
  overall: RateRow
  /// CN-19's "failure queue" — open `no_reachable_channel` tasks, scoped to
  /// the same facilities as everything else on the page. The queue itself is
  /// the ordinary task list (`/admin/tasks`); this is a count with a link.
  failureQueueCount: number
  /// FR-19's dead-letter surface: `EventDelivery` rows that exhausted their
  /// retries, scoped through the event they belong to. Capped at 20 — this is
  /// meant to be empty or nearly so; a longer list belongs in a real queue
  /// screen, which is not what a rare, urgent condition needs.
  deadLetters: DeadLetterRow[]
}

function rateRowFrom(counts: MessageCounts): RateRow {
  return {
    counts,
    deliveryRate: deliveryRate(counts),
    bounceRate: bounceRate(counts),
    smsFailureRate: smsFailureRate(counts),
  }
}

function emptyDashboard(): CommsDashboard {
  return {
    templates: [],
    daily: [],
    overall: rateRowFrom(emptyMessageCounts()),
    failureQueueCount: 0,
    deadLetters: [],
  }
}

/// Adds one row's count onto a `MessageCounts` bucket. `queued` is the one
/// `MessageStatus` value with no field here — it means "not settled yet", the
/// same reason `totalAttempted` excludes it, so a queued row contributes to
/// nothing a rate is computed from.
function addStatus(counts: MessageCounts, status: string, amount: number): void {
  if (status === 'queued') return
  if (status in counts) counts[status as keyof MessageCounts] += amount
}

export async function commsDashboard(actor: Actor, filters: CommsDashboardFilters): Promise<CommsDashboard> {
  const facilities = await reportableFacilities(actor)
  const allowed = facilities.filter((facility) => can(actor, 'reports:operational', facility.id))
  if (allowed.length === 0) return emptyDashboard()

  const facilityIds = filters.facilityId
    ? allowed.filter((facility) => facility.id === filters.facilityId).map((f) => f.id)
    : allowed.map((facility) => facility.id)
  if (facilityIds.length === 0) return emptyDashboard()

  const where = { facilityId: { in: facilityIds }, createdAt: { gte: filters.from, lt: filters.to } }

  // One query, folded two ways below — by (template, channel) for the table
  // CN-19 asks for, and by day for the trend it also asks for. Fetching once
  // and bucketing in memory rather than two queries: this is a report over a
  // bounded date range, not a hot path, and it keeps the two breakdowns from
  // ever being able to disagree about which rows they counted.
  const rows = await prisma.message.findMany({
    where,
    select: { templateKey: true, channel: true, status: true, createdAt: true },
  })

  const byTemplate = new Map<string, TemplateRow>()
  const byDay = new Map<string, MessageCounts>()
  const overallCounts = emptyMessageCounts()

  for (const row of rows) {
    addStatus(overallCounts, row.status, 1)

    const templateKey = `${row.templateKey}:${row.channel}`
    const template =
      byTemplate.get(templateKey) ??
      ({ templateKey: row.templateKey, channel: row.channel, ...rateRowFrom(emptyMessageCounts()) } as TemplateRow)
    addStatus(template.counts, row.status, 1)
    byTemplate.set(templateKey, template)

    const day = row.createdAt.toISOString().slice(0, 10)
    const dayCounts = byDay.get(day) ?? emptyMessageCounts()
    addStatus(dayCounts, row.status, 1)
    byDay.set(day, dayCounts)
  }

  // Rates were computed into placeholder rows above before their counts were
  // final — recompute now that every row has been folded in.
  const templates = [...byTemplate.values()]
    .map((template) => ({ ...template, ...rateRowFrom(template.counts) }))
    .sort((a, b) => a.templateKey.localeCompare(b.templateKey) || a.channel.localeCompare(b.channel))
  const daily = [...byDay.entries()]
    .map(([day, counts]) => ({ day, ...rateRowFrom(counts) }))
    .sort((a, b) => a.day.localeCompare(b.day))

  const [failureQueueCount, deadLetterRows] = await Promise.all([
    prisma.task.count({
      where: { facilityId: { in: facilityIds }, type: 'no_reachable_channel', status: 'open' },
    }),
    prisma.eventDelivery.findMany({
      where: { status: 'dead_letter', event: { facilityId: { in: facilityIds } } },
      include: { event: { select: { name: true, entityType: true, entityId: true } } },
      orderBy: { completedAt: 'desc' },
      take: 20,
    }),
  ])

  return {
    templates,
    daily,
    overall: rateRowFrom(overallCounts),
    failureQueueCount,
    deadLetters: deadLetterRows.map((row) => ({
      id: row.id,
      eventName: row.event.name,
      entityType: row.event.entityType,
      entityId: row.event.entityId,
      consumer: row.consumer,
      lastError: row.lastError,
      completedAt: row.completedAt,
    })),
  }
}
