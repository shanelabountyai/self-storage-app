import Link from 'next/link'
import { AdminForm, Field, FieldSet } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { placeEmergencyHoldAction } from './actions'

export const metadata = { title: 'Emergency hold' }

// The optional broadcast is CN-21's send loop, one facility after another,
// so the request has to outlive it — same ceiling as the announcements page.
export const maxDuration = 300

// PRD 02 US-42 (B-420). A hurricane or a flood: stop collections across a
// region in one action rather than one lease at a time.

export default async function EmergencyHoldPage() {
  const { actor, facilities } = await getSwitcherData()
  if (!hasPermissionAnywhere(actor, ['tenants:edit'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to holds.</p>
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Emergency hold</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Places an <strong>Emergency hold</strong> on every current lease at the facilities you pick,
          or at every facility in a county. While it runs, collections, late fees, access suspension
          and sales stop, and the days do not count toward the lien timeline. It ends on its own
          after the last day and raises a task at each site. Autopay keeps running.
        </p>
      </div>

      <AdminForm action={placeEmergencyHoldAction} label="Place an emergency hold" className="flex flex-col gap-4">
        <FieldSet name="facilityIds" legend="Facilities" hint="Pick sites, or leave these clear and name a county below.">
          {facilities.map((facility) => (
            <Field key={facility.id} name="facilityIds" as="checkbox" value={facility.id} label={facility.name} />
          ))}
        </FieldSet>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="state" label="State" maxLength={2} hint="With a county: two-letter code, for example TX." defaultValue="TX" />
          <Field
            name="county"
            label="County"
            hint="Every active facility whose county matches. Set under each facility’s settings."
            className="flex flex-col gap-1 text-sm sm:col-span-2"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="effectiveFrom" label="First day" type="date" defaultValue={todayIso()} required />
          <Field name="effectiveThrough" label="Last day" type="date" required hint="Inclusive. The hold ends at midnight after it." />
        </div>

        <Field
          name="reason"
          label="What is happening"
          required
          maxLength={200}
          hint="Shown on every affected tenant profile: “Hurricane — county under evacuation order”."
        />

        <fieldset className="border-input flex flex-col gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Tell affected tenants (optional)</legend>
          <p className="text-muted-foreground text-xs text-pretty">
            Sent as an operational notice to every current tenant at each site, through the same path
            as{' '}
            <Link href="/admin/comms/broadcast" className="underline underline-offset-4">
              Announcements
            </Link>
            . Leave both blank to send nothing.
          </p>
          <Field name="subject" label="Subject" maxLength={120} />
          <label className="flex flex-col gap-1 text-sm">
            Message
            <textarea name="message" rows={5} maxLength={2000} className="border-input bg-background rounded-md border p-2 text-sm" />
          </label>
        </fieldset>

        <Button type="submit">Review the hold</Button>
      </AdminForm>
    </div>
  )
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
