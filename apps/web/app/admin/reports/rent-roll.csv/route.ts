import { requireStaffActor } from '@/lib/rbac/session'
import { rentRoll } from '@/lib/admin/reports'
import { csvCents, toCsv } from '@/lib/admin/csv'

// PRD 02 US-39. Same `rentRoll` call the screen makes, in the same order.

export async function GET(request: Request): Promise<Response> {
  const actor = await requireStaffActor()
  const facilityId = new URL(request.url).searchParams.get('facility')
  if (!facilityId) return new Response('facility is required', { status: 400 })

  const rows = await rentRoll(actor, facilityId)

  const csv = toCsv(
    ['Unit', 'Size', 'Tenant', 'In place', 'Street', 'Gap', 'Months since change', 'Balance', 'Started'],
    rows.map((row) => [
      row.unitNumber,
      row.unitTypeName,
      row.tenantName,
      csvCents(row.inPlaceRateCents),
      csvCents(row.streetRateCents),
      csvCents(row.gapCents),
      row.monthsSinceLastChange ?? '',
      csvCents(row.balanceCents),
      row.startDate.toISOString().slice(0, 10),
    ]),
  )

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="rent-roll.csv"',
    },
  })
}
