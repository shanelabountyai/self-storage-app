import { prisma } from '@storage/db'
import { requireStaffActor } from '@/lib/rbac/session'
import { assertFacilityAccess, ForbiddenError } from '@/lib/rbac/authorize'
import { currentRatesForFacility } from '@/lib/pricing/unit-type-rates'

// PRD 02 US-9 AC: "current street rates are exposed via API." The intended
// consumers are the customer website (live pricing on facility pages) and
// comms (rate-change notices). Same auth posture as the gate-hours endpoint:
// staff session plus facility assignment. The *public*, unauthenticated
// pricing read with quote tokens is a different contract — B-014.
//
// `?asOf=` exists so a caller can ask what a rate will be on a future date,
// which is the question a scheduled rate change makes worth asking.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ facilityId: string }> },
) {
  const { facilityId } = await params

  try {
    const actor = await requireStaffActor()
    assertFacilityAccess(actor, facilityId)
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
    throw error
  }

  const asOfParam = new URL(request.url).searchParams.get('asOf')
  const asOf = asOfParam ? new Date(asOfParam) : new Date()
  if (Number.isNaN(asOf.getTime())) {
    return Response.json({ error: 'invalid_as_of' }, { status: 400 })
  }

  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { id: true },
  })
  if (!facility) return Response.json({ error: 'not_found' }, { status: 404 })

  const [unitTypes, rates] = await Promise.all([
    prisma.unitType.findMany({
      where: { facilityId },
      select: { id: true, name: true, widthFt: true, lengthFt: true },
      orderBy: { name: 'asc' },
    }),
    currentRatesForFacility(facilityId, asOf),
  ])

  return Response.json({
    facilityId,
    asOf: asOf.toISOString(),
    unitTypes: unitTypes.map((unitType) => {
      const rate = rates.get(unitType.id)
      return {
        unitTypeId: unitType.id,
        name: unitType.name,
        widthFt: unitType.widthFt,
        lengthFt: unitType.lengthFt,
        // Explicitly null rather than 0 when a type has no rate in effect —
        // a consumer must not be able to mistake "unpriced" for "free".
        streetRateCents: rate?.streetRateCents ?? null,
        webRateCents: rate?.webRateCents ?? null,
        effectiveFrom: rate?.effectiveFrom?.toISOString() ?? null,
      }
    }),
  })
}
