import { NextResponse, type NextRequest } from 'next/server'

// A shared password in front of the whole site, for a deployment that is real
// but not meant to be seen yet. NOT the application's authentication — sign-in,
// RBAC and MFA are all untouched behind it.
//
// It lives here because Vercel cannot do it on a Pro plan: Vercel
// Authentication covers production deployments only on Enterprise, and Password
// Protection is a paid add-on. It is also better suited than the platform
// feature, for one reason — Vercel's protection blocks inbound webhooks
// indiscriminately, so enabling it would break Twilio and Stripe on go-live and
// force a bypass secret smuggled through a query parameter, which then changes
// the URL Twilio signs. The exemptions below avoid that: every path let through
// proves who is calling on its own terms.
//
// Unset `DEMO_ACCESS_PASSWORD` and this is inert, which is what local
// development, CI and a genuinely public launch all want.

/// Paths that must stay reachable without the password: the cron checks
/// `CRON_SECRET`, the four webhooks verify a provider signature, and
/// `/api/auth` is what the login form itself posts to — gating that would lock
/// out the very people the password is meant to let in.
const GATE_EXEMPT = [
  '/api/cron',
  '/api/stripe/webhook',
  '/api/comms/webhook',
  '/api/comms/sms-webhook',
  '/api/hardware/webhook',
  '/api/auth',
]

/// Length-independent comparison, so a wrong guess cannot be narrowed by timing
/// it. `crypto.timingSafeEqual` is Node-only and this runs on the edge runtime.
function passwordMatches(supplied: string, expected: string): boolean {
  if (supplied.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < supplied.length; i++) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

/// Returns a 401 to send instead of handling the request, or null to carry on.
export function demoGate(request: NextRequest): NextResponse | null {
  const password = process.env.DEMO_ACCESS_PASSWORD
  if (!password) return null

  const { pathname } = request.nextUrl
  if (GATE_EXEMPT.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return null
  }

  const header = request.headers.get('authorization')
  if (header?.startsWith('Basic ')) {
    // Basic rather than a login page and a cookie: the browser owns the prompt,
    // there is no form to build, no session to store and no CSRF surface — and
    // this is not protecting anything the app's own auth does not already
    // protect properly.
    let decoded = ''
    try {
      decoded = atob(header.slice('Basic '.length))
    } catch {
      // Malformed base64 is a failed attempt, not a crash.
    }
    // The username is ignored; anything will do.
    if (passwordMatches(decoded.slice(decoded.indexOf(':') + 1), password)) return null
  }

  return new NextResponse('Not available.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Demo", charset="UTF-8"',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
