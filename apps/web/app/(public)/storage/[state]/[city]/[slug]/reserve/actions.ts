'use server'

import { redirect } from 'next/navigation'
import { createReservation } from '@/lib/reservations/reserve'
import { publicFacilityBySlug } from '@/lib/facility/public-facility'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import { fieldError, type FieldErrors, type FormState } from '@/lib/admin/form-state'

import { getLocale } from '@/lib/i18n/server'
import { localePath } from '@/lib/i18n/routing'
// B-018 / US-401. Same return-don't-throw contract as the admin actions
// (PRD 02 FR-19): a rejected reservation is a message beside the field, never
// an error boundary.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function reserveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = String(formData.get('slug') ?? '')
  const unitTypeId = String(formData.get('unitTypeId') ?? '')

  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()
  const moveInRaw = String(formData.get('moveInDate') ?? '').trim()

  const errors: FieldErrors = {}
  if (!firstName) errors.firstName = 'Enter your first name.'
  if (!lastName) errors.lastName = 'Enter your last name.'
  if (!EMAIL.test(email)) errors.email = 'Enter an email address we can send your confirmation to.'
  // Phone is required by US-401's form, and it is what a manager calls when
  // something goes wrong with a move-in.
  if (!phone) errors.phone = 'Enter a mobile number so we can text you the details.'

  const moveInDate = new Date(`${moveInRaw}T12:00:00`)
  if (!moveInRaw || Number.isNaN(moveInDate.getTime())) {
    errors.moveInDate = 'Choose the date you want to move in.'
  }
  if (Object.keys(errors).length > 0) return fieldError(errors)

  // The quoted rate comes from the server's current view, never from the form.
  // A rate posted by the browser is a rate the renter can choose.
  const facility = await publicFacilityBySlug(slug)
  const inventory = await publicInventoryForFacility(slug)
  const unitType = inventory?.unitTypes.find((type) => type.unitTypeId === unitTypeId)
  if (!facility || !unitType) {
    return { status: 'error', message: 'That unit is no longer listed.', fieldErrors: {} }
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
  })

  if (!result.ok) {
    if (result.reason === 'sold_out') {
      return {
        status: 'error',
        message:
          'Someone took the last one of that size while you were filling this in. Nothing has been charged — pick another size, or call us and we will sort it out.',
        fieldErrors: {},
      }
    }
    return fieldError({
      moveInDate: `We can hold a unit up to ${result.maxDays} days ahead. Pick a date within that.`,
    })
  }

  // An updated hold keeps its original token — we only ever stored the hash,
  // so there is no link to send them to. Saying so where they are beats a
  // redirect to a page that cannot show them their reservation.
  if (!result.token) {
    return {
      status: 'success',
      message:
        'You already had a hold on this size, so we updated it rather than taking a second unit. Your original confirmation email still has the link.',
    }
  }

  redirect(
    localePath(await getLocale(), `/reservations?token=${encodeURIComponent(result.token)}&new=1`),
  )
}
