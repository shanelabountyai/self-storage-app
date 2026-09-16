import Link from 'next/link'
import { AdminForm, Field } from '@/components/admin/form'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { can } from '@/lib/rbac/authorize'
import { createLeaselessTenantAction } from './actions'

export const metadata = { title: 'Add a tenant' }

const FIELD_CLASS = 'flex flex-col gap-1 text-sm'

// B-312. The only way to create a `Tenant` used to be a real move-in — so the
// only way to make a company's accounts-payable contact a business account's
// payer was a fake lease on a unit she would never occupy. This is the same
// `Tenant` row with none of that: no lease, no occupancy, no portal identity
// (B-287 sends access, when a business account names them a member).

export default async function NewTenantPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above — a tenant added here is recorded as belonging to one
        facility until they hold a lease of their own.
      </p>
    )
  }
  if (!can(actor, 'tenants:edit', selected.facility.id)) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to add a tenant.</p>
  }

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Add a tenant</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          For somebody who needs a tenant record but rents nothing here — a business account&apos;s
          payer or an authorized member most often. This does not rent them a unit and does not
          email them anything.
        </p>
      </div>

      <AdminForm
        action={createLeaselessTenantAction}
        label="Add a tenant"
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="facilityId" value={selected.facility.id} />
        <div className="grid grid-cols-2 gap-3">
          <Field name="firstName" label="First name" required className={FIELD_CLASS} />
          <Field name="lastName" label="Last name" required className={FIELD_CLASS} />
        </div>
        <Field
          name="email"
          label="Email"
          type="email"
          className={FIELD_CLASS}
          hint="Optional — D-111. Leave it blank if they have none; nothing here signs them in."
        />
        <Field name="phone" label="Phone" type="tel" className={FIELD_CLASS} />

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Address of record</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field
              name="addressLine1"
              label="Street address"
              required
              className={`${FIELD_CLASS} col-span-2`}
            />
            <Field
              name="addressLine2"
              label="Apartment or unit"
              className={`${FIELD_CLASS} col-span-2`}
            />
            <Field name="city" label="City" required className={FIELD_CLASS} />
            <Field name="state" label="State" maxLength={2} required className={FIELD_CLASS} />
            <Field name="postalCode" label="ZIP code" required className={FIELD_CLASS} />
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
          >
            Add tenant
          </button>
          <Link href="/admin/tenants" className="text-sm underline underline-offset-2">
            Cancel
          </Link>
        </div>
      </AdminForm>
    </div>
  )
}
