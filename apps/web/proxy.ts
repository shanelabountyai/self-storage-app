import NextAuth from 'next-auth'
import { NextResponse, type NextRequest } from 'next/server'
import {
  ATTRIBUTION_COOKIE_DAYS,
  canonicalPath,
  encodeTouch,
  FIRST_TOUCH_COOKIE,
  isNoindexPath,
  LAST_TOUCH_COOKIE,
  touchFrom,
} from '@storage/core/marketing'
import { authConfig } from '@/auth.config'
import { demoGate } from '@/lib/demo-gate'

// Kept here rather than imported from lib/analytics/track: that module pulls in
// Prisma, and the proxy runs on the Edge runtime where the Prisma client will
// not load. Duplicating two constants is the cheaper half of that trade; the
// test below pins them together.
const SESSION_COOKIE = 'st_sid'
const SESSION_MINUTES = 30

// The edge layer. Two unrelated jobs share it because Next allows exactly one
// proxy file, so they are kept visibly separate below rather than interleaved.
//
// 1. B-033: an authentication gate for /admin/* and /portal/*.
// 2. B-066: PRD 04 FR-SEO-2's canonical URL policy, applied site-wide.
//
// This builds its own NextAuth instance from the edge-safe authConfig rather
// than importing the app's `auth` from ./auth — that one adds providers whose
// authorize() functions import @storage/db, and Prisma's client is not
// Edge-Runtime compatible. Both instances read the same AUTH_SECRET, so a JWT
// either one issues is decodable by the other.
const { auth } = NextAuth(authConfig)

/// PRD 04 FR-SEO-2 / US-3 AC3: "no duplicate indexable URLs for the same
/// facility (trailing-slash, casing, and query-param variants canonicalize)."
///
/// Every variant a crawler can reach is a separate URL as far as an index is
/// concerned, and each one splits the ranking signal of the page they all point
/// at. Pure string work, because this runs on the edge on every request and
/// must not touch a database — the *redirect map* for renamed and retired slugs
/// needs a lookup and therefore lives on the 404 path instead, where only
/// requests that were already going to fail pay for it.
function seoResponse(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl
  const { target, isCanonical } = canonicalPath(pathname, search)

  if (!isCanonical) {
    const url = request.nextUrl.clone()
    const [path, query = ''] = target.split('?')
    url.pathname = path
    url.search = query
    // 308, not 301: permanent, and unlike 301 it is guaranteed to preserve the
    // method. A POST to a URL with a stray trailing slash — which a hand-typed
    // form action produces — must not silently become a GET, because the form
    // would appear to submit and quietly do nothing.
    const redirect = NextResponse.redirect(url, 308)
    // Attribution is captured BEFORE the redirect, and this ordering is
    // load-bearing rather than incidental. B-066's canonicalisation strips
    // exactly the parameters B-068 needs — `utm_*` and `gclid` are on the
    // tracking-param list — so every genuine ad click arrives as a
    // non-canonical URL and leaves as a 308. Writing the cookie only on the
    // second request would record `direct` for 100% of paid traffic, which is
    // the misattribution the whole channel-derivation exists to prevent.
    writeAttributionCookies(request, redirect)
    ensureSessionCookie(request, redirect)
    return redirect
  }

  const response = NextResponse.next()

  // PRD 04 FR-LEAD-2 (B-068): "First-touch UTMs + landing page persisted 90
  // days; last-touch updated each session."
  //
  // Written here rather than in a page, because a visitor who lands on a
  // facility page from an ad and then browses to three others must keep the
  // touch from the FIRST of those. A page-level writer would only see the page
  // it is on, and the honest first touch would be lost the moment they clicked
  // anything.
  //
  // First-party, `lax`, and not marked `httpOnly`: B-069's analytics wrapper
  // reads the same values client-side, and there is nothing here worth
  // protecting from a script that could not already be read off the URL.
  writeAttributionCookies(request, response)
  ensureSessionCookie(request, response)

  if (isNoindexPath(pathname)) {
    // A header rather than a meta tag, because it also covers routes that
    // return something other than HTML: a CSV export or a JSON response has
    // nowhere to put a `<meta>`.
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }
  return response
}

