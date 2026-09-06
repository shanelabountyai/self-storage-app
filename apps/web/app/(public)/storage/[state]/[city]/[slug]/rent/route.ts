import { redirect } from 'next/navigation'
import { facilityPath, publicFacilityBySlug } from '@/lib/facility/public-facility'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import { startCheckout } from '@/lib/checkout/session'
import { offerFor } from '@/lib/promotions/service'
import { cookies } from 'next/headers'
import { REFERRAL_COOKIE } from '@storage/core/marketing'

import { getLocale } from '@/lib/i18n/server'
import { localePath } from '@/lib/i18n/routing'
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

  // B-262. Every redirect below has to land in the language the renter was
  // reading. This POST arrives at `/es/storage/.../rent` and the proxy stamps
  // the locale on it like any other request, so the answer is available here —
  // what was missing was using it. A Spanish renter pressing "Rentar ahora"
  // landed on the ENGLISH checkout, which is the exact failure this row exists
  // to end, at the exact moment it costs most.
  const locale = await getLocale()

  const facility = await publicFacilityBySlug(slug)
  if (!facility) redirect(localePath(locale, '/storage/search'))

  const inventory = await publicInventoryForFacility(slug)
  const unitType = inventory?.unitTypes.find((type) => type.unitTypeId === unitTypeId)
  if (!unitType) redirect(localePath(locale, `${facilityPath(facility)}?unavailable=1`))

  // The promotion the facility page just advertised, re-evaluated here from the
  // server's own view rather than accepted from the form. Without this the card
  // said "50% off your first month" and the checkout quoted, summarised and
  // charged the full rate — the browse estimate applied a promotion the money
  // path had never heard of, and nothing ever wrote a redemption row either.
  //
  // `isNewTenant: true` matches what the facility page assumed when it drew the
  // badge; the real person is not known until step 1, and provisioning
  // re-checks eligibility before anything is redeemed.
  // B-122: the code the renter typed on the facility page rides along in the
  // form, and is RE-EVALUATED here rather than trusted. The form carries the
  // string only — never a discount, a promotion id or an amount — so the worst
  // a hand-crafted POST can do is name a code that this call then judges on its
  // own terms, exactly as if it had been typed into the box.
  const offer = await offerFor({
    facilityId: facility.id,
    unitTypeId,
    monthlyRateCents: unitType.webRateCents,
    isNewTenant: true,
    code: String(form.get('promo') ?? '').trim() || null,
  })

  // PRD 10 FR-REF-3 (B-100). The referral this visitor arrived on, read here
  // — the one point in the flow that has both a request (so cookies) and the
  // session about to be created. Carried as an id only; whether it actually
  // pays is judged at qualification, against rules this route knows nothing
  // about.
  const referralInviteId = (await cookies()).get(REFERRAL_COOKIE)?.value ?? null

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
    referralInviteId,
  })

  // Someone took the last one while they were reading. Honest, and back to the
  // list rather than into a checkout that cannot complete.
  if (!started.ok) redirect(localePath(locale, `${facilityPath(facility)}?soldout=1`))

  redirect(localePath(locale, `/checkout?token=${encodeURIComponent(started.token)}`))
}
