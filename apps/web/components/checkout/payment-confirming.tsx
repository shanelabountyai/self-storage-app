'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { checkPaymentAction } from '@/app/(public)/checkout/actions'
import { useT } from '@/components/i18n/locale-provider'
import { SITE } from '@/lib/site-config'

// B-392. Shown instead of the card form once the intent is paid or paying, so
// a charged renter is never handed a live form again. Polls a read-only action
// (a session lookup, no Stripe call, no Payment row) until the webhook advances
// the step, then refreshes once; the server stops rendering this on its own.

const POLL_MS = 2000
const POLLS = 15

export function PaymentConfirming({ token, lead }: { token: string; lead?: string }) {
  const t = useT()
  const router = useRouter()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [slow, setSlow] = useState(false)
  const [round, setRound] = useState(0)
  // Gates the status text so it is rendered empty on mount and filled a tick
  // later — a screen reader gets a mutation to announce rather than text that
  // was already there (payment-element.tsx's error/status regions use the
  // same pattern). A plain "did mount" flag rather than mirroring slow/lead
  // into their own state, which React's effect linter flags as redundant.
  const [mounted, setMounted] = useState(false)

  // Focus follows the swap: the Element that had it is gone.
  useEffect(() => headingRef.current?.focus(), [])
  // Deferred a tick (not set synchronously in the effect body) so this is a
  // genuine mutation after the empty first paint, not a same-frame flip.
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < POLLS; i++) {
        if (await checkPaymentAction(token).catch(() => false)) {
          if (!cancelled) router.refresh()
          return
        }
        await new Promise((r) => setTimeout(r, POLL_MS))
        if (cancelled) return
      }
      setSlow(true)
    })()
    return () => {
      cancelled = true
    }
  }, [token, router, round])

  return (
    <div className="border-input mt-3 rounded-lg border p-4">
      <h3 ref={headingRef} tabIndex={-1} className="font-medium">
        {t('pay.confirmingHeading')}
      </h3>
      <p role="status" className="text-muted-foreground mt-2 text-pretty">
        {mounted ? (slow ? t('pay.confirmingSlow') : (lead ?? t('pay.confirmingStatus'))) : ''}
      </p>
      {slow && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => {
              setSlow(false)
              setRound((n) => n + 1)
              // The button that had focus is about to unmount; the heading
              // is the stable landing spot (also focused on initial mount).
              headingRef.current?.focus()
            }}
            className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
          >
            {t('pay.checkAgain')}
          </button>
          <p className="text-sm">
            {t('pay.confirmingCall')}{' '}
            <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
              {SITE.phone.display}
            </a>
          </p>
        </div>
      )}
    </div>
  )
}