/// PRD 04 FR-AN-2 (B-069). A pseudonymous id for this visit.
///
/// Minted at the edge so the first page view of a session already has one —
/// a client-side mint would miss it, and the first page view is the top of the
/// funnel. Rolling 30 minutes: a session is a visit, not a person, and this is
/// deliberately NOT the 90-day attribution cookie. Merging them would turn a
/// short pseudonymous id into a long-lived one, which is a different privacy
/// claim than the one the banner makes.
///
/// Not gated on consent, and PRD 04 US-15 AC5 is explicit about why: "server-side
/// funnel events (first-party, pseudonymous) remain the reporting fallback when
/// consent is declined." Consent gates the third-party vendor, not first-party
/// counting.
function ensureSessionCookie(request: NextRequest, response: NextResponse): void {
  const existing = request.cookies.get(SESSION_COOKIE)?.value
  const value = existing && /^[a-z0-9-]{8,64}$/i.test(existing) ? existing : crypto.randomUUID()

  response.cookies.set(SESSION_COOKIE, value, {
    maxAge: SESSION_MINUTES * 60,
    sameSite: 'lax',
    path: '/',
    secure: request.nextUrl.protocol === 'https:',
  })
}

/// Records where this visit came from, if it is a visit worth recording.
function writeAttributionCookies(request: NextRequest, response: NextResponse): void {
  const params = request.nextUrl.searchParams
  const referrer = request.headers.get('referer')

  const touch = touchFrom({
    utmSource: params.get('utm_source'),
    utmMedium: params.get('utm_medium'),
    utmCampaign: params.get('utm_campaign'),
    gclid: params.get('gclid'),
    referrer,
    selfHost: request.nextUrl.hostname,
    landingPage: request.nextUrl.pathname,
  })

  // An internal click carries no new information: no campaign tags and a
  // referrer that is us. Writing it would overwrite a genuine last touch with
  // `direct` on the second page of every session — which is the single most
  // common way this kind of cookie ends up useless.
  const hasTags = Boolean(params.get('utm_source') || params.get('gclid'))
  const fromElsewhere =
    Boolean(referrer) && !referrer!.toLowerCase().includes(request.nextUrl.hostname.toLowerCase())
  if (!hasTags && !fromElsewhere) return

  const encoded = encodeTouch(touch)
  const options = {
    maxAge: ATTRIBUTION_COOKIE_DAYS * 86_400,
    sameSite: 'lax' as const,
    path: '/',
    secure: request.nextUrl.protocol === 'https:',
  }

  // First touch is written once and never overwritten — it is the whole reason
  // to keep two. The ad that closed somebody and the search that found them are
  // different spend, and letting the last one claim both is how an owner
  // defunds the channel that was working.
  if (!request.cookies.get(FIRST_TOUCH_COOKIE)) {
    response.cookies.set(FIRST_TOUCH_COOKIE, encoded, options)
  }
  response.cookies.set(LAST_TOUCH_COOKIE, encoded, options)
}

const gated = auth((request) => {
  const audience = request.auth?.user?.audience
  const requiredAudience = request.nextUrl.pathname.startsWith('/admin') ? 'staff' : 'tenant'

  if (audience !== requiredAudience) {
    const url = new URL('/login', request.nextUrl.origin)
    url.searchParams.set('from', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  return seoResponse(request)
})

export default function proxy(request: NextRequest, event: unknown) {
  const { pathname } = request.nextUrl

  // Before anything else, including the auth redirect: a deployment that is not
  // meant to be public should not reveal which paths exist by redirecting
  // differently for each one.
  const locked = demoGate(request)
  if (locked) return locked

  // Signed-in areas go through the auth gate first — being redirected to the
  // login page matters more than URL tidiness, and the gate ends by calling
  // `seoResponse` itself so the noindex header is still stamped.
  if (pathname.startsWith('/admin') || pathname.startsWith('/portal')) {
    return (gated as unknown as (r: NextRequest, e: unknown) => unknown)(request, event)
  }

  return seoResponse(request)
}

export const config = {
  // Everything except Next's internals and files with an extension. The
  // extension test is what keeps `/favicon.ico`, `/robots.txt` and
  // `/sitemap.xml` out — all three are served as-is, and none wants a
  // canonicalising redirect applied to it.
  matcher: ['/((?!_next/static|_next/image|.*\\.[^/]*$).*)'],
}
