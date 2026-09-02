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
import { useAnnounceOutside } from '@/components/admin/announce'

// PRD 02 FR-19/FR-20. The one place admin forms get their error and success
// behaviour, so every later form (B-021, B-038, B-039, B-048) inherits it
// rather than each inventing a different half of it.

const FormStateContext = createContext<FormState>(IDLE_FORM_STATE)

/// B-213 / WCAG 3.3.1 A, 3.3.3 AA. The id of the enclosing `FieldSet`'s error
/// message, so a `Field` inside a refused group can describe itself with it.
///
/// `aria-describedby` on the <fieldset> ITSELF reaches nobody: no shipping
/// screen reader announces a group's description when focus lands on a control
/// inside it. A description on the CONTROL always is announced, so the group's
/// message has to be handed down rather than declared once at the top.
const FieldSetErrorContext = createContext<string | null>(null)

type AdminFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>
  children: React.ReactNode
  className?: string
  /// Names the form for screen readers, and heads the error summary.
  label: string
  /// B-180. Lets submit buttons OUTSIDE the form drive it, via the native
  /// `form=` owner attribute — one email field above a table whose every row
  /// has its own "Join waitlist" button carrying that row's id. React's
  /// `createFormDataWithSubmitter` copies the submitter's name/value into the
  /// submission only when the form has an id, so this is not optional dressing.
  id?: string
  /// B-108. How to render `state.details` on success. The default is a plain
  /// list; `recovery-codes` is the one case where the list is a credential the
  /// user has to keep, and it gets copy/download/print and an
  /// acknowledgement gate instead.
  detailsAs?: 'list' | 'recovery-codes'
  /// B-170. Send the success message to the nearest `AnnounceRegion` instead of
  /// announcing it here. For the forms whose own success REMOVES them — a task
  /// leaving its queue, a promotion leaving the "scheduled" list, a returned
  /// payment leaving `profile.returnable` — where a region inside the form is
  /// unmounted in the same commit that populates it and therefore announces
  /// nothing. Opt-in, because every other form in the product stays mounted and
  /// is right to keep its message where the reader already is.
  announceOutside?: boolean
}

