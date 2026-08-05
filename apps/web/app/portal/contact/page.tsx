import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@storage/db'
import { requireTenantActor } from '@/lib/rbac/session'
import { addressHistory, currentAddress } from '@/lib/portal/contact'
import { AdminForm, Field } from '@/components/admin/form'
import {
  requestEmailChangeAction,
  saveAddressAction,
  saveContactDetailsAction,
} from './actions'

export const metadata: Metadata = { title: 'Contact details' }

// PRD 01 US-706 / PRD 02 US-13. Three separate forms on purpose: saving a
// phone number should not require re-entering an address, and changing an
// email is a different act with a different outcome (a link, not a save).

const FIELD_CLASS = 'flex flex-col gap-1 text-sm'

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    date,
  )
}

export default async function ContactPage() {
  const actor = await requireTenantActor()
  const [tenant, address, history] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: actor.tenantId },
      select: {
        email: true,
        phone: true,
        altContactName: true,
        altContactPhone: true,
        altContactEmail: true,
      },
    }),
    currentAddress(actor.tenantId),
    addressHistory(actor.tenantId),
  ])

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Contact details</h1>

      <section aria-labelledby="details-heading" className="flex flex-col gap-3">
        <h2 id="details-heading" className="font-medium">
          Phone and alternate contact
        </h2>
        <AdminForm
          action={saveContactDetailsAction}
          label="Phone and alternate contact"
          className="flex flex-col gap-3"
        >
          <Field name="phone" label="Phone" type="tel" defaultValue={tenant.phone ?? ''} className={FIELD_CLASS} />
          <Field
            name="altContactName"
            label="Alternate contact name"
            defaultValue={tenant.altContactName ?? ''}
            className={FIELD_CLASS}
          />
          <Field
            name="altContactPhone"
            label="Alternate contact phone"
            type="tel"
            defaultValue={tenant.altContactPhone ?? ''}
            className={FIELD_CLASS}
          />
          <Field
            name="altContactEmail"
            label="Alternate contact email"
            type="email"
            defaultValue={tenant.altContactEmail ?? ''}
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            className="bg-primary text-primary-foreground mt-1 inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
          >
            Save details
          </button>
        </AdminForm>
      </section>

      <section aria-labelledby="address-heading" className="flex flex-col gap-3">
        <h2 id="address-heading" className="font-medium">
          Mailing address
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">
          This is where we post anything that has to reach you on paper, so it&apos;s worth keeping
          current.
        </p>
        <AdminForm action={saveAddressAction} label="Mailing address" className="flex flex-col gap-3">
          <Field
            name="addressLine1"
            label="Street address"
            defaultValue={address?.addressLine1 ?? ''}
            required
            className={FIELD_CLASS}
          />
          <Field
            name="addressLine2"
            label="Apartment or unit (optional)"
            defaultValue={address?.addressLine2 ?? ''}
            className={FIELD_CLASS}
          />
          <Field name="city" label="City" defaultValue={address?.city ?? ''} required className={FIELD_CLASS} />
          <Field
            name="state"
            label="State"
            defaultValue={address?.state ?? ''}
            maxLength={2}
            required
            className={FIELD_CLASS}
          />
          <Field
            name="postalCode"
            label="ZIP code"
            inputMode="numeric"
            defaultValue={address?.postalCode ?? ''}
            required
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            className="bg-primary text-primary-foreground mt-1 inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
          >
            Save address
          </button>
        </AdminForm>

        {history.length > 1 && (
          <details className="border-input rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">Previous addresses</summary>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {history.slice(1).map((row) => (
                <li key={row.id} className="text-muted-foreground">
                  {row.addressLine1}
                  {row.addressLine2 ? `, ${row.addressLine2}` : ''}, {row.city} {row.state}{' '}
                  {row.postalCode} — until {formatWhen(row.createdAt)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="email-heading" className="flex flex-col gap-3">
        <h2 id="email-heading" className="font-medium">
          Email address
        </h2>
        <p className="text-sm">
          Your email is <strong>{tenant.email}</strong>. It&apos;s also how you sign in.
        </p>
        <p className="text-muted-foreground text-sm text-pretty">
          To change it, we send a link to the new address to make sure it reaches you — and let your
          current address know, in case it wasn&apos;t you asking.
        </p>
        <AdminForm action={requestEmailChangeAction} label="Change email address" className="flex flex-col gap-3">
          <Field
            name="email"
            label="New email address"
            type="email"
            inputMode="email"
            required
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
          >
            Send confirmation link
          </button>
        </AdminForm>
      </section>

      <Link href="/portal" className="text-sm underline underline-offset-4">
        Back to my account
      </Link>
    </div>
  )
}
