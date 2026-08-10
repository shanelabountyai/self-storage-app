import type { Metadata } from 'next'
import { verifyUnsubscribeToken } from '@/lib/comms/unsubscribe-token'
import { confirmUnsubscribeAction } from './actions'

export const metadata: Metadata = { title: 'Unsubscribe' }

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
  const verdict = verifyUnsubscribeToken(token)

  if (!verdict.valid) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">This link isn&apos;t valid</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          It may be out of date. If you are still receiving emails you don&apos;t want, call the
          facility and ask them to remove you.
        </p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">You&apos;re unsubscribed</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          {verdict.address} will not receive marketing emails from us again. This takes effect
          immediately.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">Unsubscribe {verdict.address}?</h1>
      <p className="text-muted-foreground text-sm text-pretty">
        You will stop receiving marketing emails from us at this address. You will still get
        emails about anything you have an active account or reservation for.
      </p>
      <form action={confirmUnsubscribeAction} className="flex justify-center">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="border-input hover:bg-accent min-h-11 rounded-md border px-6 text-sm font-medium"
        >
          Unsubscribe me
        </button>
      </form>
    </div>
  )
}
