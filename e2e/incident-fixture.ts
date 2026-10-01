import { prisma } from '../packages/db'
import { DEMO_STAFF_EMAIL } from '../apps/web/scripts/demo-credentials'

// B-424. `/admin/incidents/[id]` needs a real incident. Written straight to
// the table rather than through `recordIncident`, on purpose (B-120): the
// real path raises a task on a shared demo tenant and an audit row that can
// never be deleted. This row raises neither and is removed in `afterAll`.
export async function createIncidentFixture() {
  const facility = await prisma.facility.findFirstOrThrow({ where: { slug: 'demo-austin-south' }, select: { id: true } })
  const staff = await prisma.staffUser.findUniqueOrThrow({ where: { email: DEMO_STAFF_EMAIL }, select: { id: true } })
  const lease = await prisma.lease.findFirstOrThrow({
    where: { facilityId: facility.id, status: 'active' },
    select: { id: true, unitId: true },
  })
  const incident = await prisma.incident.create({
    data: {
      facilityId: facility.id,
      type: 'break_in',
      windowStart: new Date('2026-09-10T02:00:00.000Z'),
      windowEnd: new Date('2026-09-10T08:00:00.000Z'),
      description: 'e2e fixture — locks cut overnight',
      gateLogExcerpt: [
        {
          occurredAt: '2026-09-10T03:15:00.000Z',
          result: 'denied',
          reason: 'unknown_code',
          flags: [],
          tenantName: null,
          unitNumber: null,
          entryMethod: null,
        },
      ],
      recordedByStaffId: staff.id,
      units: { create: [{ unitId: lease.unitId, leaseId: lease.id }] },
    },
  })
  return {
    id: incident.id,
    async cleanup() {
      await prisma.incident.delete({ where: { id: incident.id } })
      await prisma.$disconnect()
    },
  }
}
