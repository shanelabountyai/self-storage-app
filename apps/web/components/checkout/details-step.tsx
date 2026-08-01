import { AdminForm, Field } from '@/components/admin/form'
import { submitDetailsAction } from '@/app/(public)/checkout/actions'
import type { DetailsInput } from '@/lib/checkout/details'

// PRD 01 US-501 step 1. One screen, and every field carries its autocomplete
// token (1.3.5 Identify Input Purpose) and a keyboard that matches the data
// (§6.2).
//
// No address-autocomplete API. D-14 settled that this product carries no
// geocoding vendor and narrowed the open question to map rendering and address
// autocomplete; both still want a billed key. The browser's own autofill does
// the same job for a returning user from the `autocomplete` tokens below, at no
// cost and with no third party in the middle of a renter's home address.

export function DetailsStep({
  token,
  prefill,
}: {
  token: string
  prefill: Partial<DetailsInput>
}) {
  return (
    <AdminForm
      action={submitDetailsAction}
      label="Your details"
      className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <input type="hidden" name="token" value={token} />

      <Field
        name="firstName"
        label="First name"
        autoComplete="given-name"
        defaultValue={prefill.firstName ?? ''}
        required
      />
      <Field
        name="lastName"
        label="Last name"
        autoComplete="family-name"
        defaultValue={prefill.lastName ?? ''}
        required
      />
      <Field
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        defaultValue={prefill.email ?? ''}
        required
        className="flex flex-col gap-1 text-sm sm:col-span-2"
        hint="This is your account. We send your lease, receipt and gate code here — no password needed."
      />
      <Field
        name="phone"
        label="Mobile number"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        defaultValue={prefill.phone ?? ''}
        required
        className="flex flex-col gap-1 text-sm sm:col-span-2"
      />

      <Field
        name="addressLine1"
        label="Street address"
        autoComplete="address-line1"
        required
        className="flex flex-col gap-1 text-sm sm:col-span-2"
      />
      <Field
        name="addressLine2"
        label="Flat, suite or unit (optional)"
        autoComplete="address-line2"
        className="flex flex-col gap-1 text-sm sm:col-span-2"
      />
      <Field name="city" label="City" autoComplete="address-level2" required />
      <Field
        name="state"
        label="State"
        autoComplete="address-level1"
        maxLength={2}
        required
        hint="Two-letter code, for example TX."
      />
      <Field
        name="postalCode"
        label="Zip code"
        // Numeric here is correct — unlike the search field, this one only ever
        // takes digits.
        inputMode="numeric"
        autoComplete="postal-code"
        required
      />

      <fieldset className="text-sm sm:col-span-2">
        <legend className="font-medium">Alternate contact (optional)</legend>
        <p className="text-muted-foreground mt-1">
          Someone we can reach if we cannot reach you. This does not give them access to your unit.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field name="altContactName" label="Name" autoComplete="off" />
          <Field name="altContactPhone" label="Phone" type="tel" inputMode="tel" autoComplete="off" />
        </div>
      </fieldset>

      <fieldset className="text-sm sm:col-span-2">
        <legend className="font-medium">Military service</legend>
        <label className="mt-2 inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" name="activeDutyMilitary" value="yes" />
          I am on active duty in the US armed forces
        </label>
        {/* Self-declared, and it earns real protections — saying why beats an
            unexplained question about someone's service. */}
        <p className="text-muted-foreground mt-1">
          Active-duty servicemembers have extra legal protections. Telling us means we apply them.
        </p>
      </fieldset>

      <div className="sm:col-span-2">
        <button
          type="submit"
          className="bg-primary text-primary-foreground inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium sm:w-auto"
        >
          Continue
        </button>
      </div>
    </AdminForm>
  )
}
