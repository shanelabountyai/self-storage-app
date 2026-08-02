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

  useEffect(() => {
    // A decline reported only inside Stripe's iframe is frequently not
    // announced at all, so it is mirrored out here and given focus — the
    // renter is told, and told where.
    if (error) errorRef.current?.focus()
  }, [error])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!stripe || !elements) return

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
      setError(result.error.message ?? 'That card was declined. Try another card.')
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
        className="text-sm font-medium text-red-700 empty:hidden"
      >
        {error ?? ''}
      </p>

      <PaymentElement options={{ layout: 'tabs' }} />

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="bg-primary text-primary-foreground mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium disabled:opacity-60 sm:w-auto"
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
