import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { verifyCheckoutResumeToken } from '@/lib/checkout/resume-token'
import { reissueCheckoutToken } from '@/lib/checkout/session'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { requestLinkLocale } from '@/lib/i18n/link-locale'
import { SITE } from '@/lib/site-config'

// B-321. In the language of the abandonment email that linked here — the
// session's tenant's — not the cookie's (`messageLinkLocale`).
export async function generateMetadata(): Promise<Metadata> {
  const dict = dictionaryFor(await requestLinkLocale())
  return { title: translate(dict, 'resume.title'), robots: { index: false, follow: false } }
}

// PRD 04 US-9 AC1 (B-073). The abandonment email's landing page. Mints a
// fresh real session token and redirects into the ordinary flow, so
// `/checkout` sees exactly the hashed-token shape `advance`/`extendLock`/
// `relock` already handle — see `resume-token.ts` for why this is a separate
// signed token rather than the session's own.
//
// No auth, and no middleware match — same posture as `/unsubscribe/[token]`:
// this route grants exactly one action against exactly one session.
export const dynamic = 'force-dynamic'

export default async function CheckoutResumePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const dict = dictionaryFor(await requestLinkLocale())
  const t = (key: MessageKey) => translate(dict, key)
  const verdict = verifyCheckoutResumeToken(token)

  if (!verdict.valid) {
    return (
      <Refusal heading={t('resume.invalidHeading')} body={t('resume.invalidBody')}>
        <Link href="/storage/search" className="inline-flex min-h-11 items-center underline underline-offset-4">
          {t('checkout.findAUnit')}
        </Link>
        <CallLine lead={t('checkout.orCall')} />
      </Refusal>
    )
  }

  const sessionToken = await reissueCheckoutToken(verdict.sessionId)

  if (!sessionToken) {
    return (
      <Refusal heading={t('resume.completeHeading')} body={t('resume.completeBody')}>
        <Link href="/portal" className="inline-flex min-h-11 items-center underline underline-offset-4">
          {t('resume.signIn')}
        </Link>
        <CallLine lead={t('checkout.orCall')} />
      </Refusal>
    )
  }

  redirect(`/checkout?token=${encodeURIComponent(sessionToken)}`)
}

// B-321. Neither refusal is a dead end: the abandonment email exists to reach
// this page, so each state ends in a link and the site phone, both clickable.
// `min-h-11` is PRD 01 §6.2's 44px target, on inline links that would otherwise
// be one line of text tall.
function Refusal({
  heading,
  body,
  children,
}: {
  heading: string
  body: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
      <h1 className="text-lg font-semibold text-balance">{heading}</h1>
      <p className="text-muted-foreground text-sm text-pretty">{body}</p>
      <p className="flex flex-wrap items-center justify-center gap-x-2 text-sm">{children}</p>
    </div>
  )
}

function CallLine({ lead }: { lead: string }) {
  return (
    <span className="text-muted-foreground">
      {lead}{' '}
      <a href={`tel:${SITE.phone.href}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
        {SITE.phone.display}
      </a>
    </span>
  )
}
