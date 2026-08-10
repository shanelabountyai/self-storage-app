import { requireStaffActor } from '@/lib/rbac/session'
import { reportRange } from '@/lib/admin/report-range'
import { commsDashboard } from '@/lib/admin/comms-dashboard'
import { csvPercent, toCsv } from '@/lib/admin/csv'

// PRD 02 US-39 / PRD 05 CN-19: "CSV export matching on-screen data exactly."
// Same `reportRange` parse and the same `commsDashboard` call the page
// makes — the "exactly" only holds if the export cannot read the same query
// string differently than the screen did.

export async function GET(request: Request): Promise<Response> {
  const actor = await requireStaffActor()
  const url = new URL(request.url)
  const range = reportRange({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  })
  const facilityId = url.searchParams.get('facility') ?? undefined

  const report = await commsDashboard(actor, { from: range.start, to: range.end, facilityId })

  const rows = report.templates.map((row) => [
    row.templateKey,
    row.channel,
    row.counts.sent + row.counts.delivered + row.counts.bounced + row.counts.failed,
    row.deliveryRate === null ? '' : csvPercent(row.deliveryRate),
    row.bounceRate === null ? '' : csvPercent(row.bounceRate),
    row.channel === 'sms' && row.smsFailureRate !== null ? csvPercent(row.smsFailureRate) : '',
  ])

  const csv = toCsv(
    ['Template', 'Channel', 'Sent', 'Delivered %', 'Bounced %', 'SMS failed %'],
    rows,
  )

  const today = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="deliverability-${today}.csv"`,
    },
  })
}
