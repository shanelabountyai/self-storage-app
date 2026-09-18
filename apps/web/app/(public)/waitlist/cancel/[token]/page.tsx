import type { Metadata } from 'next'
import Link from 'next/link'
import { ProsePage } from '@/components/site/prose-page'
import { dictionaryFor, translate } from '@/lib/i18n'
import { requestLinkLocale } from '@/lib/i18n/link-locale'
import { cancelWaitlist } from '@/lib/waitlist/service'

// PRD 01 §9 Phase 3 (B-090 part 1). Taking yourself off a waitlist.
//
// **A GET that mutates, deliberately, and this is the one place that is right.**
// The recipient is not a tenant and has no account to sign in to, so the link in
// the email is the entire authorisation they have — the same shape as the
// reservation cancel link and every unsubscribe link there has ever been. A
// POST-behind-a-button would mean an interstitial, and an interstitial on an
// unsubscribe is a dark pattern.
//
// Safe because the token is 32 random bytes and the action is idempotent and
// non-destructive: the worst a prefetcher can do is take somebody off a list
// they asked to leave.

// B-321. In the language the entry was joined in — the one its "a unit came
// free" mail was written in (`messageLinkLocale`) — not the cookie's.
export async function generateMetadata(): Promise<Metadata> {
  const dict = dictionaryFor(await requestLinkLocale())
  return { title: translate(dict, 'wlcancel.title'), robots: { index: false, follow: false } }
}
export const dynamic = 'force-dynamic'

export default async function WaitlistCancelPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  // Resolved before the cancel, though the order does not matter: cancelling
  // changes the entry's status, never its `preferredLocale`.
  const dict = dictionaryFor(await requestLinkLocale())
  const result = await cancelWaitlist(token)

  return (
    <ProsePage
      title={translate(dict, 'wlcancel.title')}
      intro={translate(dict, result.ok ? 'wlcancel.removed' : 'wlcancel.notFound')}
    >
      <p>
        {translate(
          dict,
          !result.ok ? 'wlcancel.notFoundBody' : result.alreadyClosed ? 'wlcancel.alreadyOff' : 'wlcancel.offBody',
        )}
      </p>

      <p>
        <Link href="/storage/search" className="underline underline-offset-4">
          {translate(dict, 'wlcancel.findStorage')}
        </Link>
      </p>
    </ProsePage>
  )
}
