import { requireStaffActor } from '@/lib/rbac/session'
import { auctionLotSheet } from '@/lib/auctions/service'
import { toCsv } from '@/lib/admin/csv'

// PRD 02 §4.6 US-30 (B-129). The structured lot sheet an operator uploads to a
// marketplace, hands to an auctioneer, or reads to a newspaper.
//
// Same `auctionLotSheet` call the auctions screen makes, so the file and the
// screen's refusal list cannot disagree about which sales are advertisable —
// and the screen is where an operator finds out that three of their five
// scheduled sales are not on the sheet, which a short CSV would not tell them.
//
// **Nothing here writes an `AuctionAdvertisement` row.** Downloading a sheet is
// not evidence that an advertisement ran; that row stays typed by the person
// who placed the ad, with the publication and the tear sheet (B-062, D-63).
//
// `force-dynamic` because readiness is live: a tenant who paid this morning
// must drop off the sheet this afternoon, and a cached copy is exactly the
// advertisement that gets a sale challenged.
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const actor = await requireStaffActor()
  const facilityId = new URL(request.url).searchParams.get('facility')
  if (!facilityId) return new Response('facility is required', { status: 400 })

  const sheet = await auctionLotSheet(actor, facilityId)
  if (!sheet) return new Response('Not found', { status: 404 })

  const { facility } = sheet
  const address = [facility.addressLine1, facility.addressLine2].filter(Boolean).join(', ')

  const csv = toCsv(
    [
      'Lot',
      'Facility',
      'Address',
      'City',
      'State',
      'ZIP',
      'Unit',
      'Size',
      'Width ft',
      'Length ft',
      'Sq ft',
      'Sale date',
      'Terms',
      'Case reference',
    ],
    sheet.lots.map((lot, index) => [
      index + 1,
      facility.name,
      address,
      facility.city,
      facility.state,
      facility.postalCode,
      lot.unitNumber,
      lot.unitTypeName,
      lot.widthFt,
      lot.lengthFt,
      lot.squareFeet,
      // The sale is "on the 14th" — a facility-local calendar day, stored as a
      // DATE. `toISOString` is safe for exactly that reason and would not be
      // for a timestamp.
      lot.scheduledSaleDate.toISOString().slice(0, 10),
      // Blank when nobody has set them. The screen says so; the file does not
      // invent a term the operator never agreed to.
      facility.saleTerms ?? '',
      lot.caseId,
    ]),
  )

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="auction-lots-${facilityId}.csv"`,
      'cache-control': 'private, no-store',
    },
  })
}
