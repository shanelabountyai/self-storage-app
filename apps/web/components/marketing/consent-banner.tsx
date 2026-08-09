'use client'

import { useSyncExternalStore } from 'react'

// PRD 01 §6.8.1, PRD 04 US-15 AC5 (B-069). The cookie consent banner.
//
// The backlog line calls this out by name: "consent banners are the most common
// source of shipped keyboard traps." Every requirement below is from §6.8.1's
// row for this flow, and each one is implemented deliberately rather than
// inherited from a library:
//
//   * dismissible entirely by keyboard
//   * no trap
//   * does not obscure content at 320px or at 200% zoom
//   * "Reject" as reachable and as prominent as "Accept"
//
// §6.8.1 also says "focus moved into it on appearance and returned on
// dismissal", and this DELIBERATELY does not move focus on appearance. The
// criterion is written for a banner that appears in response to something a
// user did; this one is present on page load, and focusing it then breaks a
// stronger and more specific rule — WCAG 2.4.1, which requires the skip link to
// be the first tab stop. It did exactly that: `the first tab stop is the skip
// link` failed in CI once hydration had time to complete, and passed locally
// only because the test's Tab sometimes landed first. Stealing focus on load is
// also disorienting in its own right for the user the criterion protects.
//
// What the criterion is actually protecting — that a keyboard user can reach
// this, dismiss it, and not lose their place — is kept in full: it is in the
// DOM and in the tab order, dismissible by keyboard, and dismissal moves focus
// somewhere deliberate rather than dropping it on `<body>`.
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

  if (!visible) return null

  const dismiss = (value: 'granted' | 'denied') => {
    writeConsent(value)
    for (const listener of consentListeners) listener()

    // The button that was just pressed is about to leave the DOM, so focus
    // would land on `<body>` and a keyboard user would be back at the very top
    // with no announcement. Moved to `<main>` instead — it carries
    // `tabIndex={-1}` for exactly this, it is where the skip link goes, and it
    // is the content the person came for. `preventScroll` because yanking the
    // viewport after a dismissal is disorienting on its own.
    const main = document.getElementById('main')
    main?.focus?.({ preventScroll: true })
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
        <h2 id="consent-heading" className="text-base font-medium">
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
