// @vitest-environment jsdom
// No root tsconfig.json means esbuild falls back to the classic JSX
// transform for files outside apps/web, which needs `React` in scope.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// B-412 (review block 13, accessibility A3 and A7). When Stripe.js never
// loads, checkout swapped the form for a sentence nobody was told about and
// the portal said nothing at all. Both now write into a status region that
// was mounted empty, and move focus to it.

let stripe: object | null = null
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve(null) }))
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => children,
  PaymentElement: () => <div data-testid="card-fields" />,
  useStripe: () => stripe,
  useElements: () => (stripe ? {} : null),
}))
vi.mock('@/app/(public)/checkout/actions', () => ({ checkPaymentAction: async () => false }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

// Both modules read the key at import time and render nothing without it.
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_unit'
const { StripePayment } = await import('../apps/web/components/checkout/payment-element')
const { PortalPayment } = await import('../apps/web/components/portal/portal-payment')
const { STRIPE_LOAD_MS } = await import('../apps/web/components/checkout/stripe-load')

// @ts-expect-error -- React reads this global to allow `act()` outside testing-library.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const forms = [
  ['checkout', () => <StripePayment clientSecret="cs" returnUrl="/done" token="t1" />],
  [
    'portal',
    () => <PortalPayment clientSecret="cs" customerSessionSecret={null} returnUrl="/done" amountLabel="$50.00" />,
  ],
] as const

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  stripe = null
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function render(form: () => React.JSX.Element) {
  act(() => {
    root = createRoot(container)
    root.render(form())
  })
}

const region = () => container.querySelector<HTMLElement>('[role="status"]')!
const pay = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')
const retry = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Try the card form again')

describe.each(forms)('the %s card form while Stripe.js has not loaded', (_name, form) => {
  it('mounts the status region empty, and Pay pressed early writes the loading sentence into it', () => {
    render(form)
    expect(region().textContent).toBe('')

    act(() => pay()!.click())

    expect(region().textContent).toMatch(/^The card form is still loading\./)
  })

  it('after the wait, the unavailable message is in that region and has focus', () => {
    render(form)
    const before = region()
    act(() => pay()!.focus())

    act(() => void vi.advanceTimersByTime(STRIPE_LOAD_MS))

    expect(region()).toBe(before)
    expect(region().textContent).toMatch(/^We can't take card payments online just now\./)
    expect(region().querySelector('a[href^="tel:"]')).not.toBeNull()
    expect(document.activeElement).toBe(region())
    expect(pay()).toBeNull()
  })

  it('does not bring the form back when Stripe loads late, until asked', () => {
    render(form)
    act(() => void vi.advanceTimersByTime(STRIPE_LOAD_MS))

    stripe = {}
    act(() => root.render(form()))
    expect(pay()).toBeNull()
    expect(container.querySelector('[data-testid="card-fields"]')).toBeNull()

    act(() => retry()!.focus())
    act(() => retry()!.click())

    expect(pay()).not.toBeNull()
    expect(container.querySelector('[data-testid="card-fields"]')).not.toBeNull()
    expect(region().textContent).toBe('The card form is ready.')
    expect(document.activeElement).toBe(region())
  })

  it('asked again with Stripe still missing, waits again and says so', () => {
    render(form)
    act(() => void vi.advanceTimersByTime(STRIPE_LOAD_MS))

    act(() => retry()!.click())
    expect(region().textContent).toMatch(/^The card form is still loading\./)
    expect(document.activeElement).toBe(region())

    act(() => void vi.advanceTimersByTime(STRIPE_LOAD_MS))
    expect(region().textContent).toMatch(/^We can't take card payments online just now\./)
    expect(document.activeElement).toBe(region())
  })
})
