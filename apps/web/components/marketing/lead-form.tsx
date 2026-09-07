'use client'

import { useActionState, useId } from 'react'
import { IDLE_FORM_STATE, type FormState } from '@/lib/admin/form-state'
import { FormResult } from '@/components/marketing/form-result'
import { useLocale, useT } from '@/components/i18n/locale-provider'
import { MARKETING_EMAIL_LEAD_CONSENT } from '@/lib/consent/disclosures'

// PRD 04 US-8 (B-068). "As a prospect not ready to reserve, I can request a
// quote or callback."
//
// A client component only because it needs `useActionState` to render the
// server's answer inline. Everything it submits is plain form data, so it works
// with JavaScript disabled apart from the inline confirmation — the same
// posture as the rest of the public path (B-015).
//
// ── B-264: it is inside a page that was already Spanish ──────────────────────
//
// The facility page around this form has been translated since B-090f, so a
// Spanish visitor read Spanish down the page and then met an English form
// asking for their name, their phone and their consent. Copy comes from
// `useT()` — the provider is mounted in `app/(public)/layout.tsx`, so nothing
// has to be drilled through the page — and the marketing disclosure does NOT,
// for the reason D-125 settled: it is a versioned consent text, the version is
// the evidence of what words were agreed to, and a dictionary entry can be
// edited without anything noticing the version stayed put.

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
  const t = useT()
  const locale = useLocale()

  const errors = state.status === 'error' ? state.fieldErrors : {}

  // B-148. See `FormResult`: the region pre-exists the message it carries, and
  // focus lands on it rather than on `<body>` when the form replaces itself.
  return (
    <FormResult state={state}>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="facilityId" value={facilityId} />
        {/* B-264 (D-125). Which language the disclosure below was RENDERED in,
            carried to the action so the `Consent` row is stamped with the words
            that were actually on screen. Re-reading the cookie at submit time
            gets this wrong for anyone who used the header language toggle after
            the page drew. */}
        <input type="hidden" name="disclosureLocale" value={locale} />

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
          <legend className="text-sm font-medium">{t('lead.legend')}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="kind" value="quote" defaultChecked className="size-4" />
            {t('lead.quote')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="kind" value="callback" className="size-4" />
            {t('lead.callback')}
          </label>
        </fieldset>

        <Field name="name" label={t('lead.name')} required error={errors.name} autoComplete="name" />
        <Field
          name="email"
          label={t('lead.email')}
          type="email"
          error={errors.email}
          autoComplete="email"
        />
        <Field
          name="phone"
          label={t('lead.phone')}
          type="tel"
          error={errors.phone}
          autoComplete="tel"
          hint={t('lead.phoneHint')}
        />

        <label className="flex flex-col gap-1 text-sm">
          {t('lead.size')}
          <select
            name="unitTypeId"
            defaultValue=""
            className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          >
            <option value="">{t('lead.sizeUnsure')}</option>
            {unitTypes.map((unitType) => (
              <option key={unitType.id} value={unitType.id}>
                {unitType.label}
              </option>
            ))}
          </select>
        </label>

        <Field
          name="moveInDate"
          label={t('lead.moveInDate')}
          type="date"
          error={errors.moveInDate}
        />

        <label className="flex flex-col gap-1 text-sm">
          {t('lead.note')}
          <textarea
            name="note"
            rows={3}
            className="border-input bg-background rounded-md border p-2 text-sm"
          />
        </label>

        {/* PRD 04 US-13 AC1: "explicit opt-in, unchecked-by-default checkbox
            with disclosure text at capture." Separate from the quote/callback
            request itself — submitting the form works whether or not this is
            checked.

            B-264 (D-125). The sentence comes from `lib/consent/disclosures.ts`
            and not from the dictionary, because it is recorded on a `Consent`
            row with a version that is the evidence of WHAT WORDS were shown.
            Text and version travel together, per language, so there is no way
            to translate this without giving the translation its own version —
            and `disclosureLocale` above says which one was on screen. */}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="marketingConsent" value="yes" className="mt-1 size-4" />
          <span>{MARKETING_EMAIL_LEAD_CONSENT[locale].text}</span>
        </label>

        <button
          type="submit"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
        >
          {t('lead.send')}
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
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  // B-171. `htmlFor` and a sibling <input>, not a wrapping <label>. Wrapped,
  // the hint and the error were INSIDE the label, so they became part of the
  // field's accessible NAME as well as its description: the phone field was
  // named "Phone Required if you would like a call back." at rest, and a
  // refused email field was named "Email An email address or a phone number —
  // we need one way to reply." — the refusal read out as the field's identity
  // and then again as its description (2.4.6, and a duplicate announcement).
  // `WaitlistForm` beside it already does it this way.
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
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
    </div>
  )
}
