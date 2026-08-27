import Link from 'next/link'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { delinquencyQueue } from '@/lib/admin/delinquency-queue'
import { haltedLeases } from '@/lib/admin/plans-holds-report'
import { moneyOwedRollup } from '@/lib/admin/rollups'
import { FacilityRollup } from '@/components/admin/facility-rollup'
import { AnnounceRegion } from '@/components/admin/announce'
import { TaskCompleteForm } from '@/components/admin/task-complete-form'
import { formatCents } from '@/lib/format'

export const metadata = { title: 'Delinquency queue' }

// PRD 02 §4.6 US-26 (B-059). "Today's due steps grouped by type (overlocks to
// apply/remove, notices to mail, proofs to record), so nothing is missed."
//
// Every row is a `Task` (US-41) — this is a filtered, grouped view of the same
// list `/admin/tasks` renders, not a table of its own.
//
// B-195: and the leases that are NOT here. The engine halts a lease under a
// `halt_dunning` hold, which correctly stops the steps and — until this row —
// also removed the lease from the only screen that exists to show it. An
// account with collections switched off is not the same as an account with
// nothing to do, and the difference was visible from nowhere.

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

export default async function DelinquencyQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string }>
}) {
  const { facility: facilityParam } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()

  if (!hasPermissionAnywhere(actor, ['delinquency:execute_step'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to this.</p>
  }

  // B-113: the roll-up links into one facility without changing the switcher's
  // persistent choice — the convention `/admin/tasks` set in B-095.
  const requested = facilityParam ? facilities.find((f) => f.id === facilityParam) : undefined
  const selected = requested
    ? { mode: 'single' as const, facility: requested }
    : resolveSelectedFacility(cookieValue, facilities, canSeeAll)
  if (selected.mode !== 'single') {
    // The QUEUE is per-site — a step is executed at one facility — but the
    // money is not, and an owner asking "who is not paying" on their own
    // default context deserves an answer rather than an instruction.
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <h1 className="text-lg font-semibold">Delinquency</h1>
        <FacilityRollup heading="Money owed, by facility" rows={await moneyOwedRollup(actor)} />
        <p className="text-muted-foreground text-sm">
          Open a facility for the steps due there today — an overlock or a notice is executed at
          one site.
        </p>
      </div>
    )
  }

  const [groups, halted] = await Promise.all([
    delinquencyQueue(actor, selected.facility.id),
    haltedLeases([selected.facility.id]),
  ])
  const overdueCount = groups.reduce((sum, group) => sum + group.tasks.filter((t) => t.overdue).length, 0)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Delinquency queue — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Today&apos;s steps from every active timeline, grouped by what they need done.
        </p>
      </div>

      {overdueCount > 0 && (
        // FR-23: never colour alone — the count is text, read from across a
        // room or by a screen reader either way.
        <p role="alert" className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-red-950">
          <span className="font-semibold">{overdueCount} overdue</span>
          <span className="mt-1 block text-sm text-pretty">
            Still open from a day that has already passed.
          </span>
        </p>
      )}

      {/* B-170. Above the groups, because completing a step removes the card
          that would otherwise have carried the message and the focus. */}
      <AnnounceRegion>
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing due right now.</p>
      ) : (
        groups.map((group) => (
          <section key={group.type} aria-labelledby={`group-${group.type}`} className="flex flex-col gap-3">
            <h2 id={`group-${group.type}`} className="text-sm font-medium">
              {group.heading} ({group.tasks.length})
            </h2>
            <ul className="flex flex-col gap-3">
              {group.tasks.map((task) => (
                <li
                  key={task.id}
                  className={task.overdue ? 'rounded-lg border-2 border-red-500 p-4' : 'border-input rounded-lg border p-4'}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{task.label}</p>
                      {/* B-115, UX review 2026-08-12 finding 9: who this step
                          is for, linked to their profile. */}
                      <p className="text-sm">
                        {task.subject.href ? (
                          <Link href={task.subject.href} className="underline underline-offset-2">
                            {task.subject.label}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{task.subject.label}</span>
                        )}
                      </p>
                      {/* The figure this queue exists for, from the metrics
                          module (D-25) — never zeroed and never colour alone
                          (1.4.1): the word "past due" carries the fact, the
                          amber only underlines it. */}
                      {task.balanceCents > 0 && (
                        <p className="text-sm">
                          <span className="font-medium tabular-nums">{formatCents(task.balanceCents)}</span>
                          {task.daysPastDue > 0 && (
                            <span className="text-amber-800"> — {task.daysPastDue} days past due</span>
                          )}
                        </p>
                      )}
                      <p className="text-muted-foreground text-sm">
                        Due {formatDate(task.businessDate)}
                        {task.priority === 'high' && <span className="font-medium"> · High priority</span>}
                      </p>
                    </div>
                    {task.overdue && (
                      <span className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-900">
                        Overdue
                      </span>
                    )}
                  </div>

                  <p className="text-muted-foreground mt-1 text-sm">
                    {task.assigneeName ? `Assigned to ${task.assigneeName}` : 'Unassigned'}
                  </p>

                  <TaskCompleteForm
                    taskId={task.id}
                    subjectLabel={`${task.label}, ${task.subject.label}`}
                    notePlaceholder="What did you do?"
                    buttonLabel="Complete"
                    requiredProofFields={task.requiredProofFields}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      </AnnounceRegion>

      {halted.length > 0 && (
        <section aria-labelledby="halted-heading" className="flex flex-col gap-3">
          <h2 id="halted-heading" className="text-sm font-medium">
            Halted — no steps will be raised ({halted.length})
          </h2>
          <p className="text-muted-foreground max-w-prose text-sm text-pretty">
            These leases are under a hold that stops collections, so the ladder raises nothing for
            them and they are not in the list above. Longest halted first.
          </p>
          {/* No money here, deliberately. This queue is gated on
              `delinquency:execute_step` and a balance is `reports:financial`
              (B-055) — a counter agent working the steps needs to know an
              account is halted and why, not what it owes. The figures are on
              the plans & holds report, behind that key. */}
          <ul className="flex flex-col gap-2">
            {halted.map((lease) => (
              <li key={lease.leaseId} className="border-input rounded-lg border p-3 text-sm">
                <Link
                  href={`/admin/tenants/${lease.tenantId}`}
                  className="font-medium underline underline-offset-2"
                >
                  {lease.tenantName}
                </Link>{' '}
                · Unit {lease.unitNumber}
                <span className="text-muted-foreground block text-xs">
                  {lease.holdLabels.join(', ')} · {lease.daysHalted} day
                  {lease.daysHalted === 1 ? '' : 's'}
                  {lease.plan
                    ? lease.plan.status === 'active'
                      ? ' · on a live payment plan'
                      : ` · payment plan ${lease.plan.status}`
                    : ' · no payment plan'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
