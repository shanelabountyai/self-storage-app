import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@storage/db'
import { auth } from '@/auth'
import { endImpersonation } from '@/lib/impersonation/service'
import { IMPERSONATION_COOKIE } from '@/lib/impersonation/request'

/// PRD 09 FR-5 (B-091 part 2). "Return to my account" — one click, no re-login,
/// because the real identity was never discarded (§6.1): the JWT is untouched
/// and only the cookie pointing at the session row goes away.
///
/// A route handler rather than a server action, and that is a consequence of
/// the write block rather than a preference. A server action POSTs to whatever
/// page rendered it, so it has no stable path for `WRITE_BLOCK_EXEMPT` to name
/// — the way out would be refused by the thing it ends.
async function handler(request: NextRequest): Promise<NextResponse> {
  const sessionId = request.cookies.get(IMPERSONATION_COOKIE)?.value
  const session = await auth()
  const staffUserId =
    session?.user?.audience === 'staff' && session.user.id ? session.user.id : null

  if (sessionId && staffUserId) {
    // Only ever your own. Ending somebody else's is FR-18's force-end, which is
    // permissioned (`impersonation:oversee`) and belongs to B-092 — a guessed
    // id must not become an unpermissioned way to do it.
    const row = await prisma.impersonationSession.findUnique({
      where: { id: sessionId },
      select: { impersonatorStaffId: true },
    })
    if (row?.impersonatorStaffId === staffUserId) {
      // Idempotent by construction (a conditional update), so the cleanup path
      // below costs nothing on a session that expiry or FR-9 already ended.
      await endImpersonation(sessionId, 'self', { endedByStaffId: staffUserId })
    }
  }

  const response = NextResponse.redirect(new URL('/admin', request.nextUrl.origin), {
    // 303: the POST must become a GET on the way to /admin.
    status: 303,
  })
  response.cookies.delete(IMPERSONATION_COOKIE)
  return response
}

export const POST = handler

/// The same handler on GET, for the cleanup case rather than the deliberate
/// one: a session that expired or that FR-9 ended leaves an inert cookie behind,
/// and an inert cookie still trips the write block for up to its remaining TTL.
/// The layouts redirect here when they find a staff user holding a cookie that
/// resolves to nothing, which is the only way a Server Component can get a
/// cookie deleted at all.
///
/// Safe as a GET because it can only end the caller's OWN session and is
/// idempotent — the two properties that make the usual objection to a mutating
/// GET apply.
export const GET = handler
