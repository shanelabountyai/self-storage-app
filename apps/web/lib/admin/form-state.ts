import type { MessageKey, MessageSegment, MessageVars } from '@/lib/i18n'

// The return shape every admin server action uses, per PRD 02 FR-19.
//
// Actions RETURN error state; they do not throw it. A thrown error renders
// Next's error boundary — which is a page, not a message next to the field that
// was wrong, and which tells a screen-reader user nothing at all. Before B-094
// every admin action threw, and a repo-wide grep found zero occurrences of
// `aria-invalid` anywhere in the app.

export type FieldErrors = Record<string, string>

// B-263. The same map before it has been resolved into words.
//
// Every field error on the money path used to be an English literal built
// inside the validator, so a renter who filled in a Spanish form was corrected
// in English at exactly the point 3.3.3 wants a suggestion they can act on.
// The validators return KEYS instead of copy, and the caller — which is the
// only thing that knows whose request this is — translates them. They cannot
// resolve their own copy: `validateDetails` is pure and has no request, and
// the staff surfaces D-122 keeps English share the same `FieldErrors` shape.
//
// The import is type-only on purpose. Three client components import
// `IDLE_FORM_STATE` from this file as a value, and a runtime import of the
// dictionaries here would pull both languages into their bundles.
export type FieldMessage = { key: MessageKey; vars?: MessageVars }
export type KeyedFieldErrors = Record<string, FieldMessage>

export type FormState =
  | { status: 'idle' }
  /// Announced in the form's persistent live region (FR-20). Say what changed,
  /// not "Saved" — "Tax rate added, effective 1 Aug 2026" is the useful form.
  ///
  /// `details` is a list the action produced that exists nowhere else and can
  /// never be shown again — MFA recovery codes are the case it was added for
  /// (B-079). It is rendered as a list rather than folded into `message`
  /// because a live region reading ten codes as one sentence is unusable.
  ///
  /// B-272. `messageParts` is the SAME sentence split into runs, and it exists
  /// for one thing: a run in a language the rest of the page is not (3.1.2).
  /// The applied-code confirmation quotes an operator's own `termsText`, which
  /// D-129 renders as typed, so «Código aplicado: 50% off the first month»
  /// needs a `lang="en"` on its second half.
  ///
  /// Additive rather than widening `message` to a node, and the reason is not
  /// timidity: `message` is what `announceOutside` hands to `AnnounceRegion`
  /// as a plain string, and it crosses the server-action boundary. It stays a
  /// string. A renderer that has parts uses them and falls back to `message`
  /// when it has none, so every other action in the app is untouched.
  ///
  /// The invariant, and it is what makes the fallback safe: joining the parts
  /// reproduces `message` exactly. `translate` and `translateSegments` take
  /// the same `vars` for that reason.
  | { status: 'success'; message: string; messageParts?: MessageSegment[]; details?: string[] }
  /// `message` is the summary heading; `fieldErrors` maps field name → message.
  /// A field error must carry a *suggestion*, not just an identification
  /// (3.3.3): "State must be a 2-letter code, e.g. TX."
  | { status: 'error'; message: string; fieldErrors: FieldErrors }
  /// Held separately from `error` because the confirm step is not a failure —
  /// nothing is wrong, the action is simply waiting for the user to agree to
  /// what it parsed (3.3.4). `echo` is what we understood, in the user's terms.
  ///
  /// `confirmLabel` names the button that commits. It defaults to "Yes, add it"
  /// — right for an append-only tax component, wrong for the thing B-177 needed
  /// it for, where the button reads "Yes, lower this rate" and naming the act
  /// is most of what the step is for.
  | {
      status: 'confirm'
      message: string
      echo: { label: string; value: string }[]
      confirmLabel?: string
    }

export const IDLE_FORM_STATE: FormState = { status: 'idle' }

export function fieldError(fields: FieldErrors): FormState {
  return {
    status: 'error',
    message:
      Object.keys(fields).length === 1
        ? 'There is a problem with one field.'
        : `There are problems with ${Object.keys(fields).length} fields.`,
    fieldErrors: fields,
  }
}

/// B-263, moved here by B-264 when the lead form became its second caller.
///
/// `fieldError` below takes finished sentences, which is right for the staff
/// screens D-122 keeps English. A renter-facing action holds KEYS instead and
/// resolves both halves here: the per-field messages AND the summary heading
/// above them, which is the sentence that was left in English when B-263
/// translated only the validators.
///
/// The dictionary arrives as `t` rather than being read here, and that is what
/// keeps the `MessageKey` import above type-only — three client components
/// import `IDLE_FORM_STATE` from this file as a value, and a runtime import of
/// `@/lib/i18n` would put both dictionaries in their browser bundles.
export type Translator = (key: MessageKey, vars?: MessageVars) => string