export function AdminForm({
  action,
  children,
  className,
  label,
  id,
  detailsAs = 'list',
  announceOutside = false,
}: AdminFormProps) {
  const announce = useAnnounceOutside()
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
      const next = await action(state, formData)
      // Pushed from HERE, not from an effect on `state`: by the time the
      // success state commits, the revalidation it triggered may already have
      // unmounted this form, and an effect that never runs announces nothing.
      // This runs while the form is still mounted, and lands in state owned by
      // a component above the list.
      if (announceOutside && announce && next.status === 'success') announce(next.message)
      return next
    },
    [action, announce, announceOutside],
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
      <form ref={formRef} id={id} action={formAction} className={className} aria-label={label}>
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
        {/* B-184 (T5) / PRD 02 §5.5 FR-25(2), 3.3.4 adds the CONFIRM branch to
            this same region rather than mounting a second one: a form can
            never be in both `success` and `confirm` at once, so one
            pre-existing `role="status"` covers both without a second locator
            match breaking every `form.getByRole('status')` in the suite. The
            bordered box below still renders the echo table and the button —
            this paragraph only owns the announcement, which is why the box's
            own role is dropped for `confirm` a few lines down: `role="alert"`
            announces fine on fresh insertion (that is what distinguishes an
            alert from a status region), but `role="status"` does not, so the
            box never got to carry both without the same "arrives already
            populated" failure FR-20 exists to avoid. */}
        <p
          role="status"
          className={
            state.status === 'confirm'
              ? 'col-span-full text-sm font-medium text-pretty'
              : 'col-span-full text-sm font-medium text-green-700'
          }
        >
          {(state.status === 'success' && !announceOutside) || state.status === 'confirm'
            ? state.message
            : ''}
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
            // `alert` for a genuine failure, which announces fine even though
            // it is inserted fresh (that is what an alert is for). A confirm
            // step is not an error and gets no live-region role here at all —
            // its text is announced by the pre-mounted paragraph above, and a
            // second `role="status"` on this box would announce the same
            // sentence twice.
            role={state.status === 'error' ? 'alert' : undefined}
            className="border-input col-span-full rounded-md border p-3 text-sm"
          >
            <p className="font-medium">{state.message}</p>

            {/* B-233. Only when there ARE field errors. A refusal with no field
                to hang it on — a task somebody else claimed first — carries its
                whole meaning in `message`, and an empty <ul> under it is
                announced as "list, 0 items" for nothing. */}
            {state.status === 'error' && Object.keys(state.fieldErrors).length > 0 && (
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
                  {state.confirmLabel ?? 'Yes, add it'}
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
  /// A node for the same reason `label` is: a hint whose whole job is to point
  /// at the setting it depends on has to be able to carry the link there.
  hint?: React.ReactNode
  className?: string
  as?: 'input' | 'select' | 'checkbox' | 'radio'
  children?: React.ReactNode
} & React.InputHTMLAttributes<HTMLInputElement> &
  React.SelectHTMLAttributes<HTMLSelectElement>) {
  const state = useContext(FormStateContext)
  const id = useId()
  const error = state.status === 'error' ? state.fieldErrors[name] : undefined
  // B-213. The enclosing group's refusal, when there is one. `validateSchedule`
  // reports "must be in date order" against the INSTALLMENT, not against its
  // date or its amount, and this field is one of the two that caused it — so it
  // is invalid and it is described by that message, even though nothing is
  // keyed under its own name.
  const groupErrorId = useContext(FieldSetErrorContext)
  const describedBy = [
    error ? `${id}-error` : null,
    groupErrorId,
    hint ? `${id}-hint` : null,
  ]
    .filter(Boolean)
    .join(' ')

  // A checkbox is a box, not a text input: CONTROL_CLASS's height, border and
  // padding would stretch it into something that looks like an empty field.
  const choice = as === 'checkbox' || as === 'radio'
  const shared = {
    id,
    name,
    'aria-invalid': error || groupErrorId ? true : undefined,
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

  // B-201. `min-w-0` is the other half of B-116's `max-w-full` on
  // CONTROL_CLASS, and without it that fix does nothing. This wrapper is a flex
  // item in `AdminForm`'s wrapping row, so its default `min-width: auto` holds
  // it at its own min-content width — which, for a `<select>`, is the LONGEST
  // OPTION. `max-w-full` then caps the control at 100% of a parent that is
  // already too wide, and the pair cancels out: `protectionRequired` ran to
  // 365px on a 320px phone with B-116's fix present and applied, and B-116's
  // own comment names that exact control. Six of them on three screens were in
  // that state with every one of their routes green, because `[contain:layout]`
  // on `<main>` stops the document-level reflow assertion at the containing
  // block (B-199) — `expectNoHorizontalOverflow` is the check that can see it.
  //
  // PREPENDED rather than put in the default string, which is the whole point.
  // A caller passing `className` REPLACES the default, and five files declare a
  // local `FIELD_CLASS` that is a hand-copy of that default — so a fix written
  // into the default reached `/admin/settings` and left `/admin/rate-increases`
  // and the transfer wizard exactly as broken. Every `Field` gets this now,
  // whatever it was handed.
  return (
    <div className={`min-w-0 ${className ?? 'flex flex-col gap-1 text-sm'}`}>
      <label htmlFor={id}>{label}</label>
      {as === 'select' ? <select {...shared}>{children}</select> : <input {...shared} />}
      {messages}
    </div>
  )
}

/// A set of controls that answer one question, with the error on the group
/// rather than on any one of them.
///
/// "Choose a protection plan" is a fact about the whole set — there is no
/// single radio it belongs to, and putting it on the first one tells a
/// control-by-control navigator who happens to land on the third one nothing at
/// all.
///
/// **B-213. Allowed is not conveyed, and this used to rely on allowed.** The
/// group's error sat on the `<fieldset>` as `aria-invalid` and
/// `aria-describedby`, reasoning that both are global attributes. They are, and
/// neither reaches anybody: no shipping screen reader announces a group's
/// description when focus lands on a control inside it, and `aria-invalid` has
/// no mapping on role `group` at all. axe passes it regardless, because
/// `aria-invalid` is global in axe's model too — so B-192's headline fix,
/// refusals reaching the field that caused them, landed visually only.
///
/// The message therefore travels TWO ways, and both are load-bearing:
///
///  1. **Folded into the `<legend>`**, screen-reader-only so it is not printed
///     twice. The legend is the group's accessible NAME, which every screen
///     reader announces on entering the group — including to bare `<input
///     type="radio">` children that know nothing about this component, which is
///     the protection step and the SCRA declaration.
///  2. **Handed to `Field` children through `FieldSetErrorContext`**, which
///     append it to their own `aria-describedby` and mark themselves invalid.
///     A group name is announced when focus ENTERS the group; a description is
///     announced wherever focus lands, including on a jump straight to the
///     second control from a rotor.
///
/// The cost is that a `Field` child inside a refused group hears the message
/// twice in one utterance — once as part of the group name, once as its own
/// description. That is a nuisance; being told nothing at all was the defect,
/// and neither mechanism covers the other's case.
///
/// The fieldset keeps `aria-describedby` for its HINT, which is not announced
/// there either — a smaller version of the same problem, and not this row's:
/// a hint is guidance nobody is stuck without, and no group here relies on one
/// to be usable.
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

  return (
    <fieldset
      className={className}
      // No `aria-invalid`: role `group` has no mapping for it, so it announced
      // nothing and made the omission look handled.
      aria-describedby={hint ? `${id}-hint` : undefined}
    >
      <legend className="font-medium">
        {legend}
        {/* `sr-only`, not hidden: the visible message is the <p> below, and a
            legend that printed it too would say it twice on screen. `sr-only`
            is `position: absolute`, so the text stays in the accessibility
            tree — which is the whole point, because the legend is what a
            screen reader reads as this group's name. */}
        {error && <span className="sr-only">, {error}</span>}
      </legend>
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
      <FieldSetErrorContext.Provider value={error ? `${id}-error` : null}>
        {children}
      </FieldSetErrorContext.Provider>
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
