import Link from 'next/link'
import { taskTypeSpec } from '@storage/core/tasks'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { facilityTasks, taskRollup, type FacilityRollup as TaskRollupRow } from '@/lib/admin/tasks'
import { FacilityRollup } from '@/components/admin/facility-rollup'
import { AnnounceRegion } from '@/components/admin/announce'
import { TaskCompleteForm } from '@/components/admin/task-complete-form'

export const metadata = { title: 'Tasks' }

/// B-113 made the roll-up one shared component, since the dashboard, Units,
/// Delinquency and Inquiries all needed the shape this screen arrived at first.
/// This maps the task counts into it.
function rollupRows(rows: TaskRollupRow[]) {
  return rows.map((row) => ({
    facilityId: row.facilityId,
    facilityName: row.facilityName,
    href: `/admin/tasks?facility=${row.facilityId}`,
    // B-229. A failed nightly job is called out by name rather than folded into
    // "open": a site that has stopped invoicing looks exactly like a busy site
    // once the count is a single number.
    summary: [
      `${row.openCount} open`,
      row.overdueCount > 0 ? `${row.overdueCount} overdue` : '',
      row.jobFailureCount > 0
        ? `${row.jobFailureCount} nightly job failure${row.jobFailureCount === 1 ? '' : 's'}`
        : '',
    ]
      .filter(Boolean)
      .join(' · '),
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
        // B-115, UX review 2026-08-12 finding 9: the catalog label, never the
        // raw `Task.type` key — B-109's rule that admin may use industry
        // vocabulary, it may not render enum identifiers.
        <p className="text-muted-foreground text-sm">
          Filtered to &ldquo;{taskTypeSpec(typeParam)?.label ?? typeParam}&rdquo;.{' '}
          <Link href={`/admin/tasks?facility=${selected.facility.id}`} className="underline underline-offset-2">
            Show every open task
          </Link>
          .
        </p>
      )}

      {rollup.length > 1 && (
        <FacilityRollup heading="Across your facilities" rows={rollupRows(rollup)} />
      )}

      {/* B-170. The completion message lives HERE, above the list, because
          completing a task removes the card that would otherwise have carried
          it — and with it the live region and the focus. */}
      <AnnounceRegion>
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
                  {/* B-115, UX review 2026-08-12 finding 9: what this task is
                      ABOUT, not the raw `entityType`. Linked where there is
                      somewhere to go; named honestly where there is not. */}
                  <p className="text-sm">
                    {task.subject.href ? (
                      <Link href={task.subject.href} className="underline underline-offset-2">
                        {task.subject.label}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{task.subject.label}</span>
                    )}
                  </p>
                  {/* B-169. Why THIS task exists, when its type cannot say —
                      "the contents were sold at auction" under a card whose
                      label is only "take the overlock off". */}
                  {task.detail && (
                    <p className="text-sm text-pretty">{task.detail}</p>
                  )}
                  <p className="text-muted-foreground text-sm">
                    {formatDate(task.businessDate)}
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

              {/* B-166. A task whose truth is a record's state is not
                  closeable by typing — the card says what closes it and sends
                  the reader there, rather than offering a note box that
                  `completeTask` would refuse. */}
              {task.resolvedByAction ? (
                <p className="text-muted-foreground mt-3 text-sm text-pretty">
                  {task.resolvedByAction.sentence}{' '}
                  <Link
                    href={task.resolvedByAction.href}
                    className="underline underline-offset-2"
                    aria-label={`${task.resolvedByAction.linkLabel} for ${task.subject.label}`}
                  >
                    {task.resolvedByAction.linkLabel}
                  </Link>
                  .
                </p>
              ) : (
                <TaskCompleteForm
                  taskId={task.id}
                  subjectLabel={`${task.label}, ${task.subject.label}`}
                  notePlaceholder="What did you do?"
                  buttonLabel="Complete"
                  requiredProofFields={task.requiredProofFields}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      </AnnounceRegion>
    </div>
  )
}

