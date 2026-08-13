import { NextResponse, type NextRequest } from 'next/server'

// A shared password in front of the whole site, for a deployment that is real
// but not meant to be seen yet.
//
// This is NOT the application's authentication — sign-in, RBAC and MFA are
// untouched behind it. It exists because Vercel cannot do this on a Pro plan:
// Vercel Authentication covers production deployments only on Enterprise, and
// Password Protection is a paid add-on. Twenty lines here cost nothing and work
// on any host.
//
// It is also *better* than the platform feature for this app, for one reason:
// Vercel's protection blocks inbound webhooks indiscriminately, so turning it on
// would break Twilio and Stripe the moment they go live and force a bypass
// secret smuggled through a query parameter — which then changes the URL Twilio
// signs. The exemptions below avoid that entirely: every path let through
// authenticates itself, by signature or by shared secret, and is refused on its
// own terms if it cannot.
//
// Unset `DEMO_ACCESS_PASSWORD` and this is inert, which is what local
// development, CI and a genuinely public launch all want.

/// Paths that must stay reachable without the password.
///
/// Each one already proves who is calling: the cron checks `CRON_SECRET`, the
/// four webhooks verify a provider signature, and `/api/auth` is what the login
/// form itself posts to — gating that would lock out the very people the
/// password is meant to let in.
const EXEMPT = [
  '/api/cron',
  '/api/stripe/webhook',
  '/api/comms/webhook',
  '/api/comms/sms-webhook',
  '/api/hardware/webhook',
  '/api/auth',
]

/// Length-independent comparison, so a wrong guess cannot be narrowed by timing
/// it. `crypto.timingSafeEqual` is Node-only and middleware runs on the edge
/// runtime, so this is the hand-rolled equivalent.
function matches(supplied: string, expected: string): boolean {
  if (supplied.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < supplied.length; i++) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

export function middleware(request: NextRequest) {
  const password = process.env.DEMO_ACCESS_PASSWORD
  if (!password) return NextResponse.next()

  const { pathname } = request.nextUrl
  if (EXEMPT.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next()
  }

  const header = request.headers.get('authorization')
  if (header?.startsWith('Basic ')) {
    // Basic rather than a login page and a cookie: the browser owns the prompt,
    // there is no form to build, no session to store and no CSRF surface — and
    // nothing here is protecting anything the app's own auth does not already
    // protect properly.
    let decoded = ''
    try {
      decoded = atob(header.slice('Basic '.length))
    } catch {
      // Malformed base64 — treat as a failed attempt, not a crash.
    }
    // The username is ignored; anything will do.
    const supplied = decoded.slice(decoded.indexOf(':') + 1)
    if (matches(supplied, password)) return NextResponse.next()
  }

  return new NextResponse('Not available.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Demo", charset="UTF-8"',
      // Belt and braces with robots.ts, which already refuses indexing while
      // there is no canonical domain.
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

export const config = {
  // Everything except Next.js's own static output, which carries no content
  // worth gating and would otherwise re-prompt on every asset.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
