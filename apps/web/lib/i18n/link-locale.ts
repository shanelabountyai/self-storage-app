import { cache } from 'react'
import { headers } from 'next/headers'
import { prisma } from '@storage/db'
import { verifyCheckoutResumeToken } from '@/lib/checkout/resume-token'
import { verifyUnsubscribeToken } from '@/lib/comms/unsubscribe-token'
import { MESSAGE_LINK_HEADER, MESSAGE_LINK_PATH, type Locale } from './index'
import { getLocale, writingLocale } from './server'

// B-321. B-265, B-270 and B-273 made the abandonment, waitlist and marketing
// emails speak the reader's language; the pages their links open did not. This
// is B-283's `payLinkLocale` for those three: the language comes from the
// record the token names — whatever the visitor's cookie says — so a Spanish
// email no longer opens an English confirmation of the one thing they did.
//
// Each route reads the same fact its email was written from:
//   - `/checkout/resume/<token>`: the session's tenant, which is the recipient
//     `checkout.abandonment_step` is raised against.
//   - `/waitlist/cancel/<token>`: the entry's own `preferredLocale` (B-265).
//   - `/unsubscribe/<token>`: the language signed into the token at send time,
//     because the token names an address and an address has no language.
//
// A token that names nothing — forged, expired, pre-B-321 — falls through to
// the ordinary cookie rule, which is what the page said before this.

/// The language of the page at `path`, or the cookie's when `path` is not one
/// of the three. `cache`d because the root layout, the `(public)` layout,
/// `generateMetadata` and the page body all ask, and the answer is one query.
export const messageLinkLocale = cache(async (path: string): Promise<Locale> => {
  const match = MESSAGE_LINK_PATH.exec(path)
  if (!match) return getLocale()
  // Not URI-decoded: all three tokens are base64url, so the path already holds
  // them verbatim, and a stray `%` in a forged one must not throw here.
  const [, route, token] = match

  if (route === 'unsubscribe') {
    const verdict = verifyUnsubscribeToken(token)
    return writingLocale(verdict.valid ? verdict.locale : null)
  }

  if (route === 'waitlist/cancel') {
    const entry = await prisma.waitlistEntry.findUnique({
      where: { cancelToken: token },
      select: { preferredLocale: true },
    })
    return writingLocale(entry?.preferredLocale)
  }

  const verdict = verifyCheckoutResumeToken(token)
  const session = verdict.valid
    ? await prisma.checkoutSession.findUnique({
        where: { id: verdict.sessionId },
        select: { tenant: { select: { preferredLocale: true } } },
      })
    : null
  return writingLocale(session?.tenant?.preferredLocale)
})

/// The locale for the current request: the message link's when the proxy
/// marked it as one, the cookie's otherwise.
export async function requestLinkLocale(): Promise<Locale> {
  const path = (await headers()).get(MESSAGE_LINK_HEADER)
  return path ? messageLinkLocale(path) : getLocale()
}
