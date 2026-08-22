'use client'

import { useActionState } from 'react'
import { IDLE_FORM_STATE, type FormState } from '@/lib/admin/form-state'
import { FormResult } from '@/components/marketing/form-result'

// PRD 04 US-8 (B-068). "As a prospect not ready to reserve, I can request a
// quote or callback."
//
// A client component only because it needs `useActionState` to render the
// server's answer inline. Everything it submits is plain form data, so it works
// with JavaScript disabled apart from the inline confirmation — the same
// posture as the rest of the public path (B-015).

type UnitTypeOption = { id: string; label: string }

export function LeadForm({
  facilityId,
  unitTypes,
  action,
}: {
  facilityId: string
  unitTypes: readonly UnitTypeOption[]
  action: (prev: FormState, formData: FormData) => Promise<FormState>
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE)

  const errors = state.status === 'error' ? state.fieldErrors : {}

  // B-148. See `FormResult`: the region pre-exists the message it carries, and
  // focus lands on it rather than on `<body>` when the form replaces itself.
  return (
    <FormResult state={state}>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="facilityId" value={facilityId} />

        {/* US-8 AC4's honeypot. Hidden from sight AND from assistive technology —
            `aria-hidden` plus `tabIndex={-1}` keep a screen-reader user from ever
            landing on it, because a blind visitor who fills it in would be
            silently discarded. `display:none` rather than an off-screen position
            for the same reason. `autoComplete="off"` stops a password manager
            helpfully filling it. */}
        <div aria-hidden="true" style={{ display: 'none' }}>
          <label htmlFor="company">Company</label>
          <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <fieldset className="flex flex-wrap gap-4 border-0 p-0">
          <legend className="text-sm font-medium">What would you like?</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="kind" value="quote" defaultChecked className="size-4" />
            A price quote
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="kind" value="callback" className="size-4" />
            A call back
          </label>
        </fieldset>

        <Field name="name" label="Your name" required error={errors.name} autoComplete="name" />
        <Field name="email" label="Email" type="email" error={errors.email} autoComplete="email" />
        <Field
          name="phone"
          label="Phone"
          type="tel"
          error={errors.phone}
          autoComplete="tel"
          hint="Required if you would like a call back."
        />

        <label className="flex flex-col gap-1 text-sm">
          Size you are interested in
          <select
            name="unitTypeId"
            defaultValue=""
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          >
            <option value="">Not sure yet</option>
            {unitTypes.map((unitType) => (
              <option key={unitType.id} value={unitType.id}>
                {unitType.label}
              </option>
            ))}
          </select>
        </label>

        <Field name="moveInDate" label="When you would move in" type="date" error={errors.moveInDate} />

        <label className="flex flex-col gap-1 text-sm">
          Anything else?
          <textarea
            name="note"
            rows={3}
            className="border-input bg-background rounded-md border p-2 text-sm"
          />
        </label>

        {/* PRD 04 US-13 AC1: "explicit opt-in, unchecked-by-default checkbox
            with disclosure text at capture." Separate from the quote/callback
            request itself — submitting the form works whether or not this is
            checked. */}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="marketingConsent" value="yes" className="mt-1 size-4" />
          <span>
            Send me occasional emails about pricing and promotions at this facility. You can
            unsubscribe any time.
          </span>
        </label>

        <button
          type="submit"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
        >
          Send
        </button>
      </form>
    </FormResult>
  )
}

function Field({
  name,
  label,
  error,
  hint,
  ...props
}: {
  name: string
  label: string
  error?: string
  hint?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const errorId = `${name}-error`
  const hintId = `${name}-hint`
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        name={name}
        // WCAG 3.3.1: the message is tied to the field, not floating above the
        // form, so a screen reader reads it when focus lands here.
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined}
        className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
        {...props}
      />
      {hint && (
        <span id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-sm text-red-700">
          {error}
        </span>
      )}
    </label>
  )
}
