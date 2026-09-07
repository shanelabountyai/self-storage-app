'use server'

import { redirect } from 'next/navigation'
import { createReservation } from '@/lib/reservations/reserve'
import { publicFacilityBySlug } from '@/lib/facility/public-facility'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import { keyedFieldError, type KeyedFieldErrors, type FormState } from '@/lib/admin/form-state'
import { getLocale, messages } from '@/lib/i18n/server'

// B-018 / US-401. Same return-don't-throw contract as the admin actions
// (PRD 02 FR-19): a rejected reservation is a message beside the field, never
// an error boundary.
//
// B-267 (D-122). Every sentence this action returns was an English literal, on
// a form the facility page renders in Spanish. The five field refusals hold
// KEYS and `keyedFieldError` resolves them — the same shape B-263 gave the
// checkout, and the reason the summary heading above them is translated too.
// The two NON-field messages are the ones that mattered: a sold-out size, and
// "we updated the hold you already had", which is the sentence a renter has to
// understand to not think their reservation vanished.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function reserveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await messages()
  const slug = String(formData.get('slug') ?? '')
  const unitTypeId = String(formData.get('unitTypeId') ?? '')

  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()
  const moveInRaw = String(formData.get('moveInDate') ?? '').trim()

  const errors: KeyedFieldErrors = {}
  if (!firstName) errors.firstName = { key: 'err.firstName' }
  if (!lastName) errors.lastName = { key: 'err.lastName' }
  if (!EMAIL.test(email)) errors.email = { key: 'err.reserveEmail' }
  // Phone is required by US-401's form, and it is what a manager calls when
  // something goes wrong with a move-in.
  if (!phone) errors.phone = { key: 'err.reservePhone' }

  const moveInDate = new Date(`${moveInRaw}T12:00:00`)
  if (!moveInRaw || Number.isNaN(moveInDate.getTime())) {
    errors.moveInDate = { key: 'err.reserveMoveIn' }
  }
  if (Object.keys(errors).length > 0) return keyedFieldError(errors, t)

  // The quoted rate comes from the server's current view, never from the form.
  // A rate posted by the browser is a rate the renter can choose.
  const facility = await publicFacilityBySlug(slug)
  const inventory = await publicInventoryForFacility(slug)
  const unitType = inventory?.unitTypes.find((type) => type.unitTypeId === unitTypeId)
  if (!facility || !unitType) {
    return { status: 'error', message: t('err.reserveUnlisted'), fieldErrors: {} }
  }

  const result = await createReservation({
    facilityId: facility.id,
    unitTypeId,
    firstName,
    lastName,
    email,
    phone,
    moveInDate,
    quotedRateCents: unitType.webRateCents,
    // B-265 (D-130). The confirmation email in the language of the page the
    // hold was placed from. A reservation is anonymous (D-7), so there is no
    // stored preference to prefer over it.
    locale: await getLocale(),
  })

  if (!result.ok) {
    if (result.reason === 'sold_out') {
      return { status: 'error', message: t('err.reserveSoldOut'), fieldErrors: {} }
    }
    return keyedFieldError(
      { moveInDate: { key: 'err.reserveMoveInTooFar', vars: { days: result.maxDays } } },
      t,
    )
  }

  // An updated hold keeps its original token — we only ever stored the hash,
  // so there is no link to send them to. Saying so where they are beats a
  // redirect to a page that cannot show them their reservation.
  if (!result.token) {
    return { status: 'success', message: t('reserve.holdUpdated') }
  }

  redirect(`/reservations?token=${encodeURIComponent(result.token)}&new=1`)
}
