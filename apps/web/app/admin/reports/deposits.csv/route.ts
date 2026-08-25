import { requireStaffActor } from '@/lib/rbac/session'
import { reportRange } from '@/lib/admin/report-range'
import { depositsReport } from '@/lib/admin/deposits-report'
import { csvCents, toCsv } from '@/lib/admin/csv'

// US-39's "CSV export matching on-screen data exactly" — same range parse,
// same report function the page calls.

export async function GET(request: Request): Promise<Response> {
  const actor = await requireStaffActor()
  const url = new URL(request.url)
  const range = reportRange({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  })

  const report = await depositsReport(
    actor,
    range.start,
    range.end,
    url.searchParams.get('facility') ?? undefined,
  )

  const rows = report.rows.map((row) => [
    row.businessDate,
    row.facilityName,
    csvCents(row.cashRecordedCents),
    csvCents(row.checksRecordedCents),
    csvCents(row.cardRecordedCents),
    row.countedCashCents === null ? '' : csvCents(row.countedCashCents),
    row.expectedCashCents === null ? '' : csvCents(row.expectedCashCents),
    row.varianceCents === null ? '' : csvCents(row.varianceCents),
    csvCents(row.unreconciledCents),
    row.note ?? '',
  ])

  const csv = toCsv(
    ['Day', 'Facility', 'Cash', 'Checks', 'Card', 'Counted cash', 'Expected cash', 'Over/short', 'Unreconciled', 'Note'],
    rows,
  )

  const today = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="deposits-${today}.csv"`,
    },
  })
}
