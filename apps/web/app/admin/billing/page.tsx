import { getAdminActor } from '@/lib/admin/context'
import { recentRuns } from '@/lib/admin/billing-runs'
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

  const runs = await recentRuns(actor)
  const canRerun = hasPermissionAnywhere(actor, ['facility:settings'])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Billing runs</h1>
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        Every nightly job, per facility, for the business date it ran for. Runs happen in each
        facility&apos;s own local time, and a date missed during an outage is caught up on the next
        tick rather than skipped.
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
                  <td className="py-2">
                    <span className="font-medium">{run.jobName}</span>
                    {(run.items.length > 0 || run.lastError) && (
                      <details className="mt-1">
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
                          {run.items.map((item, index) => (
                            <li key={`${item.itemId}-${index}`}>
                              {/* 1.4.1: the outcome is a word, never a colour. */}
                              <span className="font-medium">{item.ok ? 'OK' : 'Failed'}</span> ·{' '}
                              {item.itemId}
                              {item.message ? ` — ${item.message}` : ''}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="py-2">{run.facilityName}</td>
                  <td className="py-2 tabular-nums">{formatBusinessDate(run.businessDate)}</td>
                  <td className="py-2">{STATUS_LABEL[run.status] ?? run.status}</td>
                  <td className="py-2 text-right tabular-nums">{run.itemsOk}</td>
                  <td className="py-2 text-right tabular-nums">{run.itemsFailed}</td>
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
                              {run.jobName} for {run.facilityName} on {formatBusinessDate(run.businessDate)}
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
