import { cache } from 'react'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { requireStaffActor } from '@/lib/rbac/session'
import { currentImpersonation } from '@/lib/impersonation/context'
import { FACILITY_COOKIE, canSeeAllFacilities, switcherFacilities } from './facility-selection'

// `cache()` memoizes per request (React's server-components request cache), so
// the layout and a page can both ask "who is this and what can they see"
// without doubling the DB round-trips within one render.

export const getAdminActor = cache(() => requireStaffActor())

export const getSwitcherData = cache(async () => {
  const [actor, session, store, impersonation] = await Promise.all([
    getAdminActor(),
    auth(),
    cookies(),
    currentImpersonation(),
  ])
  const facilities = await switcherFacilities(actor)
  return {
    actor,
    // PRD 09 G1 (B-091 part 2). The header names whoever the screen is being
    // rendered as. `session.user.name` is the impersonator, and showing it
    // beside a dashboard scoped to somebody else is the exact confusion the
    // banner exists to prevent — the banner names the real human.
    userName: impersonation?.subjectName || session?.user?.name || session?.user?.email || 'Staff',
    facilities,
    cookieValue: store.get(FACILITY_COOKIE)?.value,
    canSeeAll: canSeeAllFacilities(actor),
  }
})
