import { prisma } from '@storage/db'
import { LOCK_MINUTES } from '@/lib/checkout/session'

// SEC-04. Limits on what an anonymous caller can repeat for free. The knobs
// live here so there is one place to tune them, as `lib/auth/rate-limit.ts`
// does for login.
export const PUBLIC_LIMITS = {
  /// Checkouts one IP may start per lock window — so the most units a single
  /// address can hold off the market at once.
  checkoutStartsPerIp: 5,
  /// Checkouts started against one unit type per lock window, whatever the IP.
  /// The ceiling on what a spread of addresses can hold of one size.
  checkoutStartsPerUnitType: 20,
  checkoutWindowMs: LOCK_MINUTES * 60_000,
  /// Promo codes one IP may try. Every check counts, right or wrong.
  promoChecksPerIp: 20,
  promoWindowMs: 15 * 60_000,
  /// SEC-05. Sign-in and reset links one address may be sent, and one IP may
  /// ask for. The same numbers as login's `LIMITS`, for the same two reasons.
  authLinksPerEmail: 5,
  authLinksPerIp: 20,
  authLinkWindowMs: 15 * 60_000,
}

/// Records one attempt and answers whether it is within the limit.
///
/// Insert THEN count, never the reverse: a burst of parallel requests that each
/// counted first would all read zero and all pass. Written first, the k-th
/// insert to commit is counted by at least k of them, so at most `limit` get
/// through. The price is that refused attempts count too — a caller who keeps
/// hammering keeps the window full, which is the caller's problem.
///
// ponytail: counts rows in a window rather than keeping a token bucket, same
// as login. Swap for Redis/Upstash if the count ever shows up in a trace.
async function withinLimit(bucket: string, key: string, limit: number, windowMs: number): Promise<boolean> {
  await prisma.rateLimitEvent.create({ data: { bucket, key } })
  const count = await prisma.rateLimitEvent.count({
    where: { bucket, key, at: { gte: new Date(Date.now() - windowMs) } },
  })
  return count <= limit
}

/// The caller's address when it identifies somebody, else null.
///
/// **A caller with no remote address is not limited at all, per unit type
/// included.** The address is `x-forwarded-for`, which Vercel overwrites on
/// every request with the real client. Where no proxy sits in front, Next fills
/// it from the socket, so local dev and the e2e sweep (which starts ~50
/// checkouts against one facility) all arrive as loopback. Lumping those under
/// one key would throttle the suite, not an attacker. Self-hosting this behind
/// a proxy that does not set the header means running without these limits.
const LOOPBACK = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1'])
function remote(ipAddress: string | null): string | null {
  return ipAddress && !LOOPBACK.has(ipAddress) ? ipAddress : null
}

/// Whether this caller may start another checkout for this unit type.
export async function mayStartCheckout(ipAddress: string | null, unitTypeId: string): Promise<boolean> {
  const ip = remote(ipAddress)
  if (!ip) return true
  const { checkoutStartsPerIp, checkoutStartsPerUnitType, checkoutWindowMs } = PUBLIC_LIMITS
  // The IP first, and the unit type only for a caller the IP limit let through:
  // one address hammering one size must not spend that size's allowance for
  // everybody else.
  return (
    (await withinLimit('checkout-start:ip', ip, checkoutStartsPerIp, checkoutWindowMs)) &&
    (await withinLimit('checkout-start:unit-type', unitTypeId, checkoutStartsPerUnitType, checkoutWindowMs))
  )
}

/// Whether this caller may have another promo code judged.
export async function mayCheckPromo(ipAddress: string | null): Promise<boolean> {
  const ip = remote(ipAddress)
  if (!ip) return true
  return withinLimit('promo-check:ip', ip, PUBLIC_LIMITS.promoChecksPerIp, PUBLIC_LIMITS.promoWindowMs)
}

/// SEC-05. Whether another sign-in or reset link may be requested for this
/// address. One allowance across both kinds: each is a mail to the same inbox
/// and a fresh token to guess at.
///
/// The email limit holds for every caller, loopback included, and for an
/// address with no account: the caller answers the same either way, so a refusal
/// must not be the thing that tells them apart. The IP goes first so a refused
/// address cannot spend somebody else's allowance past its own 20.
export async function mayRequestAuthLink(email: string, ipAddress: string | null | undefined): Promise<boolean> {
  const { authLinksPerEmail, authLinksPerIp, authLinkWindowMs } = PUBLIC_LIMITS
  const ip = remote(ipAddress ?? null)
  if (ip && !(await withinLimit('auth-link:ip', ip, authLinksPerIp, authLinkWindowMs))) return false
  return withinLimit('auth-link:email', email.trim().toLowerCase(), authLinksPerEmail, authLinkWindowMs)
}

/// Nothing here is read past its window. Called from the hourly cron.
export async function pruneRateLimitEvents(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const { count } = await prisma.rateLimitEvent.deleteMany({
    where: { at: { lt: new Date(Date.now() - olderThanMs) } },
  })
  return count
}
