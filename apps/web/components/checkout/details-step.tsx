import { AdminForm, Field } from '@/components/admin/form'
import { submitDetailsAction } from '@/app/(public)/checkout/actions'
import { type DetailsInput } from '@/lib/checkout/details'
import {
  MARKETING_EMAIL_CHECKOUT_CONSENT,
  MARKETING_SMS_CONSENT,
  SMS_CONSENT,
} from '@/lib/consent/disclosures'
import { translate, type Dictionary, type Locale, type MessageKey } from '@/lib/i18n'

// PRD 01 US-501 step 1. One screen, and every field carries its autocomplete
// token (1.3.5 Identify Input Purpose) and a keyboard that matches the data
// (§6.2).
//
// ── B-112: fourteen fields down to seven ─────────────────────────────────────
//
// §6.4 caps a step at seven visible fields. This one rendered fourteen, on a
// phone, immediately after "Rent now" — the first thing a renter meets after
// deciding to buy. Three changes, none of which drop information:
//
//   * City and state are DERIVED from the zip (D-14's bundled dataset) and
//     shown read-only. They were two free-text inputs beside the field that
//     already determines both, and `state` accepted exactly two characters —
//     so typing "Texas" was rejected after submitting, a validation error the
//     form invented for itself. The disclosure below them is the way out for a
//     zip the dataset does not carry.
//   * The alternate contact and the active-duty declaration moved to the lease
//     step, where they belong: one is who we write to when a notice bounces,
//     the other is a legal declaration made alongside the agreement.
//   * The two consent boxes sit BELOW the primary action. Marketing consent is
//     the only thing on this screen that serves us rather than the renter, and
//     it was sitting between their phone number and their address.
//
// Net: seven fields to fill, plus one read-only line, above Continue.
//
// No address-autocomplete API. D-14 settled that this product carries no
// geocoding vendor and narrowed the open question to map rendering and address
// autocomplete; both still want a billed key. The browser's own autofill does
// the same job for a returning user from the `autocomplete` tokens below, at no
// cost and with no third party in the middle of a renter's home address.

