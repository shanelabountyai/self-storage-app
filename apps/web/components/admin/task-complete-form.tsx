'use client'

import { AdminForm, Field } from '@/components/admin/form'
import { completeTaskAction } from '@/app/admin/tasks/actions'

// PRD 02 §4.9 US-41, §5.5 FR-19/FR-20/FR-22 (B-141). One component because the
// four task queues (`/admin/tasks`, delinquency, access queue, walkthrough)
// share one action and had the same gap: a refusal that never reached the
// screen, and every card's button carrying the identical accessible name
// "Complete" (or "Done at the keypad", or "Walked") with nothing naming which
// card it belonged to. `AdminForm` gives the live region and the focused error
// summary for free — one instance per card, since each card's completion is
// its own independent submission.
export function TaskCompleteForm({
  taskId,
  subjectLabel,
  notePlaceholder,
  buttonLabel,
  requiresPhoto = false,
}: {
  taskId: string
  /// What this card is about, in a form that reads on its own — "Returned
  /// mail review, Ada Renter — unit 104". Composed into the button's
  /// `aria-label` so a rotor listing the page's buttons hears each one once,
  /// not "Complete" repeated per row (2.4.6, 4.1.3).
  subjectLabel: string
  notePlaceholder: string
  buttonLabel: string
  requiresPhoto?: boolean
}) {
  return (
    <AdminForm
      action={completeTaskAction}
      label={`Complete: ${subjectLabel}`}
      className="mt-3 flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="taskId" value={taskId} />
      <Field
        name="note"
        label={<span className="sr-only">What did you do?</span>}
        placeholder={notePlaceholder}
        required
        className="flex min-w-0 flex-1 flex-col gap-1 text-sm"
      />
      {requiresPhoto && (
        <Field
          name="photo_reference"
          label={<span className="sr-only">Photo reference</span>}
          placeholder="Photo reference"
          required
          className="flex min-w-0 flex-1 flex-col gap-1 text-sm"
        />
      )}
      <button
        type="submit"
        aria-label={`${buttonLabel}: ${subjectLabel}`}
        className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
      >
        {buttonLabel}
      </button>
    </AdminForm>
  )
}
