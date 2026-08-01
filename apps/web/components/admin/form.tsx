'use client'

import { createContext, useActionState, useContext, useEffect, useId, useRef } from 'react'
import { IDLE_FORM_STATE, type FormState } from '@/lib/admin/form-state'

// PRD 02 FR-19/FR-20. The one place admin forms get their error and success
// behaviour, so every later form (B-021, B-038, B-039, B-048) inherits it
// rather than each inventing a different half of it.

const FormStateContext = createContext<FormState>(IDLE_FORM_STATE)

type AdminFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>
  children: React.ReactNode
  className?: string
  /// Names the form for screen readers, and heads the error summary.
  label: string
}

export function AdminForm({ action, children, className, label }: AdminFormProps) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE)
  const summaryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Focus the summary on failure so the user hears the count and can reach
    // each field, rather than being left at the submit button with no idea
    // anything went wrong. Runs on error only — stealing focus after a success
    // would interrupt the announcement below.
    if (state.status === 'error' || state.status === 'confirm') summaryRef.current?.focus()
  }, [state])

  return (
    <FormStateContext.Provider value={state}>
      <form action={formAction} className={className} aria-label={label}>
        {/* Rendered unconditionally and empty, then written into. A live region
            inserted into the DOM already populated is unreliably announced by
            VoiceOver and routinely missed by NVDA — the region has to pre-exist
            the event it reports (FR-20). */}
        <p role="status" className="col-span-full text-sm font-medium text-green-700 empty:hidden">
          {state.status === 'success' ? state.message : ''}
        </p>

        {(state.status === 'error' || state.status === 'confirm') && (
          <div
            ref={summaryRef}
            tabIndex={-1}
            // `alert` for a genuine failure; a confirm step is not an error and
            // must not be announced as one.
            role={state.status === 'error' ? 'alert' : 'status'}
            className="border-input col-span-full rounded-md border p-3 text-sm"
          >
            <p className="font-medium">{state.message}</p>

            {state.status === 'error' && (
              <ul className="mt-1 list-disc pl-5">
                {Object.entries(state.fieldErrors).map(([field, message]) => (
                  <li key={field}>{message}</li>
                ))}
              </ul>
            )}

            {state.status === 'confirm' && (
              <>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3">
                  {state.echo.map((row) => (
                    <div key={row.label} className="contents">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="font-medium">{row.value}</dd>
                    </div>
                  ))}
                </dl>
                {/* The button that actually publishes. It carries the same form
                    data (the fields are still filled in), plus the flag the
                    action looks for. */}
                <button
                  type="submit"
                  name="confirmed"
                  value="yes"
                  className="bg-primary text-primary-foreground mt-3 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
                >
                  Yes, add it
                </button>
              </>
            )}
          </div>
        )}

        {children}
      </form>
    </FormStateContext.Provider>
  )
}

/// Wires one control to its label, its error message, and the state the action
/// returned. Use it instead of a bare <label><input/></label> so a field cannot
/// ship without `aria-invalid`/`aria-describedby` by omission.
///
/// Props-based rather than a render prop on purpose: the pages using this are
/// server components, and a function cannot be passed across that boundary.
/// Everything here is serializable; `children` is only the <option> list.
export function Field({
  name,
  label,
  hint,
  className,
  as = 'input',
  children,
  ...control
}: {
  name: string
  label: string
  hint?: string
  className?: string
  as?: 'input' | 'select'
  children?: React.ReactNode
} & React.InputHTMLAttributes<HTMLInputElement> &
  React.SelectHTMLAttributes<HTMLSelectElement>) {
  const state = useContext(FormStateContext)
  const id = useId()
  const error = state.status === 'error' ? state.fieldErrors[name] : undefined
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ')

  const shared = {
    id,
    name,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    className: CONTROL_CLASS,
    ...control,
  }

  return (
    <div className={className ?? 'flex flex-col gap-1 text-sm'}>
      <label htmlFor={id}>{label}</label>
      {as === 'select' ? <select {...shared}>{children}</select> : <input {...shared} />}
      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

export const CONTROL_CLASS = 'border-input bg-background h-9 rounded-md border px-2'
