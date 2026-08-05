'use client'

import { useEffect, useRef, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

// PRD 01 US-703. The Payment Element for a portal one-time payment.
//
// Card details go from this component to Stripe directly and never touch our
// servers — SAQ-A, same as checkout's own element (B-025). Deliberately a
// second, small component rather than a prop on that one: this flow confirms
// a balance payment and lands on a receipt, checkout's confirms a move-in and
// reloads into the next step, and the two only look alike.

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null

/// Matches components/checkout/payment-element.tsx exactly — the Element
/// renders in a cross-origin iframe axe cannot scan, so these values are the
/// only contrast guarantee it gets (4.5:1 text, 3:1 focus ring).
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

function PayForm({ returnUrl, amountLabel }: { returnUrl: string; amountLabel: string }) {
  const stripe = useStripe()
  const elements = useElements()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    // A decline reported only inside Stripe's iframe is frequently not
    // announced at all, so it is mirrored out here and given focus.
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
      redirect: 'if_required',
    })

    if (result.error) {
      setError(result.error.message ?? 'That card was declined. Try another card.')
      setSubmitting(false)
      return
    }
    // The receipt page reads our own Payment row, which the webhook marks
    // succeeded — it is written to expect "still confirming" and say so,
    // rather than this client asserting a success only Stripe has seen.
    window.location.assign(returnUrl)
  }

  return (
    <form onSubmit={submit} className="mt-4">
      {/* Rendered unconditionally and empty so a decline is a mutation the
          screen reader announces, not a node inserted already populated. */}
      <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm font-medium text-red-700">
        {error ?? ''}
      </p>

      <PaymentElement options={{ layout: 'tabs' }} />

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="bg-primary text-primary-foreground mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-base font-medium disabled:opacity-60 sm:w-auto"
      >
        {submitting ? 'Taking payment…' : `Pay ${amountLabel}`}
      </button>
    </form>
  )
}

export function PortalPayment({
  clientSecret,
  customerSessionSecret,
  returnUrl,
  amountLabel,
}: {
  clientSecret: string
  customerSessionSecret: string | null
  returnUrl: string
  amountLabel: string
}) {
  if (!stripePromise) return null
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        // What makes an already-saved card show up as an option instead of an
        // empty card form (US-703's "saved method or a new one").
        ...(customerSessionSecret ? { customerSessionClientSecret: customerSessionSecret } : {}),
        appearance,
      }}
    >
      <PayForm returnUrl={returnUrl} amountLabel={amountLabel} />
    </Elements>
  )
}
