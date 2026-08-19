import { cache } from 'react'
import { cookies } from 'next/headers'
import { prisma } from '@storage/db'
import { auth } from '@/auth'
import { loadStaffActor, type Actor } from '@/lib/rbac/actor'
import { IMPERSONATION_COOKIE } from './request'
import { validateImpersonationSession } from './service'

/// PRD 09 §6 (B-091 part 2). Resolving the live session for the current
/// request, and the actor swap that makes G1 ("reproduce the user's exact
/// view") true.

export type ActiveImpersonation = {
  sessionId: string
  /// The impersonator — the real human, who is never replaced (§6.1).
  impersonatorStaffId: string
  subjectType: 'tenant' | 'staff'
  subjectId: string
  /// What the request actually runs as. Resolved through the ordinary
  /// `loadStaffActor()` / tenant path (§6.3), never by widening the
  /// impersonator's own actor — that would be the bypass D-12 forbids.
  subjectActor: Actor
  subjectName: string
  expiresAt: Date
}

/// `cache()` memoizes per request the same way `getAdminActor()` does: the
/// proxy, the layout, the banner and every `currentActor()` call in one render
/// otherwise re-read the row and re-run the guard several times each.
export const currentImpersonation = cache(async (): Promise<ActiveImpersonation | null> => {
  const store = await cookies()
  const sessionId = store.get(IMPERSONATION_COOKIE)?.value
  if (!sessionId) return null

  const session = await auth()
  // Impersonation is something a STAFF member does. A tenant session carrying
  // this cookie is either forged or left over from a staff sign-out on the same
  // browser; neither is impersonating anybody.
  if (!session?.user?.id || session.user.audience !== 'staff') return null

  const validated = await validateImpersonationSession(sessionId)
  if (!validated.ok) return null

  // The binding check, and the reason the cookie needs no signature of its own:
  // the row names who started it, and the JWT names who is asking. A cookie
  // carrying somebody else's session id resolves to nothing.
  if (validated.session.impersonatorStaffId !== session.user.id) return null

  const { subjectType, subjectId } = validated.session
  const subject = await loadSubjectIdentity(subjectType, subjectId)
  // The guard inside `validateImpersonationSession` already refused a deleted
  // or suspended subject; this only fails if the row vanished between the two
  // reads.
  if (!subject) return null

  return {
    sessionId: validated.session.id,
    impersonatorStaffId: validated.session.impersonatorStaffId,
    subjectType,
    subjectId,
    subjectActor: subject.actor,
    subjectName: subject.name,
    expiresAt: validated.session.expiresAt,
  }
})

async function loadSubjectIdentity(
  subjectType: 'tenant' | 'staff',
  subjectId: string,
): Promise<{ actor: Actor; name: string } | null> {
  if (subjectType === 'tenant') {
    const tenant = await prisma.tenant.findUnique({
      where: { id: subjectId },
      select: { id: true, firstName: true, lastName: true },
    })
    if (!tenant) return null
    return {
      actor: { kind: 'tenant', tenantId: tenant.id },
      name: `${tenant.firstName} ${tenant.lastName}`.trim(),
    }
  }

  const [actor, staff] = await Promise.all([
    loadStaffActor(subjectId),
    prisma.staffUser.findUnique({
      where: { id: subjectId },
      select: { firstName: true, lastName: true, email: true },
    }),
  ])
  if (!actor || !staff) return null
  return { actor, name: `${staff.firstName} ${staff.lastName}`.trim() || staff.email }
}

/// True when the cookie is present but resolves to nothing — the session
/// expired, FR-9 ended it, or it was never valid.
///
/// It matters because an inert cookie is not harmless: the write block in
/// `proxy.ts` fires on the cookie's presence, so a staff member who walked away
/// for half an hour would come back unable to save anything, with no visible
/// reason. A Server Component cannot delete a cookie, so both shells redirect
/// through the end route instead, which can.
export async function hasStaleImpersonationCookie(): Promise<boolean> {
  const store = await cookies()
  if (!store.has(IMPERSONATION_COOKIE)) return false
  return (await currentImpersonation()) === null
}
