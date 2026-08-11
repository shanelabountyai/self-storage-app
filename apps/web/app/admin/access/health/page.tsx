import Link from 'next/link'
import { AdminForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getAdminActor } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { concernsFor, gateHealth, type FacilityGateHealth } from '@/lib/admin/gate-health'
import { reconcileNowAction } from './actions'

export const metadata = { title: 'Gate health' }

// PRD 03 §8 Phase 2 (B-080). Per-facility adapter health.
//
// Ordered worst-first rather than alphabetically. A portfolio screen sorted by
// name is one somebody scans top to bottom looking for red, and the whole value
// of this page is that they should not have to.

const ADAPTER_LABELS: Record<string, string> = {
  simulated: 'Simulated controller',
  manual: 'Manual (keypad by hand)',
  pti_cloud: 'PTI Cloud (vendor emulation)',
}

function ago(at: Date | null): string {
  if (!at) return 'never'
  const hours = Math.floor((Date.now() - at.getTime()) / 3_600_000)
  if (hours < 1) return 'within the hour'
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(value)
}

/// Urgent first, then anything with a concern, then the quiet ones.
function worstFirst(a: FacilityGateHealth, b: FacilityGateHealth): number {
  const rank = (row: FacilityGateHealth) => {
    const concerns = concernsFor(row)
    if (concerns.some((concern) => concern.level === 'urgent')) return 0
    if (concerns.length > 0) return 1
    return 2
  }
  return rank(a) - rank(b) || a.facilityName.localeCompare(b.facilityName)
}

export default async function GateHealthPage() {
  const actor = await getAdminActor()

  if (!hasPermissionAnywhere(actor, ['access:events'])) {
    return (
      <p className="text-muted-foreground text-sm">
        You do not have permission to see gate activity.
      </p>
    )
  }

  const rows = (await gateHealth(actor)).sort(worstFirst)

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Gate health</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          The four ways a gate integration fails quietly: commands piling up, commands that gave up
          retrying, a webhook feed that has gone silent, and the controller drifting out of step with
          our records. Sites needing attention are listed first.
        </p>
        <p className="text-sm">
          <Link href="/admin/access" className="underline underline-offset-2">
            Gate activity log
          </Link>
        </p>
      </header>

      {rows.length === 0 && (
        <p className="text-muted-foreground text-sm">No facilities are assigned to you.</p>
      )}

      {rows.map((row) => {
        const concerns = concernsFor(row)
        const urgent = concerns.some((concern) => concern.level === 'urgent')

        return (
          <section
            key={row.facilityId}
            aria-labelledby={`facility-${row.facilityId}`}
            className={`flex flex-col gap-3 rounded-lg border p-4 ${urgent ? 'border-red-300' : 'border-input'}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`facility-${row.facilityId}`} className="text-base font-medium">
                {row.facilityName}
              </h2>
              <span className="text-muted-foreground text-xs">
                {ADAPTER_LABELS[row.adapter] ?? row.adapter}
              </span>
            </div>

            {concerns.length === 0 ? (
              <p className="text-sm text-green-700">
                Nothing outstanding. Last reconciled {row.reconciliation ? formatDate(row.reconciliation.businessDate) : 'never'}.
              </p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {concerns.map((concern) => (
                  <li
                    key={concern.message}
                    className={concern.level === 'urgent' ? 'font-medium text-red-700' : 'text-amber-700'}
                  >
                    {concern.message}
                  </li>
                ))}
              </ul>
            )}

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground text-xs">Commands waiting</dt>
                <dd>{row.commands.pending + row.commands.failed}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Gave up</dt>
                <dd className={row.commands.deadLettered > 0 ? 'font-medium text-red-700' : ''}>
                  {row.commands.deadLettered}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">On a person</dt>
                <dd>{row.commands.awaitingManual}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Last send</dt>
                <dd>{ago(row.commands.lastSucceededAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Gate events (24h)</dt>
                <dd>{row.events.last24h}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Last event</dt>
                <dd>{ago(row.events.lastEventAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Drift</dt>
                <dd>
                  {!row.reconciliation
                    ? '—'
                    : !row.reconciliation.verifiable
                      ? 'not verifiable'
                      : `${row.reconciliation.driftCount} of ${row.reconciliation.credentialsChecked}`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Webhook secret</dt>
                <dd>
                  {row.webhookSecret.unavailable
                    ? 'no key configured'
                    : row.webhookSecret.configured
                      ? row.webhookSecret.retiring.length > 0
                        ? `rotating (${row.webhookSecret.retiring.length} still accepted)`
                        : 'site-specific'
                      : 'shared/default'}
                </dd>
              </div>
            </dl>

            {row.simulated && (row.simulated.offline || row.simulated.latencyMs > 0 || row.simulated.webhookFailing) && (
              <p className="text-muted-foreground text-xs">
                Fault injection is on:{' '}
                {[
                  row.simulated.offline && 'controller offline',
                  row.simulated.latencyMs > 0 && `${row.simulated.latencyMs}ms latency`,
                  row.simulated.webhookFailing && 'webhooks failing',
                ]
                  .filter(Boolean)
                  .join(', ')}
                .
              </p>
            )}

            <AdminForm
              action={reconcileNowAction}
              label={`Reconcile ${row.facilityName} against its controller now`}
              className="flex flex-col gap-2"
            >
              <input type="hidden" name="facilityId" value={row.facilityId} />
              <div>
                <Button type="submit" variant="outline">
                  Reconcile now
                </Button>
              </div>
            </AdminForm>
          </section>
        )
      })}
    </div>
  )
}
