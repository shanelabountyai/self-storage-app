import { requireStaffActor } from '@/lib/rbac/session'
import { reportRangeForActor } from '@/lib/admin/reports'
import { billedTotal, collectedTotal, revenueReport, type RevenueRow } from '@/lib/admin/revenue-report'
import { REVENUE_CATEGORIES } from '@storage/core/metrics'
import { csvCents, toCsv } from '@/lib/admin/csv'

// PRD 02 US-39: "CSV export matching on-screen data exactly."
//
// Same function, same range parser, same rounding helper as the screen. The
// export cannot disagree with the table because there is only one source for
// both — a second query shaped "close enough" is exactly how the two drift.

function rowsFor(row: RevenueRow): (readonly unknown[])[] {
  return [
    [
      row.facilityName,
      'Billed',
      ...REVENUE_CATEGORIES.map((category) => csvCents(row.billed[category])),
      '',
      csvCents(billedTotal(row)),
    ],
    [
      row.facilityName,
      'Collected',
      ...REVENUE_CATEGORIES.map((category) => csvCents(row.collected[category])),
      csvCents(row.unappliedCents),
      csvCents(collectedTotal(row)),
    ],
    // The three standalone figures ride on the same row shape rather than in a
    // second file: an operator opening this in Excel wants one sheet, and a
    // discount that lives somewhere else is a discount nobody reconciles.
    [row.facilityName, 'Discounts given', '', '', '', '', '', csvCents(row.discountsCents)],
    [row.facilityName, 'Written off', '', '', '', '', '', csvCents(row.writeOffsCents)],
    [
      row.facilityName,
      'Refunded (already deducted from collected)',
      '',
      '',
      '',
      '',
      '',
      csvCents(row.refundsCents),
    ],
  ]
}

export async function GET(request: Request): Promise<Response> {
  const actor = await requireStaffActor()
  const url = new URL(request.url)
  const range = await reportRangeForActor(actor, {
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  })

  const report = await revenueReport(actor, range.start, range.end)

  const rows = report.rows.flatMap(rowsFor)
  if (report.rows.length > 0) rows.push(...rowsFor(report.total))

  const csv = toCsv(
    [
      'Facility',
      'Measure',
      'Rent',
      'Fees',
      'Protection',
      'Tax',
      'Unapplied',
      'Total',
    ],
    rows,
  )

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="revenue-${range.fromValue}-to-${range.toValue}.csv"`,
    },
  })
}
