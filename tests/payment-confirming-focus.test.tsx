// @vitest-environment jsdom
// No root tsconfig.json means esbuild falls back to the classic JSX
// transform for files outside apps/web, which needs `React` in scope.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// B-411 (review block 13, accessibility A2). "Check again" used to unmount
// itself on click, dropping focus to <body>. It must land on the confirming
// heading instead — the same stable node focused on mount.

const checkPaymentAction = vi.fn(async (_token: string) => false)
vi.mock('@/app/(public)/checkout/actions', () => ({
  checkPaymentAction: (token: string) => checkPaymentAction(token),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const { PaymentConfirming } = await import('../apps/web/components/checkout/payment-confirming')

// @ts-expect-error -- React reads this global to allow `act()` outside testing-library.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const POLL_MS = 2000
const POLLS = 15

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  checkPaymentAction.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function reachSlow() {
  act(() => {
    root = createRoot(container)
    root.render(<PaymentConfirming token="t1" />)
  })
  // Every poll comes back false, so the loop runs out and flips to "slow".
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_MS * POLLS)
  })
}

describe('the checkout confirming state', () => {
  it('moves focus to the heading on "Check again", never to <body>', async () => {
    await reachSlow()

    const heading = container.querySelector('h3')!
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Check again')!

    // A user tabs to the button before pressing it.
    act(() => button.focus())
    expect(document.activeElement).toBe(button)

    act(() => button.click())

    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(heading)
  })

  it('the status region is empty at first paint (a mutation to announce, not text already there)', () => {
    // react-dom/server never runs effects, so this is the same bytes React
    // commits before hydration fires — the print page's render test checks
    // static markup for the same reason.
    const html = renderToStaticMarkup(<PaymentConfirming token="t1" />)
    expect(html).toMatch(/<p[^>]*role="status"[^>]*><\/p>/)
  })
})
