import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { ATTRIBUTION_COOKIE_DAYS, REFERRAL_COOKIE } from '@storage/core/marketing'
import { usableInvite } from '@/lib/referrals/service'
import { facilityPath, publicFacilityBySlug } from '@/lib/facility/public-facility'

// PRD 10 FR-REF-3 (B-100). `/r/{code}` — a tenant's referral link.
//
// A route handler rather than a page: its whole job is to set a cookie and
// send the visitor somewhere, and there is nothing to render.
//
// ── Two things this route must never do ──────────────────────────────────────
//
// It must never show a stranger an error. §5.1's AC is explicit: "a redeemed or
// expired code lands the visitor on the facility page normally, with no error
// and no referral attached. A prospect must never see 'this code is dead' —
// that is a conversation between the business and the tenant, not something to
// fail a stranger's page load with." So every failure path here is a redirect
// to something useful, and `usableInvite` returning null is an ordinary
// outcome rather than an exception.
//
// And it must never leak who referred them. The cookie carries the CODE, not
// the referrer's id or name — the referee learning which of their friends gets
// paid for them is a conversation neither of them asked for.

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params
  const invite = await usableInvite(code)

  // No usable invite: send them to search rather than 404ing. Somebody typed a
  // code off a napkin wrong, or the invite is spent — either way they are a
  // prospect standing in the doorway, and the answer is the storefront.
  if (!invite) redirect('/storage/search')

  const facility = await publicFacilityBySlug(invite.facilitySlug)
  if (!facility) redirect('/storage/search')

  const store = await cookies()
  store.set(REFERRAL_COOKIE, invite.id, {
    maxAge: ATTRIBUTION_COOKIE_DAYS * 86_400,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })

  // FR-REF-3 AC: "referral attribution survives the canonical-URL redirect,
  // the same trap B-068 hit and fixed."
  //
  // Closed by CONSTRUCTION rather than by handling: `facilityPath` builds the
  // canonical path from the facility record itself, so the destination is
  // already canonical and the facility page has no reason to redirect again.
  // The alternative — sending them to a guessed or stored URL and letting the
  // page correct it — is exactly the shape that dropped B-068's attribution,
  // because a redirect is where a `Set-Cookie` on a 302 gets lost if anything
  // in the chain rewrites rather than forwards it.
  redirect(facilityPath(facility))
}