/// B-273. With ONE error the summary is that error's own sentence, not a count
/// of it. A count identifies a problem and suggests nothing, which is 3.3.3
/// traded away — and it is traded away where it costs most, because the forms
/// that refuse on a single field are the renter-facing ones. `FormResult` (the
/// lead and waitlist forms) announces `message` and NOTHING else: the sentence
/// saying what to do sits beside the input, reachable only by swiping back to
/// it, so "There is a problem with one field." was the entire announcement.
/// `AdminForm` renders the list inside the same `role="alert"`, so it read both
/// halves and only wasted the first — the same defect, quieter.
///
/// Two callers had already hand-rolled this shape with comments explaining why
/// the helper was wrong for them (checkout's promo refusal, the waitlist form);
/// both call the helper again. `fieldError` above is deliberately NOT changed:
/// every one of its callers is an `AdminForm` staff screen where the suggestion
/// is already announced, and the count is a redundancy there rather than a loss.
export function keyedFieldError(errors: KeyedFieldErrors, t: Translator): FormState {
  const fieldErrors = Object.fromEntries(
    Object.entries(errors).map(([field, { key, vars }]) => [field, t(key, vars)]),
  )
  const messages = Object.values(fieldErrors)
  return {
    status: 'error',
    message:
      messages.length === 1 ? messages[0] : t('err.someFields', { count: messages.length }),
    fieldErrors,
  }
}

export function success(message: string, details?: string[]): FormState {
  return { status: 'success', message, ...(details ? { details } : {}) }
}

/// B-173. Refuses a commit whose control no longer matches the preview it was
/// shown beside.
///
/// All four move-out and transfer screens price a settlement server-side from
/// the URL and commit through a server action. While the date picker sat in a
/// separate `method="GET"` form whose only submit was "Recalculate", the action
/// read a hidden copy of the URL instead — so changing Sep 1 to Sep 5 and
/// pressing Complete closed the lease on Sep 1, silently, after showing the
/// tenant Sep 5's figures (3.3.4). The four screens now keep the control INSIDE
/// the committing form, so what posts is what is on screen; this is the other
/// half, because that swap alone only mirrors the defect — committing the typed
/// date against figures worked out for a different one is the same lie with the
/// operands the other way round. While the two disagree, nothing posts.
///
/// `message` is the caller's because each screen names its own recalculate
/// control ("Recalculate", "Update", "Show me what it costs") and a refusal
/// that points at a button by the wrong name is a refusal with no way out.
export function stalePreview(
  formData: FormData,
  name: string,
  message: (typed: string) => string,
): FormState | null {
  const typed = String(formData.get(name) ?? '')
  if (typed === String(formData.get(`previewed_${name}`) ?? '')) return null
  return fieldError({ [name]: message(typed) })
}

/// Parses a decimal entered by a human into an integer of the smallest unit
/// (cents, or basis points), rejecting the things a bare `Number()` accepts
/// silently. Returns a message rather than a value on failure so the caller can
/// attach it to the field.
///
/// The range check is the point. `Math.round(Number(raw) * 100)` on its own
/// turns a fat-fingered "825" into an 825% tax rate applied to every future
/// invoice, and there was nothing between that keystroke and an append-only
/// row that cannot be edited or deleted (3.3.4).
export function parseScaled(
  raw: FormDataEntryValue | null,
  options: { scale: number; min: number; max: number; unit: string },
): { value: number } | { error: string } {
  const text = String(raw ?? '').trim()
  if (text === '') return { error: `Enter an amount in ${options.unit}.` }

  const parsed = Number(text)
  if (!Number.isFinite(parsed)) {
    return { error: `"${text}" is not a number. Enter an amount in ${options.unit}.` }
  }
  if (parsed < options.min || parsed > options.max) {
    return {
      error: `${parsed} is outside the allowed range of ${options.min} to ${options.max} ${options.unit}.`,
    }
  }
  // Rounded rather than truncated so "8.255" doesn't silently become 8.25.
  return { value: Math.round(parsed * options.scale) }
}

/// A calendar date entered as `yyyy-mm-dd`. Rejects an unparseable value rather
/// than storing `Invalid Date`, which Prisma would otherwise reject far from
/// the field that caused it.
export function parseDate(raw: FormDataEntryValue | null): { value: Date } | { error: string } {
  const text = String(raw ?? '').trim()
  const date = new Date(text)
  if (text === '' || Number.isNaN(date.getTime())) {
    return { error: 'Enter a date as yyyy-mm-dd.' }
  }
  return { value: date }
}
