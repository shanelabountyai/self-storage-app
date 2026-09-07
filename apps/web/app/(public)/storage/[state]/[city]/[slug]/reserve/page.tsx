import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AdminForm, Field } from '@/components/admin/form'
import { formatRate } from '@/lib/format'
import { publicFacilityBySlug, facilityPath, formatAddress } from '@/lib/facility/public-facility'
import { holdWindowKey } from '@/lib/reservations/reserve'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import { MAX_MOVE_IN_DAYS_AHEAD } from '@/lib/reservations/reserve'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { reserveAction } from './actions'

// PRD 01 §4.4 US-401. One screen, five fields, no password and no card (D-7).
//
// The form primitives are the ones B-094 built for admin. They are not
// admin-specific — they carry the error identification, the suggestion, the
// focused summary and the persistent live region that PRD 01 §6.8.1 asks of
// every customer-facing form too. Reusing them is how the checkout stepper
// inherits the same behaviour instead of re-deriving half of it.
//
// B-267 (D-122). This whole surface took no dictionary until now: the facility
// page around it has been `<html lang="es">` since B-090f, and a Spanish
// visitor who pressed "Reservar gratis" landed on an English form. Both halves
// are translated together — the labels here and the refusals in `actions.ts` —
// because translating the questions and leaving the refusals is the defect
// B-263 existed to fix, one funnel step later.

export async function generateMetadata() {
  const dict = dictionaryFor(await getLocale())
  return { title: translate(dict, 'reserve.title') }
}

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

  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

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
        <Link href={facilityPath(facility)} className="underline underline-offset-4">
          ← {t('reserve.back', { facility: facility.name })}
        </Link>
      </p>

      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {t('reserve.heading')}
      </h1>

      {/* §6.6: the trust line belongs beside the decision, not in the lease —
          and it has to say what actually happens.

          B-118 found the row asked for "Free to hold for 7 days" (D-7's
          stated default) and that B-018 had built something else entirely, so
          it shipped the real rule as fixed prose. B-126 closed that: D-7 was
          corrected to match PRD 01 US-401 and the code, and the grace is now a
          per-facility setting — so this line is GENERATED from the value
          `holdExpiryFor` will actually use rather than describing it from
          memory. An operator who sets 0 gets a sentence that says 0, without
          anyone remembering to come back here.

          B-267 moved the WORDS into the dictionary and left the CHOICE between
          them beside `holdExpiryFor`, where B-118's argument for keeping the
          rule and its description together still holds. */}
      <p className="text-muted-foreground mt-2 text-pretty">
        {t(holdWindowKey(facility.reservationHoldGraceDays), {
          days: facility.reservationHoldGraceDays,
        })}{' '}
        · {t('reserve.noCard')} · {t('reserve.cancelAnyTime')}
      </p>

      <div className="border-input mt-6 rounded-lg border p-4">
        <h2 className="font-medium">
          <span aria-hidden="true">
            {unitType.widthFt}×{unitType.lengthFt}
          </span>
          <span className="sr-only">
            {t('facility.footBy', { width: unitType.widthFt, length: unitType.lengthFt })}
          </span>{' '}
          — {unitType.name}
        </h2>
        <p className="mt-1 text-sm">
          {formatRate(unitType.webRateCents)}
          <span className="text-muted-foreground">{t('facility.perMonthOnline')}</span>
        </p>
        <address className="text-muted-foreground mt-2 text-sm not-italic">
          {formatAddress(facility)}
        </address>
      </div>

      <AdminForm
        action={reserveAction}
        label={t('reserve.formLabel')}
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="unitTypeId" value={unitType.unitTypeId} />

        {/* 1.3.5 Identify Input Purpose: every field carries its autocomplete
            token, and the keyboard matches the data (§6.2).

            The four names come from the checkout's `details.*` entries rather
            than getting a second set of their own: they are the same fields
            asking for the same things, and one label per field is what stops
            the two forms answering differently after somebody edits one. */}
        <Field
          name="firstName"
          label={t('details.firstName')}
          autoComplete="given-name"
          required
        />
        <Field name="lastName" label={t('details.lastName')} autoComplete="family-name" required />
        <Field
          name="email"
          label={t('details.email')}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          className="flex flex-col gap-1 text-sm sm:col-span-2"
          hint={t('reserve.emailHint')}
        />
        <Field
          name="phone"
          label={t('details.phone')}
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          required
          className="flex flex-col gap-1 text-sm sm:col-span-2"
        />
        <Field
          name="moveInDate"
          label={t('reserve.moveInDate')}
          type="date"
          defaultValue={todayIso()}
          min={todayIso()}
          max={maxDateIso()}
          required
          className="flex flex-col gap-1 text-sm sm:col-span-2"
          hint={t('reserve.moveInHint', { days: MAX_MOVE_IN_DAYS_AHEAD })}
        />

        <div className="sm:col-span-2">
          <button
            type="submit"
            className="bg-primary text-primary-foreground inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium sm:w-auto"
          >
            {t('facility.reserveForFree')}
          </button>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            {t('reserve.noCommitment')}
          </p>
        </div>
      </AdminForm>
    </div>
  )
}
