import { averageIncreaseCents, averageIncreasePercent, OUTCOME_WINDOWS, type RateIncreaseOutcome } from '@storage/core/metrics'
import { requireStaffActor } from '@/lib/rbac/session'
import { reportRangeForActor } from '@/lib/admin/reports'
import {
  batchLabel,
  NOT_YET,
  ninetyDayMeasured,
  rateIncreaseOutcomeReport,
  windowCell,
} from '@/lib/admin/rate-increase-outcome-report'
import { csvCents, csvPercent, toCsv } from '@/lib/admin/csv'

// B-400. US-39's "CSV export matching on-screen data exactly": same range
// parse, same report function, same rows in the same order, and the window
// cells come from the same `windowCell` the page renders.

function cells(outcome: RateIncreaseOutcome): string[] {
  const measured = ninetyDayMeasured(outcome)
  return [
    String(outcome.count),
    csvCents(averageIncreaseCents(outcome)),
    csvPercent(averageIncreasePercent(outcome)),
    ...OUTCOME_WINDOWS.map((days) => windowCell(outcome, days)),
    measured ? String(outcome.retentionCutLeases) : NOT_YET,
    measured ? csvCents(outcome.retentionCutCents) : NOT_YET,
    measured ? csvCents(outcome.netMonthlyCents) : NOT_YET,
  ]
}

export async function GET(request: Request): Promise<Response> {
  const actor = await requireStaffActor()
  const url = new URL(request.url)
  const range = await reportRangeForActor(actor, {
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  })
  const report = await rateIncreaseOutcomeReport(actor, range.start, range.end)

  const rows = report.facilities.flatMap((facility) => [
    [facility.facilityName, 'All', ...cells(facility.outcome)],
    ...facility.batches.map((batch) => [facility.facilityName, batchLabel(batch), ...cells(batch.outcome)]),
  ])
  if (report.facilities.length > 1) rows.push(['All facilities', 'All', ...cells(report.total)])

  const csv = toCsv(
    [
      'Facility',
      'Batch',
      'Raised',
      'Avg increase',
      'Avg %',
      'Left within 30 days',
      'Left within 60 days',
      'Left within 90 days',
      'Retention cuts within 90 days',
      'Retention cut monthly amount',
      'Net monthly change',
    ],
    rows,
  )

  const today = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rate-increase-outcomes-${today}.csv"`,
    },
  })
}
