import { prisma } from '@storage/db'
import { facilityAccess } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

export const FACILITY_COOKIE = 'storage_facility'

export type SwitcherFacility = { id: string; name: string; slug: string }

/// Facilities the switcher may offer: every active facility for an
/// all-facilities actor, or exactly the ones they're assigned to. Never wider
/// than facilityAccess() — this is the same fail-closed contract as
/// facilityScope(), just resolved into rows the switcher can render.
export async function switcherFacilities(actor: Actor): Promise<SwitcherFacility[]> {
  const access = facilityAccess(actor)
  if (!access.all && access.facilityIds.length === 0) return []

  return prisma.facility.findMany({
    where: {
      status: 'active',
      ...(access.all ? {} : { id: { in: access.facilityIds } }),
    },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  })
}

export function canSeeAllFacilities(actor: Actor): boolean {
  return facilityAccess(actor).all
}
