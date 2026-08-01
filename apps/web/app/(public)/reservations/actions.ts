'use server'

import { revalidatePath } from 'next/cache'
import { cancelReservation } from '@/lib/reservations/reserve'
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
