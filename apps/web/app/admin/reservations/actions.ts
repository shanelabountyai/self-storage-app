'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { cancelReservationByStaff, startMoveInFromReservation } from '@/lib/admin/reservations'
import type { FormState } from '@/lib/admin/form-state'

// PRD 02 US-14 (B-434). Thin session wrappers; the decisions and the
// permission checks live in lib/admin/reservations.ts.

export async function startMoveInFromReservationAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const started = await startMoveInFromReservation(actor, String(formData.get('reservationId') ?? ''))
  if (!started.ok) redirect('/admin/reservations?gone=1')
  redirect(`/checkout?token=${encodeURIComponent(started.token)}`)
}

/// Two presses (3.3.4): the first echoes whose hold it is, the second releases
/// the unit.
export async function cancelHoldAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const name = String(formData.get('name') ?? '')

  if (formData.get('confirmed') !== 'yes') {
    return {
      status: 'confirm',
      message: 'Cancel this hold? The unit goes back on sale and the renter is not told.',
      echo: [
        { label: 'Renter', value: name },
        { label: 'Size', value: String(formData.get('size') ?? '') },
      ],
      confirmLabel: 'Yes, cancel the hold',
      cancel: { label: 'Keep the hold', message: 'The hold was kept.' },
    }
  }

  const result = await cancelReservationByStaff(actor, String(formData.get('reservationId') ?? ''))
  if (!result.ok) {
    return {
      status: 'error',
      message: 'That hold is no longer live. It was cancelled, expired or moved in already.',
      fieldErrors: {},
    }
  }
  revalidatePath('/admin/reservations')
  return { status: 'success', message: `Hold cancelled for ${name}. The unit is back on sale.` }
}
