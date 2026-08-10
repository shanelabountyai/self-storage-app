import { prisma } from '@storage/db'
import type { Consumer } from '@storage/core/events'
import { staleDeliveryCount } from '@storage/core/events'
import { dailyFailureRateExceeds, emptyMessageCounts, type MessageCounts } from '@storage/core/metrics'
import type { DunningResult } from '@/lib/billing/dunning'
import { alertOwner } from './alerts'

// PRD 05 FR-19 (B-075). The three silent-failure detectors, named
// individually in the requirement. Each is deliberately its own small
// function called from wherever its own condition is already known, rather
// than one "detectors" job re-deriving facts a job three lines away already
// computed.

const CONSUMER_LAG_MS = 15 * 60_000

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/// "Alert if >2% of a day's sends fail." Called once per facility per
/// business date, from the same lateness in the night every other daily scan
/// runs at — so this reads a settled day, not one still in flight.
export async function detectDailyFailureRate(
  facilityId: string,
  businessDate: Date,
): Promise<{ checked: boolean; alerted: boolean }> {
  const nextDay = new Date(businessDate.getTime() + 86_400_000)
  const rows = await prisma.message.findMany({
    where: { facilityId, createdAt: { gte: businessDate, lt: nextDay } },
    select: { status: true },
  })
  if (rows.length === 0) return { checked: true, alerted: false }

  const counts = emptyMessageCounts()
  for (const row of rows) {
    if (row.status === 'queued') continue
    if (row.status in counts) counts[row.status as keyof MessageCounts] += 1
  }

  if (!dailyFailureRateExceeds(counts)) return { checked: true, alerted: false }

  const failed = counts.bounced + counts.failed
  const attempted = counts.sent + counts.delivered + failed
  const result = await alertOwner(
    `daily_failure_rate:${facilityId}:${isoDay(businessDate)}`,
    'Send failure rate over 2%',
    `${failed} of ${attempted} sends (${((failed / attempted) * 100).toFixed(1)}%) bounced or failed at this facility on ${isoDay(businessDate)}. See the Deliverability report.`,
  )
  return { checked: true, alerted: result.sent }
}

/// "Alert if a dunning run sends zero messages when delinquent tenants
/// exist." Called right after `runDunning`, with the `DunningResult` it just
/// produced — `eligible` is the ladder's own count of leases it evaluated
/// as due a step, so this never re-derives "delinquent" by a second,
/// possibly-disagreeing definition.
export async function detectSilentDunning(
  facilityId: string,
  businessDate: Date,
  result: DunningResult,
): Promise<{ alerted: boolean }> {
  if (result.eligible === 0 || result.emitted > 0) return { alerted: false }

  const alert = await alertOwner(
    `silent_dunning:${facilityId}:${isoDay(businessDate)}`,
    'Dunning ladder sent nothing for delinquent tenants',
    `${result.eligible} lease${result.eligible === 1 ? ' was' : 's were'} due a dunning step at this facility on ${isoDay(businessDate)}, and none went out. Check the billing run for this date.`,
  )
  return { alerted: alert.sent }
}

export type ConsumerLagResult = { consumer: string; stale: number; alerted: boolean }

/// "Alert if the event consumer lags >15 minutes." Hourly — this cannot be a
/// once-daily business-date job, the same reasoning every other
/// elapsed-time check in this codebase (B-073's abandonment sweep, B-074's
/// quiet-hours retry) already gives. Keyed by day, not by tick: an ongoing
/// lag alerts once when it is first noticed today, not every hour it
/// persists — the operator does not need forty-eight copies of "still lagging".
export async function detectConsumerLag(
  consumers: readonly Consumer[],
  now: Date = new Date(),
): Promise<ConsumerLagResult[]> {
  const results: ConsumerLagResult[] = []
  for (const consumer of consumers) {
    const stale = await staleDeliveryCount(consumer, CONSUMER_LAG_MS, now)
    if (stale === 0) {
      results.push({ consumer: consumer.name, stale, alerted: false })
      continue
    }
    const alert = await alertOwner(
      `consumer_lag:${consumer.name}:${isoDay(now)}`,
      `"${consumer.name}" is falling behind`,
      `${stale} event${stale === 1 ? ' has' : 's have'} been waiting more than 15 minutes for "${consumer.name}" to process them, as of ${now.toISOString()}.`,
    )
    results.push({ consumer: consumer.name, stale, alerted: alert.sent })
  }
  return results
}
