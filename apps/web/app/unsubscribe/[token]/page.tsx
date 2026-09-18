import type { Metadata } from 'next'
import { verifyUnsubscribeToken } from '@/lib/comms/unsubscribe-token'
import { dictionaryFor, translate } from '@/lib/i18n'
import { requestLinkLocale } from '@/lib/i18n/link-locale'
import { confirmUnsubscribeAction } from './actions'

// B-321. In the language of the email carrying the link, which the token
// itself records (`mintUnsubscribeToken`) — an address has no language of its
// own. A token minted before B-321 falls back to the cookie.
export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await requestLinkLocale()), 'unsub.title') }
}

// PRD 05 US-13 AC2 / FR-MSG-3 (B-072). "A working one-click unsubscribe...
// resolves without login."
//
// No auth, and no middleware match — same posture as `/pay/[token]`: this
// route grants exactly one action against exactly one address, and nothing
// else in the application knows the token exists.
export const dynamic = 'force-dynamic'

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ done?: string }>
}) {
  const { token } = await params
  const { done } = await searchParams
  const dict = dictionaryFor(await requestLinkLocale())
  const verdict = verifyUnsubscribeToken(token)

  if (!verdict.valid) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">{translate(dict, 'unsub.invalidHeading')}</h1>
        <p className="text-muted-foreground text-sm text-pretty">{translate(dict, 'unsub.invalidBody')}</p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">{translate(dict, 'unsub.doneHeading')}</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          {translate(dict, 'unsub.doneBody', { address: verdict.address })}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16 text-center">
      <h1 className="text-lg font-semibold break-words">
        {translate(dict, 'unsub.confirmHeading', { address: verdict.address })}
      </h1>
      <p className="text-muted-foreground text-sm text-pretty">{translate(dict, 'unsub.confirmBody')}</p>
      <form action={confirmUnsubscribeAction} className="flex justify-center">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="border-input hover:bg-accent min-h-11 rounded-md border px-6 text-sm font-medium"
        >
          {translate(dict, 'unsub.confirmButton')}
        </button>
      </form>
    </div>
  )
}
