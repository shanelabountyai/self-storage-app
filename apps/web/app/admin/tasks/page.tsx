import Link from 'next/link'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { facilityTasks, taskRollup } from '@/lib/admin/tasks'
import { FacilityRollup } from '@/components/admin/facility-rollup'
import { completeTaskAction } from './actions'

export const metadata = { title: 'Tasks' }

/// B-113 made the roll-up one shared component, since the dashboard, Units,
/// Delinquency and Inquiries all needed the shape this screen arrived at first.
/// This maps the task counts into it.
function rollupRows(
  rows: { facilityId: string; facilityName: string; openCount: number; overdueCount: number }[],
) {
  return rows.map((row) => ({
    facilityId: row.facilityId,
    facilityName: row.facilityName,
    href: `/admin/tasks?facility=${row.facilityId}`,
    summary: `${row.openCount} open${row.overdueCount > 0 ? ` · ${row.overdueCount} overdue` : ''}`,
  }))
}

// PRD 02 §4.9 US-41 (B-095). "My day": one facility's open tasks, oldest
// business day first. Mobile-first — a single column of cards, not a wide
// table, because this is the screen someone checks from a phone on the floor.

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string; type?: string }>
}) {
  const { facility: facilityParam, type: typeParam } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  // The roll-up below links to a single facility's list without changing the
  // switcher's persistent choice — a regional manager peeking at one
  // facility's tasks should not have to remember to switch back.
  const requested = facilityParam ? facilities.find((f) => f.id === facilityParam) : undefined
  const selected = requested
    ? { mode: 'single' as const, facility: requested }
    : resolveSelectedFacility(cookieValue, facilities, canSeeAll)
  const rollup = await taskRollup(actor)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Tasks</h1>
        <p className="text-muted-foreground text-sm">Choose a single facility in the switcher above for its list.</p>
        <FacilityRollup heading="Across your facilities" rows={rollupRows(rollup)} />
      </div>
    )
  }

  const tasks = await facilityTasks(actor, selected.facility.id, { type: typeParam })

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Tasks — {selected.facility.name}</h1>

      {typeParam && (
        <p className="text-muted-foreground text-sm">
          Filtered to &ldquo;{typeParam}&rdquo;.{' '}
          <Link href={`/admin/tasks?facility=${selected.facility.id}`} className="underline underline-offset-2">
            Show every open task
          </Link>
          .
        </p>
      )}

      {rollup.length > 1 && (
        <FacilityRollup heading="Across your facilities" rows={rollupRows(rollup)} />
      )}

      {tasks.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {typeParam ? 'None open of this type right now.' : 'Nothing open right now.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((task) => (
            <li key={task.id} className="border-input rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{task.label}</p>
                  <p className="text-muted-foreground text-sm">
                    {task.entityType} · {formatDate(task.businessDate)}
                    {task.priority === 'high' && <span className="font-medium"> · High priority</span>}
                  </p>
                </div>
                {/* 1.4.1: never colour alone — "Overdue" is text, not just a
                    red border. */}
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
                  Resolution note
                </label>
                <input
                  id={`note-${task.id}`}
                  name="note"
                  placeholder="What did you do?"
                  className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-2 text-sm"
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
                      className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-2 text-sm"
                    />
                  </>
                )}
                <button
                  type="submit"
                  className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                >
                  Complete
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

