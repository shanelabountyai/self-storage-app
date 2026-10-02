import { requireStaffActor } from '@/lib/rbac/session'
import { movesCsv, movesReport, reportRangeForMonth } from '@/lib/admin/reports'

// B-430. Same range parse and same `movesReport` as the screen (see
// occupancy.csv), so the export cannot disagree with the table.
export async function GET(request: Request): Promise<Response> {
  const actor = await requireStaffActor()
  const { start, end, month } = await reportRangeForMonth(
    actor,
    new URL(request.url).searchParams.get('month') ?? undefined,
  )
  return new Response(movesCsv(await movesReport(actor, start, end)), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="moves-${month}.csv"`,
    },
  })
}
