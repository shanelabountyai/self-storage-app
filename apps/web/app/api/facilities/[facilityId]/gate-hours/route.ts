import { prisma } from '@storage/db'
import { parseWeeklySchedule } from '@storage/core/facility-settings'
import { requireStaffActor } from '@/lib/rbac/session'
import { assertFacilityAccess, ForbiddenError } from '@/lib/rbac/authorize'

// PRD 02 US-3 AC: "gate hours are exposed via API for PRD [hardware]" — this is
// that contract point. The hardware module (B-064's gate-hours enforcement,
// B-027's access control service) is the intended caller once it exists;
// until then, staff auth is the only consumer, gated on facility assignment
// rather than the 'facility:settings' write permission — reading hours is not
// the same privilege as changing them.
export async function GET(
  _request: Request,
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

  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { id: true, timezone: true, officeHours: true, gateHours: true },
  })
  if (!facility) return Response.json({ error: 'not_found' }, { status: 404 })

  return Response.json({
    facilityId: facility.id,
    timezone: facility.timezone,
    officeHours: parseWeeklySchedule(facility.officeHours),
    gateHours: parseWeeklySchedule(facility.gateHours),
  })
}
