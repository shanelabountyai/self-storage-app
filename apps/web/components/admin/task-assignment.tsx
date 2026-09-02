'use client'

import { AdminForm } from '@/components/admin/form'
import { assignTaskAction } from '@/app/admin/tasks/actions'

// PRD 02 §4.9 US-41 (B-233). Who holds this task, and the one control that
// changes it.
//
// Both queues rendered `Assigned to X` / `Unassigned` as static text for a
// column nothing could write, so "my day" was the facility's day: two staff on
// a Saturday work one undifferentiated list and either cut the same lock twice
// or both skip it. The sentence and the button ship as ONE component for the
// same reason `TaskCompleteForm` is one — two queues, one behaviour, and the
// sentence has to agree with the button about who "you" is.
//
// Claiming only. A manager reassigning to a named third person is deliberately
// out of B-233: claiming is the 90% case and needs no picker, and a picker is a
// second permission question rather than a second control.
export function TaskAssignment({
  taskId,
  subjectLabel,
  assigneeName,
  assigneeStaffId,
  viewerStaffId,
}: {
  taskId: string
  /// What this card is about, reading on its own — composed into the button's
  /// accessible name so a rotor hears "Take this: Overlock to apply, Ada Renter
  /// — unit 104" rather than "Take this" once per card (2.4.6, 4.1.3). Same
  /// string `TaskCompleteForm` is given.
  subjectLabel: string
  assigneeName: string | null
  assigneeStaffId: string | null
  viewerStaffId: string
}) {
  const mine = assigneeStaffId !== null && assigneeStaffId === viewerStaffId
  const intent = mine ? 'give_back' : 'take'
  const label = mine ? 'Give back' : 'Take this'

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-muted-foreground text-sm">
        {/* "you", not the reader's own name read back at them — the whole point
            of the line is whether this one is theirs. */}
        {mine ? 'Assigned to you' : assigneeName ? `Assigned to ${assigneeName}` : 'Unassigned'}
      </p>

      {/* Somebody else holds it: no control. Taking it off them is the
          reassignment case this row leaves to a later one, and a button that
          silently overwrote a colleague would be worse than no button. */}
      {(mine || assigneeStaffId === null) && (
        <AdminForm
          action={assignTaskAction}
          label={`${label}: ${subjectLabel}`}
          announceOutside
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="intent" value={intent} />
          <input type="hidden" name="subjectLabel" value={subjectLabel} />
          <button
            type="submit"
            aria-label={`${label}: ${subjectLabel}`}
            className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium"
          >
            {label}
          </button>
        </AdminForm>
      )}
    </div>
  )
}
