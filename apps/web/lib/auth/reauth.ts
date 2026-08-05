import { auth } from '@/auth'
import { isFreshlyAuthenticated } from './reauth-freshness'

export { REAUTH_FRESH_SECONDS, isFreshlyAuthenticated } from './reauth-freshness'

// PRD 01 US-701: "sensitive actions (change payout of stored card, move-out)
// re-verify by fresh login or emailed code." Nothing in the codebase gates a
// sensitive action on this yet — B-036 (payment methods) and B-041 (move-out
// request) are the first real callers — so this ships the checkable primitive
// US-701 asks for, as this item's own scope, with no caller wired in until
// those land.
//
// "Emailed code" is implemented as the existing magic-link mechanism
// (`/reauth`), not a second, parallel short-code system: both prove control of
// the registered email, and a numeric code would duplicate `lib/auth/tokens.ts`
// for no added security value.

export type FreshAuthCheck = { fresh: true } | { fresh: false; reason: 'no_session' | 'stale' }

/// What a sensitive action calls before proceeding. Does not redirect itself —
/// the caller decides what "not fresh" means for it (a redirect to `/reauth`
/// with a `redirect` back-link, or simply refusing the action).
export async function checkFreshAuth(): Promise<FreshAuthCheck> {
  const session = await auth()
  if (!session?.user) return { fresh: false, reason: 'no_session' }
  return isFreshlyAuthenticated(session.user.authTime) ? { fresh: true } : { fresh: false, reason: 'stale' }
}
