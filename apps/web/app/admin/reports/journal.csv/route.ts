import { requireStaffActor } from '@/lib/rbac/session'
import { journalCsv, journalFor } from '@/lib/admin/accounting-close'

// PRD 02 US-40 (B-084 part 2). The month-end journal, as a file.
//
// Takes an explicit facility, year and month rather than a date range: a
// journal belongs to a CLOSED period, and a range would invite exporting one
// that is still moving.

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const actor = await requireStaffActor()
  const url = new URL(request.url)
  const facilityId = url.searchParams.get('facilityId') ?? ''
  const year = Number(url.searchParams.get('year'))
  const month = Number(url.searchParams.get('month'))

  if (!facilityId || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return new Response('Ask for a facility, a year and a month.', { status: 400 })
  }

  const result = await journalFor(actor, facilityId, year, month)
  // A refusal is a sentence with a 409, not a 500: "that month is not closed"
  // is information, and the screen only offers this link for closed months —
  // so reaching it means somebody edited a URL or the month was reopened in
  // another tab.
  if (!result.ok) return new Response(result.reason, { status: 409 })

  return new Response(journalCsv(result.journal), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="journal-${result.journal.reference}.csv"`,
    },
  })
}
