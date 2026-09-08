import Link from 'next/link'
import { ProsePage } from '@/components/site/prose-page'
import { cancelWaitlist } from '@/lib/waitlist/service'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { writingLocale } from '@/lib/i18n/server'

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
//
// ── B-274: the language comes from the ENTRY, not from the cookie ───────────
//
// This page is reached from an email link, which is the one journey on the
// public site where the cookie is the WRONG source. B-265 wrote that mail in
// the language stored on the waitlist entry, and the link in it is routinely
// opened somewhere the cookie does not exist — a phone, a webmail tab, a
// browser that has never seen the facility page. Reading `st_locale` there
// answers English to somebody who was just written to in Spanish.
//
// So it is `writingLocale` (D-130), the same three-step rule the mail itself
// used, applied to the reply: what they told us when they joined, else the
// language of this request, else English. An unknown token has no entry to read
// and falls to step 2 by itself — which is why `cancelWaitlist` hands back the
// raw column rather than a resolved `Locale`.
//
// `ProsePage` gets `lang={locale}` because the shell above it does NOT: the
// root layout sets `<html lang>` from the cookie, so a Spanish entry opened in
// an English browser renders Spanish prose inside `lang="en"` unless the prose
// says otherwise (SC 3.1.2). That is the whole reason the prop is required.

// Deliberately still English, and the only English left on this page. A
// translated `<title>` would need `generateMetadata`, which cannot read the
// entry without calling `cancelWaitlist` a second time — and that function
// MUTATES. Next runs metadata and the page in the same request, so the
// alternative is a second write on every visit to save one word in a browser
// tab on a `noindex` page nobody links to.
export const metadata = { title: 'Waitlist', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function WaitlistCancelPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const result = await cancelWaitlist(token)
  const locale = await writingLocale(result.stated)
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey) => translate(dict, key)

  return (
    <ProsePage
      lang={locale}
      title={t('wait.cancelTitle')}
      intro={result.ok ? t('wait.cancelOff') : t('wait.cancelUnknown')}
    >
      {result.ok ? (
        <p>{result.alreadyClosed ? t('wait.cancelAlready') : t('wait.cancelDone')}</p>
      ) : (
        <p>{t('wait.cancelBadLink')}</p>
      )}

      <p>
        <Link href="/storage/search" className="underline underline-offset-4">
          {t('wait.findStorage')}
        </Link>
      </p>
    </ProsePage>
  )
}