export function DetailsStep({
  token,
  prefill,
  manualLocality = false,
  emailOptional = false,
  dict,
  locale,
}: {
  token: string
  prefill: Partial<DetailsInput>
  /// D-111 / B-238. True only on a counter-started session
  /// (`emailOptionalFor`), where the renter in front of staff may genuinely
  /// have no address. Defaults false, so the public site is unchanged.
  emailOptional?: boolean
  /// True only when the stored city/state DISAGREE with what the zip derives —
  /// which is the only way they got there by hand. Without the distinction the
  /// disclosure would spring open on every return visit, because the session
  /// carries a city and state from then on either way, and the step would be
  /// back over the field cap for anyone who came back to it.
  manualLocality?: boolean
  dict: Dictionary
  /// B-259. Separate from `dict` on purpose: the disclosures below are NOT
  /// dictionary entries — each is a versioned consent text — so the step needs
  /// to know which language it is rendering, not just which words to use.
  locale: Locale
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  return (
    <AdminForm
      action={submitDetailsAction}
      label={t('details.formLabel')}
      className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <input type="hidden" name="token" value={token} />
      {/* B-259. Which language these disclosures were RENDERED in, carried to
          the action so the consent rows are stamped with the words that were
          actually on screen. Reading the cookie again at submit time would get
          this wrong for anyone who used the header language toggle after the
          page rendered. */}
      <input type="hidden" name="disclosureLocale" value={locale} />

      <Field
        name="firstName"
        label={t('details.firstName')}
        autoComplete="given-name"
        defaultValue={prefill.firstName ?? ''}
        required
      />
      <Field
        name="lastName"
        label={t('details.lastName')}
        autoComplete="family-name"
        defaultValue={prefill.lastName ?? ''}
        required
      />
      {/* B-238's accessibility criterion, SC 3.3.2 Labels or Instructions (A):
          where this field stops being required, the consequence of leaving it
          blank is a programmatic instruction ON the control — `hint` wires into
          `aria-describedby` — and it NAMES what the renter loses: no receipt,
          no pay link, no dunning notice, no lien-notice supplement. Dropping
          `required` and leaving the field silently optional is the version that
          produces `nobody@example.com`, which is the harm B-238 is about. A
          blank the renter chose is a fact; a blank nobody explained is a hole
          in the dunning ladder. */}
      <Field
        name="email"
        label={t('details.email')}
        type="email"
        inputMode="email"
        autoComplete="email"
        defaultValue={prefill.email ?? ''}
        required={!emailOptional}
        className="flex flex-col gap-1 text-sm sm:col-span-2"
        hint={t(emailOptional ? 'details.emailHintOptional' : 'details.emailHint')}
      />
      <Field
        name="phone"
        label={t('details.phone')}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        defaultValue={prefill.phone ?? ''}
        required
        className="flex flex-col gap-1 text-sm sm:col-span-2"
      />

      <Field
        name="addressLine1"
        label={t('details.address1')}
        autoComplete="address-line1"
        defaultValue={prefill.addressLine1 ?? ''}
        required
        className="flex flex-col gap-1 text-sm sm:col-span-2"
      />
      <Field
        name="addressLine2"
        label={t('details.address2')}
        autoComplete="address-line2"
        defaultValue={prefill.addressLine2 ?? ''}
        className="flex flex-col gap-1 text-sm sm:col-span-2"
      />
      <Field
        name="postalCode"
        label={t('details.postalCode')}
        // Numeric here is correct — unlike the search field, this one only ever
        // takes digits.
        inputMode="numeric"
        autoComplete="postal-code"
        defaultValue={prefill.postalCode ?? ''}
        required
        hint={t('details.postalCodeHint')}
      />

      {/* Read-only, and real text rather than a disabled input: there is
          nothing to operate, so nothing should be in the tab order pretending
          otherwise. Before the renter has submitted anything there is nothing
          to show, and saying so beats an empty box. */}
      <div className="text-sm">
        <p className="text-muted-foreground">{t('details.cityAndState')}</p>
        <p className="mt-1 font-medium">
          {prefill.city && prefill.state ? (
            `${prefill.city}, ${prefill.state}`
          ) : (
            <span className="text-muted-foreground font-normal">
              {t('details.fromYourZip')}
            </span>
          )}
        </p>
      </div>

      {/* The escape hatch, and not a rare one: the dataset does not know every
          zip, a PO box is not where anybody lives, and a zip can straddle a
          boundary. Closed by default so it does not count against the field
          cap, and a <details> rather than a JS disclosure so it still opens
          with the bundle disabled. */}
      <details open={manualLocality} className="text-sm sm:col-span-2">
        <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4">
          {t('details.enterMyself')}
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            name="city"
            label={t('details.city')}
            autoComplete="address-level2"
            defaultValue={prefill.city ?? ''}
          />
          <Field
            name="state"
            label={t('details.state')}
            autoComplete="address-level1"
            maxLength={2}
            defaultValue={prefill.state ?? ''}
            hint={t('details.stateHint')}
          />
        </div>
      </details>

      <div className="sm:col-span-2">
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium sm:w-auto"
        >
          {t('checkout.continue')}
        </button>
      </div>

      {/* B-259 (D-125). The three disclosures below are translated and still
          NOT dictionary entries. Each one is a versioned consent text, and the
          version is the evidence of what words the renter agreed to — TCPA
          wants express written consent to the wording actually shown. So the
          Spanish carries its OWN version (`v1-es`), the locale that was
          rendered rides along in the hidden field above, and the pair is what
          a later dispute reads. `lib/consent/disclosures.ts` keeps the text
          and its version in one object per language so neither can be changed
          without the other. */}
      {/* Below the primary action on purpose (B-112). Neither is required to
          rent, and the marketing one exists for us rather than for the renter —
          it has no business sitting between their phone number and their
          address, where it reads as another thing to get through. */}
      <div className="flex flex-col gap-3 sm:col-span-2">
        {/* PRD 05 CN-15: unchecked by default, its own affirmative act — never
            implied by entering a phone number above. */}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="smsConsent" value="yes" className="mt-1" />
          <span>{SMS_CONSENT[locale].text}</span>
        </label>

        {/* PRD 04 US-13 AC1 / US-9 AC3: unchecked by default. This is the ONLY
            thing that makes the abandoned-checkout follow-up (US-9) legal to
            send at all — "no consent, no sequence." */}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="marketingConsent" value="yes" className="mt-1" />
          <span>{MARKETING_EMAIL_CHECKOUT_CONSENT[locale].text}</span>
        </label>

        {/* PRD 04 US-13 AC1/AC3, D-51 (B-123). A FOURTH box, and separate from
            the SMS one above on purpose: TCPA needs express written consent to
            marketing texts specifically, so agreeing to gate codes by text
            cannot be read as agreeing to be texted about a sale. One box
            covering both would make it impossible to show which was given.

            Last of the four, and unchecked like the rest — it is the one that
            asks for the most and offers the renter the least. */}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="marketingSmsConsent" value="yes" className="mt-1" />
          <span>{MARKETING_SMS_CONSENT[locale].text}</span>
        </label>
      </div>
    </AdminForm>
  )
}
