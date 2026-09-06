import { LocaleLink } from '@/components/site/locale-link'
import { ProsePage } from '@/components/site/prose-page'
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

export const metadata = { title: 'Waitlist', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function WaitlistCancelPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const result = await cancelWaitlist(token)

  return (
    <ProsePage
      title="Waitlist"
      intro={
        result.ok
          ? 'You are off the list.'
          : 'We could not find that waitlist link.'
      }
    >
      {result.ok ? (
        <p>
          {result.alreadyClosed
            ? 'You were already off this list — nothing more to do. We will not email you about this size again.'
            : 'We will not email you about this size again. Nothing else changes, and you can join again any time from the facility page.'}
        </p>
      ) : (
        <p>
          The link may have been used already, or it may have been cut in half by an email
          client. Nothing has changed either way — if you are still getting emails you do not
          want, reply to one and we will sort it out.
        </p>
      )}

      <p>
        <LocaleLink href="/storage/search" className="underline underline-offset-4">
          Find storage near you
        </LocaleLink>
      </p>
    </ProsePage>
  )
}
