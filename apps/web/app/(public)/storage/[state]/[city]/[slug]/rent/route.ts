import { redirect } from 'next/navigation'
import { facilityPath, publicFacilityBySlug } from '@/lib/facility/public-facility'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import { startCheckout } from '@/lib/checkout/session'
import { offerFor } from '@/lib/promotions/service'

// B-020. "Rent now" — starts a checkout session and redirects into the stepper.
//
// A route handler rather than a page: starting a checkout takes a unit off the
// market, and that must be a deliberate act with one effect. As a page it would
// run on every prefetch and every back-button visit, quietly locking units for
// people who only hovered a link.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params
  const form = await request.formData()
  const unitTypeId = String(form.get('unitTypeId') ?? '')

  const facility = await publicFacilityBySlug(slug)
  if (!facility) redirect('/storage/search')

  const inventory = await publicInventoryForFacility(slug)
  const unitType = inventory?.unitTypes.find((type) => type.unitTypeId === unitTypeId)
  if (!unitType) redirect(`${facilityPath(facility)}?unavailable=1`)

  // The promotion the facility page just advertised, re-evaluated here from the
  // server's own view rather than accepted from the form. Without this the card
  // said "50% off your first month" and the checkout quoted, summarised and
  // charged the full rate — the browse estimate applied a promotion the money
  // path had never heard of, and nothing ever wrote a redemption row either.
  //
  // `isNewTenant: true` matches what the facility page assumed when it drew the
  // badge; the real person is not known until step 1, and provisioning
  // re-checks eligibility before anything is redeemed.
  const offer = await offerFor({
    facilityId: facility.id,
    unitTypeId,
    monthlyRateCents: unitType.webRateCents,
    isNewTenant: true,
  })

  const started = await startCheckout({
    facilityId: facility.id,
    unitTypeId,
    // Rate seen = rate charged: locked from the server's current view, never
    // from anything the browser posted.
    quotedRateCents: unitType.webRateCents,
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

  // Someone took the last one while they were reading. Honest, and back to the
  // list rather than into a checkout that cannot complete.
  if (!started.ok) redirect(`${facilityPath(facility)}?soldout=1`)

  redirect(`/checkout?token=${encodeURIComponent(started.token)}`)
}
