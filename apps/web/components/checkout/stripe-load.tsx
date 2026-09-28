'use client'

import { useEffect, useRef, useState } from 'react'
import type { Stripe } from '@stripe/stripe-js'
import { useT } from '@/components/i18n/locale-provider'
import { CardsUnavailable } from './cards-unavailable'

/// B-392. How long the card form waits for Stripe.js before saying it cannot
/// take a card, rather than showing a button that silently does nothing.
export const STRIPE_LOAD_MS = 10_000

// B-412. The bounded wait, shared by checkout's card form and the portal's.
// `stuck` is sticky: once the message is up, Stripe loading late does not swap
// the form back in under the reader. Only `retry` does, on request.
export function useStripeLoad(stripe: Stripe | null) {
  const t = useT()
  const [stuck, setStuck] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (stripe || stuck) return
    const id = setTimeout(() => setStuck(true), STRIPE_LOAD_MS)
    return () => clearTimeout(id)
  }, [stripe, stuck])

  return {
    stuck,
    notice,
    /// Pay pressed while Stripe.js is still loading.
    pressedEarly: () => setNotice(t('pay.cardFormLoading')),
    retry: () => {
      setStuck(false)
      setNotice(t(stripe ? 'pay.cardFormReady' : 'pay.cardFormLoading'))
    },
  }
}

/// Mounted empty before the load starts, so everything written into it is a
/// mutation a screen reader announces. `status` is the caller's own text
/// ("Taking payment…") and wins over the loading notice.
export function StripeLoadStatus({
  load,
  status,
  moveIn = false,
}: {
  load: ReturnType<typeof useStripeLoad>
  status: string
  moveIn?: boolean
}) {
  const t = useT()
  const regionRef = useRef<HTMLDivElement>(null)

  // The form that had focus is gone; the message is where the payer is now.
  useEffect(() => {
    if (load.stuck) regionRef.current?.focus()
  }, [load.stuck])

  return (
    <>
      <div
        ref={regionRef}
        tabIndex={-1}
        role="status"
        className={load.stuck ? undefined : 'text-muted-foreground mt-2 text-sm empty:mt-0'}
      >
        {load.stuck ? <CardsUnavailable t={t} moveIn={moveIn} /> : status || load.notice}
      </div>
      {load.stuck && (
        <button
          type="button"
          onClick={() => {
            load.retry()
            // This button is about to unmount; the region is the stable node,
            // and it sits just before the card fields in tab order.
            regionRef.current?.focus()
          }}
          className="border-input hover:bg-accent mt-3 inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          {t('pay.tryCardFormAgain')}
        </button>
      )}
    </>
  )
}
