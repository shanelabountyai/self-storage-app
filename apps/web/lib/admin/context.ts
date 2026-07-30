import { cache } from 'react'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { requireStaffActor } from '@/lib/rbac/session'
import { FACILITY_COOKIE, canSeeAllFacilities, switcherFacilities } from './facility-selection'

// `cache()` memoizes per request (React's server-components request cache), so
// the layout and a page can both ask "who is this and what can they see"
// without doubling the DB round-trips within one render.

export const getAdminActor = cache(() => requireStaffActor())

export const getSwitcherData = cache(async () => {
  const [actor, session, store] = await Promise.all([getAdminActor(), auth(), cookies()])
  const facilities = await switcherFacilities(actor)
  return {
    actor,
    userName: session?.user?.name || session?.user?.email || 'Staff',
    facilities,
    cookieValue: store.get(FACILITY_COOKIE)?.value,
    canSeeAll: canSeeAllFacilities(actor),
  }
})
