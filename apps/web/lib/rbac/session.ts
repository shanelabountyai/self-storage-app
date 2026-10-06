import { auth } from '@/auth'
import { needsMfaEnrollment } from '@/lib/auth/mfa'
import { currentImpersonation } from '@/lib/impersonation/context'
import { loadStaffActor, type Actor } from './actor'
import { ForbiddenError } from './authorize'

/// Resolves the signed-in actor. Returns null when there is no session, so
/// callers must decide between "anonymous is fine" and requireActor().
export async function currentActor(): Promise<Actor | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  if (session.user.audience === 'staff') {
    // PRD 09 §6.3 (B-091 part 2). THE actor swap, and deliberately the only
    // one: every screen and every service in this app resolves who is asking
    // through here, so an impersonated request runs as the subject everywhere
    // at once rather than in the places somebody remembered.
    //
    // The subject's authority is loaded through the ordinary path — this
    // returns an actor that is *exactly* the subject's, never the
    // impersonator's widened. `can()` is untouched (D-12, PRD 09 §3).
    const impersonation = await currentImpersonation()
    if (impersonation) return impersonation.subjectActor

    // Re-read from the database rather than trusting claims in the JWT: a role
    // revoked mid-session must not survive in a 30-day token.
    return loadStaffActor(session.user.id)
  }

  return { kind: 'tenant', tenantId: session.user.id }
}

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor()
  if (!actor) throw new ForbiddenError('Authentication required')
  return actor
}

/// A ForbiddenError, so every caller that already refuses on one refuses an
/// unenrolled staff member too. Its own class only so the admin layout can
/// send them to /mfa rather than to a login page they are already past.
export class MfaEnrollmentRequiredError extends ForbiddenError {
  constructor() {
    super('MFA enrolment required')
    this.name = 'MfaEnrollmentRequiredError'
  }
}

/// SEC-07. The enrolment check lives HERE, not only in the admin layout: a
/// layout guards a render, and a server action, a `*.csv` route and
/// `/api/facilities/*` are all reachable without one. `allowUnenrolled` is for
/// the /mfa screen and its three actions and nothing else — it is the one
/// place an unenrolled staff member has to be able to act.
///
/// Read from the database on every call rather than from a JWT claim, for the
/// reason the layout gives: a claim would outlive an administrator's reset.
export async function requireStaffActor(
  options: { allowUnenrolled?: boolean } = {},
): Promise<Extract<Actor, { kind: 'staff' }>> {
  const actor = await requireActor()
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff access required')
  if (!options.allowUnenrolled && (await needsMfaEnrollment(actor.staffUserId))) {
    throw new MfaEnrollmentRequiredError()
  }
  return actor
}

export async function requireTenantActor(): Promise<Extract<Actor, { kind: 'tenant' }>> {
  const actor = await requireActor()
  if (actor.kind !== 'tenant') throw new ForbiddenError('Tenant access required')
  return actor
}
