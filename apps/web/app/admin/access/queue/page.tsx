import Link from 'next/link'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { manualQueue } from '@/lib/access/manual-queue'
import { TaskCompleteForm } from '@/components/admin/task-complete-form'

export const metadata = { title: 'Keypad queue' }

// PRD 03 US-6 (B-065). The list a manager works from when there is no
// controller to talk to.
//
// Every row is a `Task` (US-41: one task entity, every queue reads it) joined
// back to the `GateCommand` that raised it. The instruction is derived here
// rather than stored, so rewording one improves every open task instead of
// only the next one.

function formatWhen(at: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(at)
}

export default async function KeypadQueuePage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above — a keypad queue is a per-site list.
      </p>
    )
  }

  const { items, slaHours, adapter } = await manualQueue(actor, selected.facility.id)
  const overdue = items.filter((item) => item.overdue)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Keypad queue — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Access changes this site has to key in by hand. Each one is a real change the system has
          already made on its records — the keypad is the only part that has not caught up.
        </p>
      </div>

      {adapter !== 'manual' && (
        <p role="note" className="border-input rounded-lg border p-4 text-sm text-pretty">
          This facility is set to the integrated controller, so nothing new will arrive here.
          Anything below was raised while it was on manual and is still outstanding. The setting
          lives under{' '}
          <Link href="/admin/settings" className="underline underline-offset-2">
            facility settings
          </Link>
          .
        </p>
      )}

      {overdue.length > 0 && (
        // US-6 AC2's escalation. A heading that says the number, not a colour —
        // WCAG 1.4.1, and also the thing a manager reads from across the room.
        <p role="alert" className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-red-950">
          <span className="font-semibold">
            {overdue.length} overdue — more than {slaHours} business{' '}
            {slaHours === 1 ? 'hour' : 'hours'} old
          </span>
          <span className="mt-1 block text-sm text-pretty">
            Counted against this facility&apos;s office hours, so a change raised after closing is
            not late until somebody has had a chance to do it.
          </span>
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.taskId}
            className={
              item.overdue
                ? 'rounded-lg border-2 border-red-500 p-4'
                : 'border-input rounded-lg border p-4'
            }
          >
            <p className="font-medium text-pretty">{item.instruction.action}</p>

            {item.instruction.code && (
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">Code: </span>
                <span className="font-mono text-base tracking-widest">{item.instruction.code}</span>
              </p>
            )}

            <p className="text-muted-foreground mt-2 text-sm text-pretty">
              {item.instruction.reason}
            </p>

            <p className="text-muted-foreground mt-2 text-xs">
              Raised {formatWhen(item.createdAt)}
              {item.overdue && <span className="font-medium"> · overdue</span>}
              {item.assigneeName && ` · ${item.assigneeName}`}
            </p>

            <TaskCompleteForm
              taskId={item.taskId}
              subjectLabel={item.instruction.action}
              notePlaceholder="Keyed in at the north gate panel"
              buttonLabel="Done at the keypad"
            />
          </li>
        ))}

        {items.length === 0 && (
          <li className="text-muted-foreground text-sm">
            Nothing waiting. Every access change at this site has reached the keypad.
          </li>
        )}
      </ul>
    </div>
  )
}
