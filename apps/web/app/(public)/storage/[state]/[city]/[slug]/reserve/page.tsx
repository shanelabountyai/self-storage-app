import { LocaleLink } from '@/components/site/locale-link'
import { notFound, redirect } from 'next/navigation'
import { AdminForm, Field } from '@/components/admin/form'
import { formatRate } from '@/lib/format'
import { publicFacilityBySlug, facilityPath, formatAddress } from '@/lib/facility/public-facility'
import { holdWindowSentence } from '@/lib/reservations/reserve'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import { MAX_MOVE_IN_DAYS_AHEAD } from '@/lib/reservations/reserve'
import { reserveAction } from './actions'

export const metadata = { title: 'Reserve a unit for free' }

// PRD 01 §4.4 US-401. One screen, five fields, no password and no card (D-7).
//
// The form primitives are the ones B-094 built for admin. They are not
// admin-specific — they carry the error identification, the suggestion, the
// focused summary and the persistent live region that PRD 01 §6.8.1 asks of
// every customer-facing form too. Reusing them is how the checkout stepper
// inherits the same behaviour instead of re-deriving half of it.

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function maxDateIso(): string {
  const date = new Date()
  date.setDate(date.getDate() + MAX_MOVE_IN_DAYS_AHEAD)
  return date.toISOString().slice(0, 10)
}

export default async function ReservePage({
  params,
  searchParams,
}: {
  params: Promise<{ state: string; city: string; slug: string }>
  searchParams: Promise<{ unitType?: string }>
}) {
  const { slug } = await params
  const { unitType: unitTypeId } = await searchParams

  const facility = await publicFacilityBySlug(slug)
  if (!facility) notFound()

  // Deliberately the uncached read: this page is about to hold a real unit, so
  // it asks the database rather than a list that may be up to five minutes old.
  const inventory = await publicInventoryForFacility(slug)
  const unitType = inventory?.unitTypes.find((type) => type.unitTypeId === unitTypeId)

  // The link can genuinely be stale — the facility page is served from a cached
  // read, so a size withdrawn in the last few minutes still appears there. Send
  // the renter back to the list, which is the thing they want, rather than a
  // 404 that makes it look like the whole facility vanished.
  if (!unitType) redirect(`${facilityPath(facility)}?unavailable=1`)

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="mb-4 text-sm">
        <LocaleLink href={facilityPath(facility)} className="underline underline-offset-4">
          ← Back to {facility.name}
        </LocaleLink>
      </p>

      <h1 className="text-3xl font-semibold tracking-tight text-balance">Reserve this unit</h1>

      {/* §6.6: the trust line belongs beside the decision, not in the lease —
          and it has to say what actually happens.

          B-118 found the row asked for "Free to hold for 7 days" (D-7's
          stated default) and that B-018 had built something else entirely, so
          it shipped the real rule as fixed prose. B-126 closed that: D-7 was
          corrected to match PRD 01 US-401 and the code, and the grace is now a
          per-facility setting — so this line is GENERATED from the value
          `holdExpiryFor` will actually use rather than describing it from
          memory. An operator who sets 0 gets a sentence that says 0, without
          anyone remembering to come back here. */}
      <p className="text-muted-foreground mt-2 text-pretty">
        {holdWindowSentence(facility.reservationHoldGraceDays)} · No credit card needed · Cancel any
        time
      </p>

      <div className="border-input mt-6 rounded-lg border p-4">
        <h2 className="font-medium">
          <span aria-hidden="true">
            {unitType.widthFt}×{unitType.lengthFt}
          </span>
          <span className="sr-only">
            {unitType.widthFt} foot by {unitType.lengthFt} foot
          </span>{' '}
          — {unitType.name}
        </h2>
        <p className="mt-1 text-sm">
          {formatRate(unitType.webRateCents)}
          <span className="text-muted-foreground">/mo online</span>
        </p>
        <address className="text-muted-foreground mt-2 text-sm not-italic">
          {formatAddress(facility)}
        </address>
      </div>

      <AdminForm
        action={reserveAction}
        label="Reserve a unit"
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="unitTypeId" value={unitType.unitTypeId} />

        {/* 1.3.5 Identify Input Purpose: every field carries its autocomplete
            token, and the keyboard matches the data (§6.2). */}
        <Field name="firstName" label="First name" autoComplete="given-name" required />
        <Field name="lastName" label="Last name" autoComplete="family-name" required />
        <Field
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          className="flex flex-col gap-1 text-sm sm:col-span-2"
          hint="Where we send your confirmation and your cancel link."
        />
        <Field
          name="phone"
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          required
          className="flex flex-col gap-1 text-sm sm:col-span-2"
        />
        <Field
          name="moveInDate"
          label="Move-in date"
          type="date"
          defaultValue={todayIso()}
          min={todayIso()}
          max={maxDateIso()}
          required
          className="flex flex-col gap-1 text-sm sm:col-span-2"
          hint={`We can hold a unit up to ${MAX_MOVE_IN_DAYS_AHEAD} days ahead.`}
        />

        <div className="sm:col-span-2">
          <button
            type="submit"
            className="bg-primary text-primary-foreground inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium sm:w-auto"
          >
            Reserve for free
          </button>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            Reserving costs nothing and does not commit you to renting. We hold the unit and this
            price until the hold expires.
          </p>
        </div>
      </AdminForm>
    </div>
  )
}
