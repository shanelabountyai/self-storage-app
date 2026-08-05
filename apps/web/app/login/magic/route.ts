import { NextResponse } from 'next/server'
import { AuthError } from 'next-auth'
import { auth, signIn } from '@/auth'
import { safeRedirectTarget } from '@/lib/auth/login-audience'

// PRD 01 US-701. The destination of the link `requestMagicLink` (lib/auth/
// flows.ts) emails — a GET, deliberately, the same way every major magic-link
// implementation works: consuming it only signs someone in (never a
// destructive action), and the token is already single-use with a 15-minute
// TTL (lib/auth/tokens.ts), so there is nothing here for 3.3.4's "confirm
// before an irreversible action" to protect against, unlike the reservation
// cancel link's deliberate two-step GET-then-POST.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  const from = url.searchParams.get('from') ?? undefined

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=magic_link_invalid', url.origin))
  }

  try {
    await signIn('magic-link', { token, redirect: false })
  } catch (error) {
    // Expired, already used, or never existed — consumeToken (lib/auth/tokens.ts)
    // treats all three identically, and so does this: nothing to enumerate.
    if (error instanceof AuthError) {
      return NextResponse.redirect(new URL('/login?error=magic_link_invalid', url.origin))
    }
    throw error
  }

  const session = await auth()
  const audience = session?.user.audience ?? 'tenant'
  return NextResponse.redirect(new URL(safeRedirectTarget(from, audience), url.origin))
}
