import { requireStaffActor } from '@/lib/rbac/session'
import { occupancyReport } from '@/lib/admin/reports'
import { csvCents, csvPercent, toCsv } from '@/lib/admin/csv'

// PRD 02 US-39: "CSV export matching on-screen data exactly."
//
// Same function, same arguments, same rounding helpers as the screen — the
// export cannot disagree with the table because there is only one source for
// both. A second query shaped "close enough" is exactly how the two drift.

export async function GET(request: Request): Promise<Response> {
  const actor = await requireStaffActor()
  const url = new URL(request.url)
  const month = url.searchParams.get('month') ?? new Date().toISOString().slice(0, 7)

  const [year, monthIndex] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, monthIndex - 1, 1))
  const end = new Date(Date.UTC(year, monthIndex, 1))

  const report = await occupancyReport(actor, start, end)

  const rows = report.rows.map((row) => [
    row.facilityName,
    row.occupancy.occupiedCount,
    row.occupancy.rentableCount,
    csvPercent(row.occupancy.ratio),
    row.occupancy.occupiedSquareFeet,
    row.occupancy.rentableSquareFeet,
    csvPercent(row.occupancy.squareFootRatio),
    csvCents(row.economic.collectedCents),
    csvCents(row.economic.grossPotentialCents),
    csvPercent(row.economic.ratio),
    // B-131. A date, not the screen's prose — a spreadsheet column that says
    // which instant the unit figures describe is the same fact in the form the
    // reader of a CSV can filter on. Per row, because facilities can differ.
    row.unitOccupancy.asAt.toISOString().slice(0, 10),
  ])

  rows.push([
    'All facilities',
    report.total.occupancy.occupiedCount,
    report.total.occupancy.rentableCount,
    csvPercent(report.total.occupancy.ratio),
    report.total.occupancy.occupiedSquareFeet,
    report.total.occupancy.rentableSquareFeet,
    csvPercent(report.total.occupancy.squareFootRatio),
    csvCents(report.total.economic.collectedCents),
    csvCents(report.total.economic.grossPotentialCents),
    csvPercent(report.total.economic.ratio),
    report.total.unitOccupancy.asAt.toISOString().slice(0, 10),
  ])

  const csv = toCsv(
    [
      'Facility',
      'Occupied units',
      'Rentable units',
      'Unit occupancy %',
      'Occupied sq ft',
      'Rentable sq ft',
      'Sq-ft occupancy %',
      'Collected',
      'Gross potential',
      'Economic occupancy %',
      'Unit occupancy as at',
    ],
    rows,
  )

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="occupancy-${month}.csv"`,
    },
  })
}
