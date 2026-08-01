import { redirect } from 'next/navigation'
import { facilityPath, publicFacilityBySlug } from '@/lib/facility/public-facility'
import { publicInventoryForFacility } from '@/lib/inventory/public-inventory'
import { startCheckout } from '@/lib/checkout/session'

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

  const started = await startCheckout({
    facilityId: facility.id,
    unitTypeId,
    // Rate seen = rate charged: locked from the server's current view, never
    // from anything the browser posted.
    quotedRateCents: unitType.webRateCents,
  })

  // Someone took the last one while they were reading. Honest, and back to the
  // list rather than into a checkout that cannot complete.
  if (!started.ok) redirect(`${facilityPath(facility)}?soldout=1`)

  redirect(`/checkout?token=${encodeURIComponent(started.token)}`)
}
