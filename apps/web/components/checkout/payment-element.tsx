'use client'

import { useEffect, useRef, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

// PRD 01 US-501 step 5 / §4.6. The Stripe Payment Element.
//
// Card details go from this component to Stripe directly and never touch our
// servers — that is what keeps PCI scope at SAQ-A (master PRD §7.4).

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null

/// Stripe's defaults inherit the same weak borders this project already had to
/// fix in its own tokens (B-093). The Element renders in a cross-origin iframe
/// that axe cannot scan, so these values are the only contrast guarantee it
/// gets: 4.5:1 text and a 3:1 focus ring, matching `--ring` and `--input`.
const appearance = {
  variables: {
    colorText: '#171717',
    colorTextSecondary: '#525252',
    colorDanger: '#b91c1c',
    borderRadius: '6px',
  },
  rules: {
    '.Input': { border: '1px solid #767676' },
    '.Input:focus': { outline: '2px solid #767676', outlineOffset: '2px', boxShadow: 'none' },
    '.Label': { color: '#171717' },
  },
} as const

function PaymentForm({ returnUrl }: { returnUrl: string }) {
  const stripe = useStripe()
  const elements = useElements()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  // The guard that replaces `disabled` (see the button). A ref rather than the
  // state above because this one is about not charging a card twice, and a ref
  // is already true by the time a second click lands in the same tick.
  const inFlight = useRef(false)

  useEffect(() => {
    // A decline reported only inside Stripe's iframe is frequently not
    // announced at all, so it is mirrored out here and given focus — the
    // renter is told, and told where.
    if (error) errorRef.current?.focus()
  }, [error])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    if (!stripe || !elements) return

    inFlight.current = true
    setSubmitting(true)
    setError(null)
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      // We finalise from the webhook, never from the client redirect (FR-4.4),
      // so a renter who closes the tab still gets their unit.
      redirect: 'if_required',
    })

    if (result.error) {
      // B-103: no longer necessarily a card. Stripe's own message is used
      // when there is one; the fallback stopped naming the method.
      setError(result.error.message ?? 'That payment was declined. Try another payment method.')
      inFlight.current = false
      setSubmitting(false)
      return
    }
    // Success is confirmed by the webhook; the page reloads to whatever the
    // server now says the step is.
    window.location.reload()
  }

  return (
    <form onSubmit={submit} className="mt-4">
      {/* Rendered unconditionally and empty so a decline is a mutation the
          screen reader announces, not a node inserted already populated. */}
      <p
        ref={errorRef}
        tabIndex={-1}
        role="alert"
        className="text-sm font-medium text-red-700"
      >
        {error ?? ''}
      </p>

      {/* Also pre-mounted and empty. A button whose LABEL changes to "Taking
          payment…" tells a sighted user what is happening and tells a screen
          reader nothing — the name of a control the user has just left is not
          re-read. Confirming a card can take several seconds, and silence for
          several seconds after paying reads as "it didn't work". */}
      <p role="status" className="text-muted-foreground mt-2 text-sm empty:mt-0">
        {submitting ? 'Taking payment. This can take a few seconds.' : ''}
      </p>

      <PaymentElement options={{ layout: 'tabs' }} />

      {/* `aria-busy` rather than `disabled`. Disabling the element that
          currently has focus blurs it to <body> in Chromium, so the renter who
          just pressed Pay loses their place in the document at exactly the
          moment the page goes quiet — the failure `use-my-location.tsx` already
          documents, on the screen where it costs the most. A second press is a
          no-op via `inFlight` instead. */}
      <button
        type="submit"
        aria-busy={!stripe || submitting}
        className="bg-primary text-primary-foreground mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium aria-busy:opacity-60 sm:w-auto"
      >
        {submitting ? 'Taking payment…' : 'Pay and complete move-in'}
      </button>
    </form>
  )
}

export function StripePayment({
  clientSecret,
  returnUrl,
}: {
  clientSecret: string
  returnUrl: string
}) {
  if (!stripePromise) return null
  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
      <PaymentForm returnUrl={returnUrl} />
    </Elements>
  )
}
