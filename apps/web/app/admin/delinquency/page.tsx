import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { delinquencyQueue } from '@/lib/admin/delinquency-queue'
import { completeTaskAction } from '@/app/admin/tasks/actions'

export const metadata = { title: 'Delinquency queue' }

// PRD 02 §4.6 US-26 (B-059). "Today's due steps grouped by type (overlocks to
// apply/remove, notices to mail, proofs to record), so nothing is missed."
//
// Every row is a `Task` (US-41) — this is a filtered, grouped view of the same
// list `/admin/tasks` renders, not a table of its own.

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

export default async function DelinquencyQueuePage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()

  if (!hasPermissionAnywhere(actor, ['delinquency:execute_step'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to this.</p>
  }

  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)
  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a single facility above — the delinquency queue is per-site.
      </p>
    )
  }

  const groups = await delinquencyQueue(actor, selected.facility.id)
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
                      <p className="text-muted-foreground text-sm">
                        {task.entityType} · Due {formatDate(task.businessDate)}
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

                  <form action={completeTaskAction} className="mt-3 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="taskId" value={task.id} />
                    <label htmlFor={`note-${task.id}`} className="sr-only">
                      What did you do?
                    </label>
                    <input
                      id={`note-${task.id}`}
                      name="note"
                      required
                      placeholder="What did you do?"
                      className="border-input bg-background min-h-11 min-w-0 flex-1 rounded-md border px-3 text-sm"
                    />
                    {task.requiredProofFields.includes('photo_reference') && (
                      <>
                        <label htmlFor={`photo-${task.id}`} className="sr-only">
                          Photo reference
                        </label>
                        <input
                          id={`photo-${task.id}`}
                          name="photo_reference"
                          required
                          placeholder="Photo reference"
                          className="border-input bg-background min-h-11 min-w-0 flex-1 rounded-md border px-3 text-sm"
                        />
                      </>
                    )}
                    <button
                      type="submit"
                      className="border-input hover:bg-accent min-h-11 inline-flex items-center rounded-md border px-4 text-sm font-medium"
                    >
                      Complete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
