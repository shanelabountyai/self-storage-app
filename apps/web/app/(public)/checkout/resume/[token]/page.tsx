import { redirect } from 'next/navigation'
import { verifyCheckoutResumeToken } from '@/lib/checkout/resume-token'
import { reissueCheckoutToken } from '@/lib/checkout/session'

import { getLocale } from '@/lib/i18n/server'
import { localePath } from '@/lib/i18n/routing'
export const metadata = { title: 'Resume checkout', robots: { index: false, follow: false } }

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
  const verdict = verifyCheckoutResumeToken(token)

  if (!verdict.valid) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">This link isn&apos;t valid</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          It may be out of date. Start a new booking from the facility page, or call for help.
        </p>
      </div>
    )
  }

  const sessionToken = await reissueCheckoutToken(verdict.sessionId)

  if (!sessionToken) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">This booking is already complete</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          There is nothing left to finish — check your email for your move-in confirmation.
        </p>
      </div>
    )
  }

  redirect(localePath(await getLocale(), `/checkout?token=${encodeURIComponent(sessionToken)}`))
}
