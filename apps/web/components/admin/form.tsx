'use client'

import {
  createContext,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
} from 'react'
import { IDLE_FORM_STATE, type FormState } from '@/lib/admin/form-state'
import { RecoveryCodes } from '@/components/auth/recovery-codes'

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
  /// B-108. How to render `state.details` on success. The default is a plain
  /// list; `recovery-codes` is the one case where the list is a credential the
  /// user has to keep, and it gets copy/download/print and an
  /// acknowledgement gate instead.
  detailsAs?: 'list' | 'recovery-codes'
}

export function AdminForm({ action, children, className, label, detailsAs = 'list' }: AdminFormProps) {
  const summaryRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const submitted = useRef<FormData | null>(null)

  // B-124. Keep what was typed when the action comes back with an error.
  //
  // React 19 RESETS a form once its action completes — nothing in this codebase
  // clears the fields, the framework does. That is right after a success and
  // wrong after a failure: the step re-renders empty, so the lease step's e-sign
  // consent tick and typed signature vanished and the next press was refused
  // with "Tick the box to agree to sign electronically" for a box the renter had
  // ticked, on the last screen before payment. WCAG 3.3.3 is not met by an error
  // that names a field the form has just emptied.
  //
  // Done here, at the form, rather than in `Field`: the protection step's radios
  // are raw <input>s inside a FieldSet, and a fix that only knew about `Field`
  // would leave them — and every future raw control — still clearing. One place,
  // every control, no change to any of the 156 actions that return `fieldError`.
  const rememberSubmission = useCallback(
    async (state: FormState, formData: FormData) => {
      submitted.current = formData
      return action(state, formData)
    },
    [action],
  )

  const [state, formAction] = useActionState(rememberSubmission, IDLE_FORM_STATE)

  useEffect(() => {
    // Focus the summary on failure so the user hears the count and can reach
    // each field, rather than being left at the submit button with no idea
    // anything went wrong. Runs on error only — stealing focus after a success
    // would interrupt the announcement below.
    if (state.status === 'error' || state.status === 'confirm') summaryRef.current?.focus()
  }, [state])

  useEffect(() => {
    // Only on the branches that keep the user on this form. A success is
    // allowed to clear — "add a note" then leaving the note behind is the bug,
    // not the reset.
    if (state.status !== 'error' && state.status !== 'confirm') return
    const form = formRef.current
    const data = submitted.current
    if (!form || !data) return

    for (const element of Array.from(form.elements)) {
      const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      if (!control.name) continue
      const type = 'type' in control ? control.type : ''
      // Never a password — restoring one would put a credential back into the
      // DOM after the framework had cleared it, which is the opposite of a
      // favour. `hidden` is rendered from server props and never lost; `file`
      // cannot be set programmatically at all.
      if (type === 'password' || type === 'hidden' || type === 'file') continue
      // Buttons are in `form.elements` too, and the confirm-and-echo step's
      // button is a NAMED one carrying `confirmed=yes`. Writing a submitted
      // value into it — there is none, so the empty string — is how a
      // restore-what-was-typed pass would quietly disarm the control that
      // publishes an append-only tax row.
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') continue

      const values = data.getAll(control.name).map(String)
      if (type === 'checkbox' || type === 'radio') {
        ;(control as HTMLInputElement).checked = values.includes(control.value)
      } else {
        control.value = values[0] ?? ''
      }
    }
  }, [state])

  return (
    <FormStateContext.Provider value={state}>
      <form ref={formRef} action={formAction} className={className} aria-label={label}>
        {/* Rendered unconditionally and empty, then written into. A live region
            inserted into the DOM already populated is unreliably announced by
            VoiceOver and routinely missed by NVDA — the region has to pre-exist
            the event it reports (FR-20).

            It carried `empty:hidden` until B-111, which is `display:none`, which
            takes the element out of the accessibility tree right up until the
            moment it has text — the same "region that appears with the event"
            failure, moved from "not in the DOM" to "in the DOM but not exposed",
            and defeating the sentence above it in every form in the product.
            `gate-code-panel.tsx` diagnosed this in B-105 and named this file;
            nothing changed it. An empty <p> has no visible footprint, so the
            class bought nothing. */}
        <p role="status" className="col-span-full text-sm font-medium text-green-700">
          {state.status === 'success' ? state.message : ''}
        </p>

        {/* Outside the live region on purpose. A list the user has to read,
            copy or print — recovery codes are the case this exists for — must
            be reachable and selectable at leisure, not announced once as a
            single run-on utterance and then left behind by the focus.
            
            B-108 gave that case its own component: reading the codes was never
            the hard part, KEEPING them was, and a bare <ul> offers no way to.
            `detailsAs` opts a form in rather than changing every form that
            returns details — most of them are showing a summary nobody needs
            to save. */}
        {state.status === 'success' && state.details && state.details.length > 0 && (
          detailsAs === 'recovery-codes' ? (
            <RecoveryCodes codes={state.details} />
          ) : (
            <ul className="border-input col-span-full mt-2 grid gap-1 rounded-md border p-3 font-mono text-sm">
              {state.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )
        )}

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
  /// A node rather than a string, because a checkbox or radio label is often a
  /// sentence with emphasis in it — a consent disclosure, a plan and its price.
  label: React.ReactNode
  hint?: string
  className?: string
  as?: 'input' | 'select' | 'checkbox' | 'radio'
  children?: React.ReactNode
} & React.InputHTMLAttributes<HTMLInputElement> &
  React.SelectHTMLAttributes<HTMLSelectElement>) {
  const state = useContext(FormStateContext)
  const id = useId()
  const error = state.status === 'error' ? state.fieldErrors[name] : undefined
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ')

  // A checkbox is a box, not a text input: CONTROL_CLASS's height, border and
  // padding would stretch it into something that looks like an empty field.
  const choice = as === 'checkbox' || as === 'radio'
  const shared = {
    id,
    name,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    className: choice ? 'mt-1' : CONTROL_CLASS,
    ...control,
  }

  const messages = (
    <>
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
    </>
  )

  // Label after the control, and the two in one row. Everything else here puts
  // the label first, which is right for a text input and wrong for a box.
  if (choice) {
    return (
      <div className={className ?? 'text-sm'}>
        <label htmlFor={id} className="flex items-start gap-2">
          <input type={as} {...shared} />
          <span>{label}</span>
        </label>
        {messages}
      </div>
    )
  }

  return (
    <div className={className ?? 'flex flex-col gap-1 text-sm'}>
      <label htmlFor={id}>{label}</label>
      {as === 'select' ? <select {...shared}>{children}</select> : <input {...shared} />}
      {messages}
    </div>
  )
}

/// A set of radios or checkboxes that answer one question, with the error on
/// the group rather than on any one control.
///
/// "Choose a protection plan" is a fact about the whole set — there is no
/// single radio it belongs to, and putting it on the first one tells a
/// control-by-control navigator who happens to land on the third one nothing at
/// all. `aria-invalid` and `aria-describedby` are global attributes, so a
/// `<fieldset>` (role `group`) carries both.
///
/// `name` is the key the ACTION reports the error under, which is not always
/// the `name` on the inputs — the protection step's radios are `tier` and its
/// error is `protection`.
export function FieldSet({
  name,
  legend,
  hint,
  className,
  children,
}: {
  name: string
  legend: React.ReactNode
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  const state = useContext(FormStateContext)
  const id = useId()
  const error = state.status === 'error' ? state.fieldErrors[name] : undefined
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ')

  return (
    <fieldset
      className={className}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
    >
      <legend className="font-medium">{legend}</legend>
      {/* Above the options, not below them: a sighted user should meet the
          reason before the things they have to choose between. */}
      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground mt-1 text-sm">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
      {children}
    </fieldset>
  )
}

/// B-112. Height comes from `--control-h`, not from a fixed `h-9`.
///
/// It was `h-9` — 36px — on every form in the product, against §6.2's ≥44px
/// touch target, which is a customer-facing failure on the checkout, the portal
/// and the reservation form alike. But 44px everywhere is wrong too: an admin
/// screen is a desk, a keyboard and forty rows of settings, and the density
/// that helps a renter on a phone hurts the person who works here all day.
///
/// So: one token, two densities, set by the layout rather than threaded through
/// as a prop. The DEFAULT is the consumer size, deliberately — a new surface
/// that forgets to opt in is accessible, not the other way round. The admin
/// layout opts down. Nothing between the layout and the control has to know.
// B-116. `max-w-full`: a native `<select>` with no width set sizes itself to
// its LONGEST option's text — "Required — a plan, or proof of the tenant's own
// cover" ran the settings `protectionRequired` control out to 341px, wider
// than a 320px phone, and no `overflow-x-auto` wrapper catches a control that
// overflows its own row rather than a table. `max-width` (not `width`) is the
// half of the pair that only ever shrinks: it caps a control that would
// otherwise be too wide and leaves every fixed-width field (`w-20`, `w-28`,
// the many number and short-text inputs already sized deliberately) exactly
// as it was, because an explicit `width` always wins over a wider `max-width`.
// Chromium truncates the closed control's displayed text with an ellipsis
// when its content exceeds this cap; the dropdown's own option list is
// unaffected and still shows the full text.
export const CONTROL_CLASS =
  'border-input bg-background h-(--control-h,2.75rem) max-w-full rounded-md border px-2'
