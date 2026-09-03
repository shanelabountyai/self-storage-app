import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { outstandingRuns, recentRuns } from '@/lib/admin/billing-runs'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { rerunAction } from './actions'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Billing runs' }

// PRD 02 FR-4. The nightly jobs, what they did, and one button to do it again.
//
// This is the screen that makes a scheduler trustworthy: a job that fails
// silently at 2am is indistinguishable from one that had nothing to do, and
// the difference is a month of uninvoiced rent. Every run is a row whether it
// succeeded, partly succeeded, or never finished.

function formatBusinessDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatInstant(date: Date | null): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const itemsId = (runId: string) => `items-${runId}`

/// B-229. "OK 412 / Failed 3" links straight to the three, so the failures are
/// what the reader lands on rather than what they scroll for. Stable sort, so
/// the runner's own order survives within each group.
function failuresFirst<T extends { ok: boolean }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(a.ok) - Number(b.ok))
}

const STATUS_LABEL: Record<string, string> = {
  running: 'Running',
  succeeded: 'Succeeded',
  partial: 'Partly failed',
  failed: 'Failed',
}

export default async function BillingRunsPage() {
  const actor = await getAdminActor()
  if (!hasPermissionAnywhere(actor, ['reports:financial', 'payments:take'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to Billing.</p>
  }

  const [runs, outstanding] = await Promise.all([recentRuns(actor), outstandingRuns(actor)])
  const canRerun = hasPermissionAnywhere(actor, ['facility:settings'])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Billing runs</h1>
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        Every nightly job, per facility, for the business date it ran for. Runs happen in each
        facility&apos;s own local time, and a date missed during an outage is caught up on the next
        tick rather than skipped.
      </p>

      {/* B-236. A run that FAILED is a row below with a status and an error. A
          run that has not HAPPENED writes no row at all, so until now it looked
          exactly like a quiet night — which is what a serial tick running out
          of its 300 seconds, or a cron that stopped firing, actually looks
          like. This is that state, said in words.

          1.4.1: the count and the date carry the meaning; nothing here is a
          colour or an icon. A zero is stated rather than left blank (B-235). */}
      <p className="max-w-prose text-sm text-pretty">
        {outstanding.total === 0 ? (
          'Nothing waiting: every run due so far today has happened.'
        ) : (
          <>
            <span className="font-medium">
              {outstanding.total} run{outstanding.total === 1 ? '' : 's'} due so far today{' '}
              {outstanding.total === 1 ? 'has' : 'have'} not run yet
            </span>
            {outstanding.facilities > 0 &&
              `, across ${outstanding.facilities} facilit${outstanding.facilities === 1 ? 'y' : 'ies'}`}
            . The oldest is for {formatBusinessDate(outstanding.oldest!)}. Each one stays due
            until it runs, so the next hourly tick picks it up — a date earlier than today
            means ticks have been missing, not that one is in progress.
          </>
        )}
      </p>

      {runs.length === 0 ? (
        <p className="text-muted-foreground text-sm">No runs recorded yet.</p>
      ) : (
        <ScrollRegion aria-label="Nightly job runs">
          <table className="w-full min-w-2xl text-sm">
            <caption className="sr-only">Recent nightly job runs with their per-item outcomes</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 font-medium">Job</th>
                <th scope="col" className="py-2 font-medium">Facility</th>
                <th scope="col" className="py-2 font-medium">Business date</th>
                <th scope="col" className="py-2 font-medium">Status</th>
                <th scope="col" className="py-2 text-right font-medium">OK</th>
                <th scope="col" className="py-2 text-right font-medium">Failed</th>
                <th scope="col" className="py-2 font-medium">Finished</th>
                {canRerun && <th scope="col" className="py-2 font-medium">Re-run</th>}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b align-top">
                  {/* 1.3.1: headers on both axes — the job names the row the
                      way the thead names the column. */}
                  <th scope="row" className="py-2 text-left font-normal">
                    {/* B-229. The operator's name for the job, never
                        `billing.assess-late-fees`. B-109's rule: admin may use
                        the industry's vocabulary, not the codebase's. */}
                    <span className="font-medium">{run.jobLabel}</span>
                    {(run.items.length > 0 || run.lastError) && (
                      /* Open by default when something failed, so the anchor in
                         the Failed column lands on a visible list rather than
                         on a closed disclosure. */
                      <details className="mt-1" id={itemsId(run.id)} open={run.itemsFailed > 0}>
                        <summary className="cursor-pointer text-xs underline underline-offset-2">
                          {run.items.length} item{run.items.length === 1 ? '' : 's'}
                          {run.lastError ? ' and an error' : ''}
                        </summary>
                        {run.lastError && (
                          <p className="mt-1 text-xs">
                            <span className="font-medium">Error:</span> {run.lastError}
                          </p>
                        )}
                        <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                          {failuresFirst(run.items).map((item, index) => (
                            <li key={`${item.itemId}-${index}`}>
                              {/* 1.4.1: the outcome is a word, never a colour. */}
                              <span className="font-medium">{item.ok ? 'OK' : 'Failed'}</span> ·{' '}
                              {/* B-229. A failed item names its subject the way
                                  a task card does. An OK one keeps its raw id:
                                  resolving eight hundred of them to label rows
                                  nobody opens is the query this screen should
                                  not run. */}
                              {item.subject.href ? (
                                <Link href={item.subject.href} className="underline underline-offset-2">
                                  {item.subject.label}
                                </Link>
                              ) : (
                                item.subject.label
                              )}
                              {item.message ? ` — ${item.message}` : ''}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </th>
                  <td className="py-2">{run.facilityName}</td>
                  <td className="py-2 tabular-nums">{formatBusinessDate(run.businessDate)}</td>
                  <td className="py-2">{STATUS_LABEL[run.status] ?? run.status}</td>
                  <td className="py-2 text-right tabular-nums">{run.itemsOk}</td>
                  <td className="py-2 text-right tabular-nums">
                    {run.itemsFailed > 0 ? (
                      <a href={`#${itemsId(run.id)}`} className="underline underline-offset-2">
                        {run.itemsFailed}
                        <span className="sr-only"> failed items on this run — see the list</span>
                      </a>
                    ) : (
                      run.itemsFailed
                    )}
                  </td>
                  <td className="py-2">{formatInstant(run.finishedAt)}</td>
                  {canRerun && (
                    <td className="py-2">
                      {run.rerunnable ? (
                        <form action={rerunAction}>
                          <input type="hidden" name="runId" value={run.id} />
                          <button
                            type="submit"
                            className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium"
                          >
                            Re-run
                            <span className="sr-only">
                              {' '}
                              {run.jobLabel} for {run.facilityName} on {formatBusinessDate(run.businessDate)}
                            </span>
                          </button>
                        </form>
                      ) : (
                        <span className="text-muted-foreground text-xs">Job no longer registered</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </div>
  )
}
