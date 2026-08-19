import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { reportRange } from '@/lib/admin/report-range'
import { switcherFacilities } from '@/lib/admin/facility-selection'
import { AdminForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import {
  activeSessions,
  frequencyFlags,
  sessionReport,
  FREQUENCY_FLAG_DISTINCT_SUBJECTS,
  type SessionRow,
} from '@/lib/impersonation/oversight'
import { forceEndImpersonationAction } from './actions'

export const metadata = { title: 'Support sessions' }

// PRD 09 §5.5 (B-092). Oversight — and FR-21 is the reason it is a screen
// rather than a query somebody could run: D-13a removed tenant notification,
// so this is the ONLY place misuse becomes visible. §8 calls "Phase A only,
// indefinitely" the one unsafe resting state, and this ends it.

const END_LABELS: Record<string, string> = {
  self: 'Returned to their account',
  expiry: 'Expired on its own',
  forced: 'Ended by an owner',
  authority_changed: 'Roles changed mid-session',
}

function when(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function minutes(from: Date, to: Date): string {
  return `${Math.max(1, Math.round((to.getTime() - from.getTime()) / 60_000))} min`
}

function subjectLabel(row: SessionRow): string {
  return `${row.subjectName} (${row.subjectType === 'tenant' ? 'tenant' : 'staff'})`
}

export default async function ImpersonationOversightPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await getAdminActor()

  // FR-18/FR-19 are one permission. A staff member without it gets the same
  // shape of refusal every other permission-gated admin screen gives, rather
  // than a 403 page.
  if (!hasPermissionAnywhere(actor, ['impersonation:oversee'])) {
    return (
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        Support-session oversight is for an owner. If you need to know whether somebody opened a
        particular account, ask one — the record is complete and cannot be edited.
      </p>
    )
  }

  const params = await searchParams
  const one = (key: string): string | undefined => {
    const value = params[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }

  const range = reportRange({ from: one('from'), to: one('to') })
  const facilityId = one('facility')
  const subjectQuery = one('subject')

  const [active, rows, facilities] = await Promise.all([
    activeSessions(actor),
    sessionReport(actor, {
      from: range.start,
      to: range.end,
      subjectQuery,
      facilityId,
    }),
    switcherFacilities(actor),
  ])

  const flags = frequencyFlags(rows)
  const csvHref = `/admin/impersonation.csv?${new URLSearchParams({
    from: range.fromValue,
    to: range.toValue,
    ...(facilityId ? { facility: facilityId } : {}),
    ...(subjectQuery ? { subject: subjectQuery } : {}),
  }).toString()}`

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Support sessions</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Every time a member of staff opened somebody&apos;s account to help them, why they said
          they needed to, and how it ended. Tenants are not told when this happens, which is a
          deliberate decision — so this page is the only place it shows up, and it is worth reading
          rather than filing.
        </p>
      </header>

      <section aria-labelledby="active-heading" className="flex flex-col gap-3">
        <h2 id="active-heading" className="font-medium">
          Running right now
        </h2>
        {active.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nobody is in a support session.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((row) => (
              <li
                key={row.id}
                className="border-input flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-sm"
              >
                <div className="flex flex-col gap-1">
                  <p>
                    <strong>{row.impersonatorName}</strong> is viewing{' '}
                    <strong>{subjectLabel(row)}</strong>
                  </p>
                  <p className="text-muted-foreground">
                    Started {when(row.startedAt)} · expires {when(row.expiresAt)}
                  </p>
                  <p className="text-pretty">
                    &ldquo;{row.reason}&rdquo;
                    {row.ticketRef ? ` · ticket ${row.ticketRef}` : ''}
                  </p>
                </div>
                {/* FR-18: force-end, immediately. The next request the
                    impersonator makes re-reads the row and drops them back to
                    their own account — there is no token to wait out, which is
                    §6.1's whole argument for keeping the state in a row. */}
                <AdminForm
                  action={forceEndImpersonationAction}
                  label={`End ${row.impersonatorName}'s session as ${row.subjectName}`}
                >
                  <input type="hidden" name="sessionId" value={row.id} />
                  <Button type="submit" variant="outline">
                    End this session
                  </Button>
                </AdminForm>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="flags-heading" className="flex flex-col gap-3">
        <h2 id="flags-heading" className="font-medium">
          Worth a question
        </h2>
        {flags.length === 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            Nobody opened more than {FREQUENCY_FLAG_DISTINCT_SUBJECTS} different accounts in a day
            in this period.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {flags.map((flag) => (
              <li
                key={`${flag.impersonatorStaffId}-${flag.day}`}
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-pretty text-amber-900"
              >
                <strong>{flag.impersonatorName}</strong> opened {flag.distinctSubjects} different
                accounts on {flag.day}. That is above the {FREQUENCY_FLAG_DISTINCT_SUBJECTS} a day
                this report treats as ordinary. It is not necessarily wrong — a bad morning looks
                like this too — but it is worth asking about.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="report-heading" className="flex flex-col gap-3">
        <h2 id="report-heading" className="font-medium">
          The record
        </h2>

        {/* Plain labels and inputs, matching every other report filter here
            (reports/deliverability). `Field` belongs to `AdminForm` and carries
            its error plumbing, which a GET form that cannot fail has no use
            for. */}
        <form className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            From
            <input
              type="date"
              name="from"
              defaultValue={range.fromValue}
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            To
            <input
              type="date"
              name="to"
              defaultValue={range.toValue}
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Whose account
            <input
              type="text"
              name="subject"
              defaultValue={subjectQuery ?? ''}
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Facility
            <select
              name="facility"
              defaultValue={facilityId ?? ''}
              className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
            >
              <option value="">Any facility</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="border-input hover:bg-accent min-h-11 rounded-md border px-4 text-sm font-medium"
          >
            Apply
          </button>
        </form>

        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Showing {rows.length} {rows.length === 1 ? 'session' : 'sessions'} started {range.label}.
          The facility filter uses where each account is <em>today</em> — a tenant who has since
          moved out no longer counts at the site they were at.{' '}
          <Link href={csvHref} className="underline underline-offset-4">
            Download as CSV
          </Link>
        </p>

        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No support sessions match.</p>
        ) : (
          <div tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-3xl text-left text-sm">
              <caption className="sr-only">
                Support sessions started {range.label}, newest first
              </caption>
              <thead>
                <tr className="border-input border-b">
                  <th scope="col" className="py-2 pr-4 font-medium">Started</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Staff member</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Whose account</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Why</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Lasted</th>
                  <th scope="col" className="py-2 pr-4 font-medium">How it ended</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-input border-b align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">{when(row.startedAt)}</td>
                    <td className="py-2 pr-4">{row.impersonatorName}</td>
                    <td className="py-2 pr-4">{subjectLabel(row)}</td>
                    <td className="py-2 pr-4">
                      {row.reason}
                      {row.ticketRef && (
                        <span className="text-muted-foreground block text-xs">
                          Ticket {row.ticketRef}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {row.endedAt ? minutes(row.startedAt, row.endedAt) : 'Running'}
                    </td>
                    <td className="py-2 pr-4">
                      {row.endedBy ? END_LABELS[row.endedBy] : 'Still running'}
                      {row.endedByName && (
                        <span className="text-muted-foreground block text-xs">
                          {row.endedByName}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
