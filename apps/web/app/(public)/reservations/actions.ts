'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  cancelReservation,
  changeMoveInDate,
  reservationByToken,
} from '@/lib/reservations/reserve'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import { offerFor } from '@/lib/promotions/service'
import { startCheckout } from '@/lib/checkout/session'
import type { FormState } from '@/lib/admin/form-state'
import { messages } from '@/lib/i18n/server'

/// B-018. The deliberate second step of cancelling: the email link only ever
/// renders the reservation, and this is what actually releases the unit
/// (WCAG 3.3.4 — an irreversible action needs a confirmation step, and a GET
/// that a mail client can prefetch is not one).
///
/// B-268 (D-122). Both messages were English literals on a page a Spanish
/// reservation redirects to. Neither hangs on a field — the only input here is
/// a hidden token — so they go back as the form's summary and there is no
/// fourth `keyedFieldError` caller.
export async function cancelReservationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const result = await cancelReservation(token)

  if (!result.ok) {
    return {
      status: 'error',
      message: t(
        result.reason === 'not_held' ? 'err.reservationNotHeld' : 'err.reservationNotFound',
      ),
      fieldErrors: {},
    }
  }

  revalidatePath('/reservations')
  return { status: 'success', message: t('res.cancelled') }
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
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const reservation = await reservationByToken(token)
  if (!reservation || reservation.status !== 'held') {
    return { status: 'error', message: t('err.reservationNotLive'), fieldErrors: {} }
  }

  // startCheckout reuses the reservation's own unit rather than claiming a
  // second one (session.ts's own note) — the whole reason this passes
  // reservationId instead of just starting a checkout from the unit type.
  // Evaluated at conversion rather than carried on the hold: `Reservation` has
  // no promotion columns, and a free hold can sit for days, so the honest
  // answer is the offer that is live when they come back to finish. Same
  // server-side evaluation as "Rent now" — never a value the browser sent.
  const offer = await offerFor({
    facilityId: reservation.facilityId,
    unitTypeId: reservation.unitTypeId,
    monthlyRateCents: reservation.quotedRateCents,
    isNewTenant: true,
  })

  const started = await startCheckout({
    facilityId: reservation.facilityId,
    unitTypeId: reservation.unitTypeId,
    quotedRateCents: reservation.quotedRateCents,
    reservationId: reservation.id,
    promo: offer.offer
      ? {
          promotionId: offer.offer.promotionId,
          promoCodeId: offer.offer.promoCodeId,
          terms: offer.offer.terms,
          firstPeriodCents: offer.offer.firstPeriodCents,
          schedule: offer.offer.schedule,
        }
      : null,
  })
  if (!started.ok) {
    return { status: 'error', message: t('err.reservationUnitGone'), fieldErrors: {} }
  }

  redirect(`/checkout?token=${encodeURIComponent(started.token)}`)
}

/// B-427. Moves the hold to another move-in date, in place. The rate is
/// re-quoted from the server's current web rate for that size, never from the
/// form, and the success sentence says whether it moved.
export async function changeMoveInDateAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const view = await reservationByToken(token)
  const inventory = view ? await publicInventoryForFacility(view.facility.slug) : null

  const result = await changeMoveInDate(
    token,
    String(formData.get('moveInDate') ?? ''),
    async (_facilityId, unitTypeId) =>
      inventory?.unitTypes.find((type) => type.unitTypeId === unitTypeId)?.webRateCents ?? null,
  )

  if (!result.ok) {
    const message =
      result.reason === 'out_of_window'
        ? t('err.reserveMoveInTooFar', { days: result.maxDays })
        : t('err.reservationNotLive')
    return { status: 'error', message, fieldErrors: {} }
  }

  revalidatePath('/reservations')
  return {
    status: 'success',
    message: t(result.rateChanged ? 'res.dateChangedRate' : 'res.dateChanged'),
  }
}
