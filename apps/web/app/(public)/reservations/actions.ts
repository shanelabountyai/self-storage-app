'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cancelReservation, reservationByToken } from '@/lib/reservations/reserve'
import { startCheckout } from '@/lib/checkout/session'
import type { FormState } from '@/lib/admin/form-state'

/// B-018. The deliberate second step of cancelling: the email link only ever
/// renders the reservation, and this is what actually releases the unit
/// (WCAG 3.3.4 — an irreversible action needs a confirmation step, and a GET
/// that a mail client can prefetch is not one).
export async function cancelReservationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get('token') ?? '')
  const result = await cancelReservation(token)

  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'not_held'
          ? 'That reservation was already cancelled or has ended, so there was nothing to release.'
          : 'We could not find that reservation. The link may have expired.',
      fieldErrors: {},
    }
  }

  revalidatePath('/reservations')
  return {
    status: 'success',
    message: 'Cancelled. The unit is back available and nothing has been charged.',
  }
}

/// US-401's "a link to complete move-in online" — a real destination for both
/// the confirmation screen and the confirmation/reminder emails (B-031). A
/// POST, not a plain link, for the same reason "Rent now" (B-020) is: starting
/// a checkout locks a unit, and that has to be a deliberate act rather than
/// something a mail client's link-prefetch or a page revisit triggers.
export async function completeMoveInFromReservationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get('token') ?? '')
  const reservation = await reservationByToken(token)
  if (!reservation || reservation.status !== 'held') {
    return {
      status: 'error',
      message: 'This reservation is no longer live, so there is nothing to continue.',
      fieldErrors: {},
    }
  }

  // startCheckout reuses the reservation's own unit rather than claiming a
  // second one (session.ts's own note) — the whole reason this passes
  // reservationId instead of just starting a checkout from the unit type.
  const started = await startCheckout({
    facilityId: reservation.facilityId,
    unitTypeId: reservation.unitTypeId,
    quotedRateCents: reservation.quotedRateCents,
    reservationId: reservation.id,
  })
  if (!started.ok) {
    return {
      status: 'error',
      message: 'That unit is no longer available. Call us and we will find you something.',
      fieldErrors: {},
    }
  }

  redirect(`/checkout?token=${encodeURIComponent(started.token)}`)
}
