import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { can } from '@/lib/rbac/authorize'
import { getOrgDefault } from '@/lib/admin/org-defaults'
import { ORG_DEFAULT_SCOPES, ORG_DEFAULT_SCOPE_LABELS } from '@storage/core/org'
import { createFacilityAction } from './actions'

export const metadata = { title: 'Add a facility' }

// B-237 / PRD 02 US-3, US-4, US-29. Onboarding a site.
//
// Gated on `org:defaults` asked with a null facilityId, which only an
// all-facilities assignment satisfies — there is no facility to be assigned to
// yet, and adding one to the portfolio is a portfolio-wide act.

const TIMEZONES = Intl.supportedValuesOf('timeZone')

export default async function NewFacilityPage() {
  const { actor } = await getSwitcherData()

  if (!can(actor, 'org:defaults', null)) {
    return (
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        A new site is added by an owner, or by a manager assigned to every facility. You can still
        see and change each site&apos;s own settings from{' '}
        <Link href="/admin/settings" className="underline underline-offset-2">
          Settings
        </Link>
        .
      </p>
    )
  }

  const defaults = await Promise.all(ORG_DEFAULT_SCOPES.map((scope) => getOrgDefault(scope)))
  const configured = ORG_DEFAULT_SCOPES.filter((_, index) => defaults[index] !== null)
  const missing = ORG_DEFAULT_SCOPES.filter((_, index) => defaults[index] === null)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-lg font-semibold">Add a facility</h1>

      <section aria-labelledby="pushed-heading" className="flex flex-col gap-2">
        <h2 id="pushed-heading" className="text-base font-medium">
          What the new site starts with
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          {configured.length > 0 ? (
            <>
              Your org defaults are copied in as the new site&apos;s own effective-dated settings:{' '}
              {configured.map((scope) => ORG_DEFAULT_SCOPE_LABELS[scope].toLowerCase()).join(', ')}.
              They are ordinary rows from that moment on, so changing one here later does not change
              them anywhere else.
            </>
          ) : (
            <>No org default is set yet, so the new site starts with nothing configured.</>
          )}{' '}
          {missing.length > 0 && (
            <>
              Nothing is set for{' '}
              {missing.map((scope) => ORG_DEFAULT_SCOPE_LABELS[scope].toLowerCase()).join(' or ')} —
              you can{' '}
              <Link href="/admin/settings/org" className="underline underline-offset-2">
                set the org defaults
              </Link>{' '}
              first, or fill them in on the new site afterwards. Either way the site will say what it
              is still missing until nothing is.
            </>
          )}
        </p>
      </section>

      <AdminForm
        action={createFacilityAction}
        label="Add a facility"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <Field
          name="name"
          label="Name"
          required
          className="flex flex-col gap-1 text-sm sm:col-span-2"
          hint="As customers should see it, for example Austin South Storage."
        />
        <Field
          name="slug"
          label="Web address"
          required
          className="flex flex-col gap-1 text-sm sm:col-span-2"
          hint="Lowercase letters, numbers and single hyphens — this becomes part of the public page's address and is what printed signs and links point at, so it is worth getting right now."
        />
        <Field
          name="addressLine1"
          label="Address line 1"
          required
          className="flex flex-col gap-1 text-sm sm:col-span-2"
        />
        <Field
          name="addressLine2"
          label="Address line 2"
          className="flex flex-col gap-1 text-sm sm:col-span-2"
        />
        <Field name="city" label="City" required />
        <Field
          name="state"
          label="State"
          required
          maxLength={2}
          hint="Two-letter code, for example TX. This decides which compliance rules the site follows, and a site with no state cannot run a lien timeline at all."
        />
        <Field name="postalCode" label="Postal code" required />
        <Field name="timezone" label="Timezone" as="select" required defaultValue="America/Chicago">
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Field>
        <Field
          name="latitude"
          label="Latitude"
          hint="Leave both blank to use the centre of the postal code. Without a position the site is left out of renter searches."
        />
        <Field name="longitude" label="Longitude" />
        <Field name="phone" label="Phone" type="tel" />
        <Field name="email" label="Email" type="email" />

        <div className="sm:col-span-2">
          <Button type="submit">Review this facility</Button>
        </div>
      </AdminForm>
    </div>
  )
}
