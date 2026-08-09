'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'

// PRD 01 §6.8.1, PRD 04 US-15 AC5 (B-069). The cookie consent banner.
//
// The backlog line calls this out by name: "consent banners are the most common
// source of shipped keyboard traps." Every requirement below is from §6.8.1's
// row for this flow, and each one is implemented deliberately rather than
// inherited from a library:
//
//   * dismissible entirely by keyboard
//   * focus moved INTO it on appearance and RETURNED on dismissal
//   * no trap
//   * does not obscure content at 320px or at 200% zoom
//   * "Reject" as reachable and as prominent as "Accept"
//
// What consent actually gates is narrow, and worth stating: only the
// third-party vendor (US-15 AC1), which does not exist yet. The server-side
// funnel log keeps running either way — AC5 says so explicitly, because those
// events are first-party and pseudonymous. Declining does not blind the
// operator; it removes the vendor, which is the honest bargain.

const CONSENT_COOKIE = 'st_consent'
const CONSENT_DAYS = 180

function readConsent(): 'granted' | 'denied' | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)st_consent=(granted|denied)/)
  return (match?.[1] as 'granted' | 'denied' | undefined) ?? null
}

function writeConsent(value: 'granted' | 'denied'): void {
  const secure = window.location.protocol === 'https:' ? '; secure' : ''
  document.cookie = `${CONSENT_COOKIE}=${value}; max-age=${CONSENT_DAYS * 86_400}; path=/; samesite=lax${secure}`
}

/// The cookie is the state, and React reads it rather than mirroring it.
///
/// `useSyncExternalStore` instead of `useState` + an effect that sets it: a
/// synchronous `setState` inside an effect triggers a cascading render, and
/// mirroring browser state into component state is what creates the window
/// where the two disagree. On the server the snapshot is "already answered", so
/// the banner never renders into the HTML and cannot flash before hydration.
const consentListeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  consentListeners.add(listener)
  return () => consentListeners.delete(listener)
}

export function ConsentBanner() {
  const consent = useSyncExternalStore(subscribe, readConsent, () => 'granted' as const)
  const visible = consent === null

  const headingRef = useRef<HTMLHeadingElement>(null)
  // Where focus was before the banner took it. Returning focus here on dismiss
  // is the half of "focus management" that gets skipped, and skipping it drops
  // a keyboard user back at the top of the document.
  const returnFocusTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!visible) return
    returnFocusTo.current = document.activeElement as HTMLElement | null
    // Focus the heading, not the first button. Landing on "Accept" invites a
    // keyboard user to press it before hearing what it is, which is not consent.
    headingRef.current?.focus()
  }, [visible])

  if (!visible) return null

  const dismiss = (value: 'granted' | 'denied') => {
    writeConsent(value)
    for (const listener of consentListeners) listener()
    // Back where they were. `preventScroll` because yanking the viewport after
    // a dismissal is disorienting on its own.
    returnFocusTo.current?.focus?.({ preventScroll: true })
  }

  return (
    <div
      // `region`, not `dialog`. A modal dialog would REQUIRE a focus trap, and a
      // trap is the exact defect §6.8.1 names. This is a region a keyboard user
      // can tab straight out of and come back to — the site behind it stays
      // fully usable, which is also what makes "reject" a real choice rather
      // than a thing you click to get your page back.
      role="region"
      aria-labelledby="consent-heading"
      // In normal flow at the end of the document rather than fixed to the
      // viewport: §6.8.1 requires it not obscure content at 320px or at 200%
      // zoom, and a fixed bar is precisely what covers the bottom third of a
      // small screen once the text wraps to four lines.
      className="border-input bg-background border-t"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4">
        <h2
          id="consent-heading"
          ref={headingRef}
          // Focusable but not in the tab order: focus is moved here
          // programmatically on appearance and nobody should land on it again
          // while tabbing through the page.
          tabIndex={-1}
          className="text-base font-medium"
        >
          Cookies on this site
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">
          We use a few first-party cookies to remember where you came from and to count how many
          people reach each step. Analytics from an outside provider is off unless you say yes.
          Either way, the site works exactly the same.
        </p>
        <div className="flex flex-wrap gap-3">
          {/* Reject FIRST and visually identical to Accept. §6.8.1: "Reject is
              as reachable and as prominent as Accept." A ghost-styled reject
              beside a filled accept is the dark pattern this criterion exists
              to forbid, and tab order is part of reachability. */}
          <button
            type="button"
            onClick={() => dismiss('denied')}
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={() => dismiss('granted')}
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
          >
            That&apos;s fine
          </button>
        </div>
      </div>
    </div>
  )
}
