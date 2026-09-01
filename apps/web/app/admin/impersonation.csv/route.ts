import { requireStaffActor } from '@/lib/rbac/session'
import { ForbiddenError, hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { reportRange } from '@/lib/admin/report-range'
import { toCsv } from '@/lib/admin/csv'
import { sessionReport } from '@/lib/impersonation/oversight'

// PRD 09 FR-19 (B-092). "CSV-exportable", under PRD 02 US-39's rule that the
// export matches the on-screen data exactly — which is only true because this
// reads the SAME query string through the SAME `reportRange` and the same
// `sessionReport`. Two queries would be two answers.
//
// This path carries an extension, so `proxy.ts`'s matcher deliberately skips
// it and there is no edge-layer auth in front of it. That is the same posture
// every other `.csv` route here takes and the reason the permission is checked
// on the first two lines rather than assumed.

const END_LABELS: Record<string, string> = {
  self: 'Returned to their account',
  expiry: 'Expired on its own',
  forced: 'Ended by an owner',
  authority_changed: 'Roles changed mid-session',
}

export async function GET(request: Request): Promise<Response> {
  const actor = await requireStaffActor()
  if (!hasPermissionAnywhere(actor, ['impersonation:oversee'])) {
    throw new ForbiddenError('Missing permission impersonation:oversee', 'impersonation:oversee')
  }

  const url = new URL(request.url)
  const one = (key: string): string | undefined => url.searchParams.get(key) ?? undefined
  // D-109, same window as the screen it exports (US-39).
  const range = reportRange({ from: one('from'), to: one('to') }, { window: 'rolling-30-days' })

  const rows = await sessionReport(actor, {
    from: range.start,
    to: range.end,
    subjectQuery: one('subject'),
    facilityId: one('facility'),
  })

  const csv = toCsv(
    [
      'Started (UTC)',
      'Staff member',
      'Subject type',
      'Subject',
      'Reason',
      'Ticket',
      'Ended (UTC)',
      'Minutes',
      'How it ended',
      'Ended by',
    ],
    rows.map((row) => [
      row.startedAt.toISOString(),
      row.impersonatorName,
      row.subjectType,
      row.subjectName,
      row.reason,
      row.ticketRef ?? '',
      row.endedAt ? row.endedAt.toISOString() : '',
      row.endedAt
        ? Math.max(1, Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 60_000))
        : '',
      row.endedBy ? END_LABELS[row.endedBy] : 'Still running',
      row.endedByName ?? '',
    ]),
  )

  const today = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="support-sessions-${today}.csv"`,
    },
  })
}
