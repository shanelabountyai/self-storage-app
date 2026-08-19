/// PRD 09 FR-11/FR-13 (B-091 part 2). The read-only control, expressed as two
/// pure predicates so `proxy.ts` — which runs on the Edge runtime and cannot
/// touch Prisma — can apply them, and so they are testable without a request.

/// Carries the impersonation session id. httpOnly, and deliberately NOT the
/// authority: the row is (PRD 09 §6.1). The cookie only says "look one up", and
/// `currentImpersonation()` refuses any row whose `impersonatorStaffId` is not
/// the staff user the JWT already authenticated.
///
/// **A forged cookie can therefore only ever REDUCE access** — it fails the
/// binding check, so nothing is impersonated, while the write block below fires
/// on its mere presence. That asymmetry is why the edge layer is allowed to
/// decide from a cookie it cannot verify.
export const IMPERSONATION_COOKIE = 'storage.impersonation'

/// Paths that must keep working while a session is live, checked as prefixes.
///
/// `/api/impersonation/` is "Return to my account" — the way OUT cannot be
/// blocked by the thing it ends. It is a route handler rather than a server
/// action for exactly this reason: a server action POSTs to whatever page it
/// was rendered on, so it has no stable path to exempt.
///
/// `/api/auth/` is sign-out (and the CSRF token it needs). Being unable to sign
/// out is a worse failure than anything the exemption allows: signing out
/// destroys the JWT, and with it the binding that makes the cookie mean
/// anything at all.
const WRITE_BLOCK_EXEMPT = ['/api/impersonation/', '/api/auth/']

/// FR-11: "every mutating server action and route handler refuses". Enforced by
/// method rather than by a list of actions, because a list is a thing a new
/// screen can be missing from — every server action in this app is a POST, and
/// there are 53 files of them.
///
/// FR-13 says the check is the control and hiding is a courtesy. This is the
/// control: it fires before any handler runs, so a page that forgets to hide a
/// button is still safe, and so is a page nobody has written yet.
export function isImpersonationWriteBlocked(
  method: string,
  pathname: string,
  hasImpersonationCookie: boolean,
): boolean {
  if (!hasImpersonationCookie) return false
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
  return !WRITE_BLOCK_EXEMPT.some((prefix) => pathname.startsWith(prefix))
}

/// The message FR-11 asks for: a refusal that names impersonation as the
/// reason, rather than a bare 403 that reads like a permissions bug.
export const IMPERSONATION_BLOCKED_MESSAGE =
  'This is a read-only support session, so nothing can be changed while it is running. Return to your own account first.'
