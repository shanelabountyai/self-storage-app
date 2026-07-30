import type { Prisma } from '@storage/db'
import { resolveFacilityFilter } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

export type UnitFilters = {
  status?: Prisma.UnitWhereInput['status']
  unitTypeId?: string
  building?: string
  floor?: number
  /// Matches unit number, case-insensitively.
  search?: string
}

/// One definition of "which units does this filter select", shared by the list
/// view, the grid view, and bulk operations. Keeping it in one place is what
/// makes "select by filter → bulk edit" (US-7) safe: the rows the operator saw
/// are provably the rows the operation will consider.
///
/// Always spreads resolveFacilityFilter first, so a bulk edit can never reach
/// a facility the actor lacks even if a facilityId is posted directly.
export function unitWhere(
  actor: Actor,
  facilityId: string,
  filters: UnitFilters = {},
): Prisma.UnitWhereInput {
  return {
    ...resolveFacilityFilter(actor, facilityId),
    ...(filters.status && { status: filters.status }),
    ...(filters.unitTypeId && { unitTypeId: filters.unitTypeId }),
    ...(filters.building && { building: filters.building }),
    ...(filters.floor !== undefined && { floor: filters.floor }),
    ...(filters.search && { number: { contains: filters.search, mode: 'insensitive' } }),
  }
}
