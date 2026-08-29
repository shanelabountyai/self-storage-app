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

  // B-205. No generated `Lot` column.
  //
  // It used to be `index + 1` over whatever passed readiness at that moment,
  // and readiness is deliberately live — a tenant paying, a hold landing or a
  // vehicle being recorded all drop a lot between one download and the next.
  // So "Lot 3" meant a different unit on Wednesday than it did on Monday, on a
  // document whose entire purpose is to be the public advertisement in a lien
  // sale. `Unit` and `Case reference` each identify a lot for its whole life
  // and neither is invented here. A sequential number an auctioneer can call
  // out has to be assigned once and stored on the case; that is a decision, not
  // a default, and it is not this.
  // The earliest sale on the sheet. Lots for one facility are normally one
  // sale; where they are not, the first date is the one the file is about.
  const saleDate = sheet.lots
    .map((lot) => lot.scheduledSaleDate.toISOString().slice(0, 10))
    .sort()[0]

  const csv = toCsv(
    [
      'Facility',
      'Address',
      'City',
      'State',
      'ZIP',
      'Unit',
      'Tenant',
      'Size',
      'Width ft',
      'Length ft',
      'Sq ft',
      'Sale date',
      'Sale time',
      'Terms',
      'Case reference',
    ],
    sheet.lots.map((lot) => [
      facility.name,
      address,
      facility.city,
      facility.state,
      facility.postalCode,
      lot.unitNumber,
      lot.tenantName,
      lot.unitTypeName,
      lot.widthFt,
      lot.lengthFt,
      lot.squareFeet,
      // The sale is "on the 14th" — a facility-local calendar day, stored as a
      // DATE. `toISOString` is safe for exactly that reason and would not be
      // for a timestamp.
      lot.scheduledSaleDate.toISOString().slice(0, 10),
      // Blank when unset, same as the terms — a sale time nobody chose is a
      // worse thing to print than an empty column somebody has to fill in.
      facility.saleTime ?? '',
      // Blank when nobody has set them. The screen says so; the file does not
      // invent a term the operator never agreed to.
      facility.saleTerms ?? '',
      lot.caseId,
    ]),
  )

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      // B-205. Named the way every other export here is: a person who
      // downloads three facilities' sheets in one afternoon needs to tell them
      // apart in Downloads, and an opaque cuid does not do that. Dated by the
      // sale the sheet is for, not by today — two downloads for the same sale
      // are the same document.
      'content-disposition': `attachment; filename="auction-lots-${facility.slug}-${saleDate}.csv"`,
      'cache-control': 'private, no-store',
    },
  })
}
