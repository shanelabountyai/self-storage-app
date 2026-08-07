import NextAuth from 'next-auth'
import { NextResponse, type NextRequest } from 'next/server'
import { canonicalPath, isNoindexPath } from '@storage/core/marketing'
import { authConfig } from '@/auth.config'

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
    return NextResponse.redirect(url, 308)
  }

  const response = NextResponse.next()
  if (isNoindexPath(pathname)) {
    // A header rather than a meta tag, because it also covers routes that
    // return something other than HTML: a CSV export or a JSON response has
    // nowhere to put a `<meta>`.
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }
  return response
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
