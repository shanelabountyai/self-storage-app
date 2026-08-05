import { auth } from '@/auth'
import { loadStaffActor, type Actor } from './actor'
import { ForbiddenError } from './authorize'

/// Resolves the signed-in actor. Returns null when there is no session, so
/// callers must decide between "anonymous is fine" and requireActor().
export async function currentActor(): Promise<Actor | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  if (session.user.audience === 'staff') {
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

export async function requireStaffActor(): Promise<Extract<Actor, { kind: 'staff' }>> {
  const actor = await requireActor()
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff access required')
  return actor
}

export async function requireTenantActor(): Promise<Extract<Actor, { kind: 'tenant' }>> {
  const actor = await requireActor()
  if (actor.kind !== 'tenant') throw new ForbiddenError('Tenant access required')
  return actor
}
