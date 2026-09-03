'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getAdminActor } from '@/lib/admin/context'
import { FACILITY_COOKIE } from '@/lib/admin/facility-selection'
import {
  createFacility,
  DuplicateSlugError,
  InvalidSlugError,
  InvalidTimezoneError,
} from '@/lib/admin/facility-settings'
import { geocodeQuery } from '@/lib/geo/geocode'
import { ForbiddenError } from '@/lib/rbac/authorize'
import { fieldError, type FieldErrors, type FormState } from '@/lib/admin/form-state'

// B-237. The create-facility flow. `/admin/settings` is read-and-update against
// a facility that already exists, so onboarding a site somebody has just bought
// was a database session — and a hand-inserted row bills rent and does nothing
// else.

/// A latitude or longitude typed by hand. Blank is a real answer and means
/// "work it out from the postal code", so it is not an error.
function parseCoordinate(
  raw: FormDataEntryValue | null,
  bound: number,
  name: string,
): { value: number | null } | { error: string } {
  const text = String(raw ?? '').trim()
  if (text === '') return { value: null }
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || Math.abs(parsed) > bound) {
    return { error: `${name} must be a number between -${bound} and ${bound}, or blank to use the postal code.` }
  }
  return { value: parsed }
}

export async function createFacilityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await getAdminActor()

  const text = (name: string) => String(formData.get(name) ?? '').trim()
  const name = text('name')
  const slug = text('slug').toLowerCase()
  const state = text('state')
  const postalCode = text('postalCode')
  const timezone = text('timezone')
  const latitude = parseCoordinate(formData.get('latitude'), 90, 'Latitude')
  const longitude = parseCoordinate(formData.get('longitude'), 180, 'Longitude')

  // 3.3.3 wants a suggestion, not just an identification.
  const errors: FieldErrors = {}
  if (name === '') errors.name = 'Enter the facility name as customers should see it.'
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    errors.slug = 'Use lowercase letters, numbers and single hyphens, for example austin-south.'
  }
  if (!/^[A-Za-z]{2}$/.test(state)) errors.state = 'State must be a 2-letter code, for example TX.'
  if (text('addressLine1') === '') errors.addressLine1 = 'Enter the street address renters will drive to.'
  if (text('city') === '') errors.city = 'Enter the city this site is in.'
  if (postalCode === '') errors.postalCode = 'Enter the postal code, for example 78704.'
  if (timezone === '') errors.timezone = 'Choose the timezone this site keeps its hours in.'
  if ('error' in latitude) errors.latitude = latitude.error
  if ('error' in longitude) errors.longitude = longitude.error
  if (Object.keys(errors).length > 0) return fieldError(errors)
  if ('error' in latitude || 'error' in longitude) return fieldError(errors)

  // The bundled zip dataset D-14 settled on, asked for the one thing the search
  // needs. A centroid is an approximation and is labelled as one in the echo —
  // it is not a guess at the building, it is the place the postal code names.
  const fromZip = geocodeQuery(postalCode)
  const point = {
    latitude: latitude.value ?? fromZip?.latitude ?? null,
    longitude: longitude.value ?? fromZip?.longitude ?? null,
  }

  // 3.3.4 Error Prevention (Legal, Financial). Same confirm-and-echo step as
  // the tax rate on `/admin/settings` — reused, not reinvented. A facility is
  // the thing every lease, invoice and lien notice hangs off, and its state
  // decides which compliance rules it can ever run (D-10, US-29).
  if (formData.get('confirmed') !== 'yes') {
    return {
      status: 'confirm',
      message: 'Check this before the site is created — its web address and its state are hard to change later.',
      confirmLabel: 'Yes, create this facility',
      echo: [
        { label: 'Name', value: name },
        { label: 'Web address', value: `/storage/${state.toLowerCase()}/…/${slug}` },
        { label: 'Address', value: [text('addressLine1'), text('city'), state.toUpperCase(), postalCode].filter(Boolean).join(', ') },
        { label: 'State rules it will follow', value: state.toUpperCase() },
        { label: 'Timezone', value: timezone },
        {
          label: 'Map position',
          value:
            point.latitude === null
              ? 'Not set — this site will not appear in renter searches until it is'
              : latitude.value === null
                ? `${point.latitude.toFixed(4)}, ${point.longitude?.toFixed(4)} (centre of ${postalCode})`
                : `${point.latitude.toFixed(4)}, ${point.longitude?.toFixed(4)}`,
        },
      ],
    }
  }

  let created: { id: string }
  try {
    created = await createFacility(actor, {
      name,
      slug,
      addressLine1: text('addressLine1'),
      addressLine2: text('addressLine2') || null,
      city: text('city'),
      state: state.toUpperCase(),
      postalCode,
      timezone,
      phone: text('phone') || null,
      email: text('email') || null,
      latitude: point.latitude,
      longitude: point.longitude,
    })
  } catch (error) {
    if (error instanceof DuplicateSlugError) {
      return fieldError({ slug: `Another facility already uses "${error.slug}". Try adding the city or the street.` })
    }
    if (error instanceof InvalidSlugError) {
      return fieldError({ slug: 'Use lowercase letters, numbers and single hyphens, for example austin-south.' })
    }
    if (error instanceof InvalidTimezoneError) {
      return fieldError({ timezone: 'Choose a timezone from the list.' })
    }
    if (error instanceof ForbiddenError) {
      return fieldError({
        name: 'Only an owner, or a manager assigned to every facility, can add a site to the portfolio.',
      })
    }
    throw error
  }

  // Switch to it. Landing on `/admin/settings` under the facility you were on
  // before, with a new site elsewhere in the switcher, is how the readiness
  // banner ends up read as a complaint about the wrong facility.
  const store = await cookies()
  store.set(FACILITY_COOKIE, created.id, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/admin',
    maxAge: 400 * 24 * 60 * 60,
  })

  revalidatePath('/admin', 'layout')
  // No success message, on purpose: the readiness banner at the top of
  // `/admin/settings` is the message, and it says what is still missing rather
  // than "Facility created."
  redirect('/admin/settings')
}
