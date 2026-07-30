'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { FACILITY_COOKIE } from '@/lib/admin/facility-selection'

/// Persists the switcher's selection (PRD 02 US-1 AC: "last selection persists
/// per user across sessions"). A cookie is the per-device approximation of
/// that — a per-user DB row would carry the choice across devices too, but
/// nothing in the acceptance criteria asks for that yet.
// ponytail: cookie, not a per-user DB preference; upgrade if cross-device
// persistence is ever explicitly requested.
export async function setFacility(formData: FormData) {
  const facilityId = String(formData.get('facilityId') ?? '')
  const returnTo = String(formData.get('returnTo') ?? '/admin')

  const store = await cookies()
  store.set(FACILITY_COOKIE, facilityId, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/admin',
    maxAge: 400 * 24 * 60 * 60,
  })

  redirect(returnTo.startsWith('/admin') ? returnTo : '/admin')
}
