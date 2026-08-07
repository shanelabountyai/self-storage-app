import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { accessEventLog, summariseFlags } from '@/lib/access/event-log'
import { reportRange } from '@/lib/admin/report-range'
import { ACCESS_FLAGS, ACCESS_FLAG_LABELS, isAccessFlag } from '@storage/core/access'

export const metadata = { title: 'Gate activity' }

// PRD 03 US-5 (B-064). Who came through the gate, when, and what looked wrong.
//
// The flags are read off the row rather than computed here — they were decided
// when the event landed (see lib/access/webhook-handler.ts), because what the
// system thought at the time is the thing a manager is later asked about.

const REASON_LABELS: Record<string, string> = {
  ok: 'Opened',
  unknown_code: 'Code not recognised',
  inactive: 'Code no longer active',
  outside_hours: 'Outside gate hours',
  suspended: 'Account suspended',
}

function formatWhen(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(at)
}

export default async function AccessEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; result?: string; flag?: string }>
}) {
  const params = await searchParams
  const range = reportRange(params)
  const actor = await getAdminActor()

  if (!hasPermissionAnywhere(actor, ['access:events'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to gate activity.</p>
  }

  const rows = await accessEventLog(actor, {
    from: range.start,
    to: range.end,
    result: params.result === 'granted' || params.result === 'denied' ? params.result : undefined,
    flag: params.flag && isAccessFlag(params.flag) ? params.flag : undefined,
  })
  const flagCounts = summariseFlags(rows)
  const query = `from=${range.fromValue}&to=${range.toValue}`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Gate activity — {range.label}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Every attempt at the gate, including the ones that failed. A code nobody recognises is
          kept rather than discarded — a stranger working through numbers is exactly the pattern
          worth being able to look back at.
        </p>
      </div>

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
          Result
          <select
            name="result"
            defaultValue={params.result ?? ''}
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          >
            <option value="">Everything</option>
            <option value="granted">Opened</option>
            <option value="denied">Denied</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Flag
          <select
            name="flag"
            defaultValue={params.flag ?? ''}
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          >
            <option value="">Any</option>
            {ACCESS_FLAGS.map((flag) => (
              <option key={flag} value={flag}>
                {ACCESS_FLAG_LABELS[flag]}
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

      {flagCounts.length > 0 && (
        <section aria-labelledby="flags-heading" className="flex flex-col gap-3">
          <h2 id="flags-heading" className="font-medium">
            What stood out
          </h2>
          <ul className="flex flex-wrap gap-2">
            {flagCounts.map((entry) => (
              <li key={entry.flag}>
                {/* Each counter is a link that applies its own filter, so the
                    number and the list it refers to can never disagree. */}
                <Link
                  href={`/admin/access?${query}&flag=${entry.flag}`}
                  className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-3 text-sm"
                >
                  {ACCESS_FLAG_LABELS[entry.flag]}
                  <span className="text-muted-foreground ml-2 tabular-nums">{entry.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-3xl border-collapse text-sm">
          <caption className="sr-only">Gate attempts for {range.label}, newest first</caption>
          <thead>
            <tr className="border-input border-b text-left">
              <th scope="col" className="py-2 pr-4">
                When
              </th>
              <th scope="col" className="py-2 pr-4">
                Facility
              </th>
              <th scope="col" className="py-2 pr-4">
                Who
              </th>
              <th scope="col" className="py-2 pr-4">
                Unit
              </th>
              <th scope="col" className="py-2 pr-4">
                Result
              </th>
              <th scope="col" className="py-2 pr-4">
                Flags
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-input border-b">
                <td className="py-2 pr-4 whitespace-nowrap">{formatWhen(row.occurredAt, 'UTC')}</td>
                <td className="py-2 pr-4">{row.facilityName}</td>
                <td className="py-2 pr-4">
                  {row.tenantId ? (
                    <Link
                      href={`/admin/tenants/${row.tenantId}`}
                      className="underline underline-offset-2"
                    >
                      {row.tenantName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Unknown</span>
                  )}
                </td>
                <td className="py-2 pr-4">{row.unitNumber ?? '—'}</td>
                {/* The result is a word, never a colour alone (WCAG 1.4.1). */}
                <td className="py-2 pr-4">
                  {row.result === 'granted' ? 'Opened' : 'Denied'}
                  <span className="text-muted-foreground"> · {REASON_LABELS[row.reason] ?? row.reason}</span>
                </td>
                <td className="py-2 pr-4">
                  {row.flags.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <ul className="flex flex-wrap gap-1">
                      {row.flags.map((flag) => (
                        <li
                          key={flag}
                          className="border-input rounded-md border px-2 py-0.5 text-xs"
                        >
                          {ACCESS_FLAG_LABELS[flag]}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-muted-foreground py-3">
                  Nothing at the gate in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
