import { NextResponse, type NextRequest } from 'next/server'
import { LOCALE_COOKIE, LOCALE_COOKIE_DAYS } from '@/lib/i18n'
import { expiredPayLink } from '@/lib/portal/pay-links'

// B-336. Where `/pay/<token>` and its done screen send a link they refuse.
//
// A route handler rather than a redirect from the page because it has to set a
// cookie, and a page cannot. The cookie is how `/login` — its `<html lang>`,
// its layout and its body, which all read the cookie — speaks the language the
// reminder was written in, and it carries on into `/portal/pay` after sign-in.
// It is only set when the tenant told us a language; otherwise the visitor's
// own cookie is already the answer `payLinkLocale` would have given.
//
// CN-4's "into the payment screen": the lease rides in `from`, which
// `safeRedirectTarget` accepts because it is a same-origin path.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const expired = await expiredPayLink(token)

  // Revoked, ended or never existed: today's landing, with nothing that tells
  // one from another.
  if (!expired) return NextResponse.redirect(new URL('/login?from=/portal', request.url))

  const from = encodeURIComponent(`/portal/pay?lease=${expired.leaseId}`)
  const response = NextResponse.redirect(
    new URL(`/login?from=${from}&reason=pay_link_expired`, request.url),
  )
  if (expired.locale) {
    // Same attributes as `setLocaleAction`: a display preference, not a credential.
    response.cookies.set(LOCALE_COOKIE, expired.locale, {
      path: '/',
      maxAge: LOCALE_COOKIE_DAYS * 24 * 60 * 60,
      sameSite: 'lax',
      httpOnly: false,
    })
  }
  return response
}
