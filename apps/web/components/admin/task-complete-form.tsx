'use client'

import { PROOF_FIELD_LABELS, type ProofField } from '@storage/core/delinquency'
import { AdminForm, Field } from '@/components/admin/form'
import { completeTaskAction } from '@/app/admin/tasks/actions'

// PRD 02 §4.9 US-41, §5.5 FR-19/FR-20/FR-22/FR-24 (B-141, B-170). One component
// because the four task queues (`/admin/tasks`, delinquency, access queue,
// walkthrough) share one action and had the same gaps: a refusal that never
// reached the screen, and every card's button carrying the identical accessible
// name "Complete" (or "Done at the keypad", or "Walked") with nothing naming
// which card it belonged to.
//
// B-170 closed the third one: this rendered `note` and a conditional
// `photo_reference` and nothing else, while `PROOF_FIELDS` has four members and
// the delinquency settings screen lets an operator require any of them on any
// staff step. Both shipped certified-mail steps ask for `tracking_number` and
// `delivered_on` — so those tasks were completed with a note, and the auction
// they were evidence for was then blocked for ever by proof no screen could
// record. The fields come from the task's own gate now, one control each, from
// one label map, with no per-field boolean anywhere: a fifth proof field is a
// build error in `PROOF_FIELD_LABELS`, never a raw enum key shown to staff.
export function TaskCompleteForm({
  taskId,
  subjectLabel,
  notePlaceholder,
  buttonLabel,
  requiredProofFields,
}: {
  taskId: string
  /// What this card is about, in a form that reads on its own — "Returned
  /// mail review, Ada Renter — unit 104". Composed into the button's
  /// `aria-label` so a rotor listing the page's buttons hears each one once,
  /// not "Complete" repeated per row (2.4.6, 4.1.3) — and into the success
  /// message, which is announced from above the list after this card is gone.
  subjectLabel: string
  notePlaceholder: string
  buttonLabel: string
  /// The task's own gate, from `requiredProofFieldsFor` — the catalog's fields
  /// union the configured step's. The same list `completeTask` refuses on, so
  /// this form cannot ask for less than the task needs.
  requiredProofFields: readonly ProofField[]
}) {
  return (
    <AdminForm
      action={completeTaskAction}
      label={`Complete: ${subjectLabel}`}
      announceOutside
      className="mt-3 flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="subjectLabel" value={subjectLabel} />
      {requiredProofFields.map((field) => (
        <Field
          key={field}
          name={field}
          // A real, visible label on every one. The note's only label used to
          // be its placeholder, which disappears the moment anything is typed
          // and is unavailable to speech input entirely (3.3.2).
          label={PROOF_FIELD_LABELS[field].label}
          type={PROOF_FIELD_LABELS[field].inputType}
          {...(field === 'note' ? { placeholder: notePlaceholder } : {})}
          required
          className="flex min-w-0 flex-1 flex-col gap-1 text-sm"
        />
      ))}
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
