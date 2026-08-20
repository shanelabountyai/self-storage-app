'use client'

import { useActionState, useId } from 'react'
import { IDLE_FORM_STATE, type FormState } from '@/lib/admin/form-state'

// PRD 01 §9 Phase 3 (B-090 part 1). The notify-me form on a sold-out size.
//
// Behind a `<details>` rather than always open. There is one of these per
// sold-out unit type and a facility can have several, so rendering five
// expanded email forms under "Also here, currently full" would bury the sizes
// that CAN be rented today under a wall of inputs. Collapsed, it is one line
// per size until somebody wants it.
//
// A client component only for `useActionState`, so the answer renders inline.
// Everything it submits is plain form data: with JavaScript off the form still
// posts and the page re-renders, the same posture as the lead form.

export function WaitlistForm({
  facilityId,
  unitTypeId,
  sizeLabel,
  action,
}: {
  facilityId: string
  unitTypeId: string
  /// Spoken form — "10 foot by 20 foot" — because it lands in a label and a
  /// button name, where "10 × 20" is read as "10 times 20".
  sizeLabel: string
  action: (prev: FormState, formData: FormData) => Promise<FormState>
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE)
  const emailId = useId()
  const errorId = `${emailId}-error`

  if (state.status === 'success') {
    return (
      <p role="status" className="border-input mt-3 rounded-md border p-3 text-sm text-pretty">
        {state.message}
      </p>
    )
  }

  const error = state.status === 'error' ? state.fieldErrors.email : undefined

  return (
    <details className="mt-3">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">
        Email me when a {sizeLabel} is free
      </summary>

      <form action={formAction} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="unitTypeId" value={unitTypeId} />

        {/* Hidden from sight AND from assistive technology, same as the lead
            form's: a blind visitor who filled it in would be silently
            discarded. */}
        <div aria-hidden="true" style={{ display: 'none' }}>
          <label htmlFor={`${emailId}-company`}>Company</label>
          <input id={`${emailId}-company`} name="company" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <label htmlFor={emailId} className="text-sm">
          Your email
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          required
          autoComplete="email"
          // WCAG 3.3.1 — the message is tied to the field, so a screen reader
          // reads it when focus lands here rather than leaving it floating.
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
        />
        {error && (
          <span id={errorId} className="text-sm text-red-700">
            {error}
          </span>
        )}

        <p className="text-muted-foreground text-xs text-pretty">
          One email, about this size at this facility only. There is a link in it to take
          yourself off the list.
        </p>

        <button
          type="submit"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
        >
          Add me to the list
        </button>
      </form>
    </details>
  )
}
