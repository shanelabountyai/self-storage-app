// The return shape every admin server action uses, per PRD 02 FR-19.
//
// Actions RETURN error state; they do not throw it. A thrown error renders
// Next's error boundary — which is a page, not a message next to the field that
// was wrong, and which tells a screen-reader user nothing at all. Before B-094
// every admin action threw, and a repo-wide grep found zero occurrences of
// `aria-invalid` anywhere in the app.

export type FieldErrors = Record<string, string>

export type FormState =
  | { status: 'idle' }
  /// Announced in the form's persistent live region (FR-20). Say what changed,
  /// not "Saved" — "Tax rate added, effective 1 Aug 2026" is the useful form.
  | { status: 'success'; message: string }
  /// `message` is the summary heading; `fieldErrors` maps field name → message.
  /// A field error must carry a *suggestion*, not just an identification
  /// (3.3.3): "State must be a 2-letter code, e.g. TX."
  | { status: 'error'; message: string; fieldErrors: FieldErrors }
  /// Held separately from `error` because the confirm step is not a failure —
  /// nothing is wrong, the action is simply waiting for the user to agree to
  /// what it parsed (3.3.4). `echo` is what we understood, in the user's terms.
  | { status: 'confirm'; message: string; echo: { label: string; value: string }[] }

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

export function success(message: string): FormState {
  return { status: 'success', message }
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
