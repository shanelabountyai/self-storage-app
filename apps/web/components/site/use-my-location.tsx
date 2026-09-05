'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/components/i18n/locale-provider'

// US-101: browser geolocation is "offered but never required; declining it
// degrades gracefully to manual entry."
//
// This is the only client component on the search path. The form beside it is a
// plain GET form that works with JavaScript disabled, so this button is purely
// additive — if it never runs, search still works.

export function UseMyLocation({
  /// B-082 part 3. Filters carried from a guide's CTA, as a query string.
  ///
  /// This button builds its destination URL from scratch, so without this it
  /// drops the filter exactly as the GET form beside it would — and the two
  /// routes to the same results page behaving differently is worse than either
  /// behaviour on its own.
  carry = '',
}: { carry?: string } = {}) {
  const router = useRouter()
  const t = useT()
  const [state, setState] = useState<'idle' | 'locating' | 'unavailable' | 'denied'>('idle')

  function locate() {
    // The button stays enabled while locating (see below), so a second click
    // has to be a no-op here rather than being prevented by `disabled`.
    if (state === 'locating') return
    if (!('geolocation' in navigator)) {
      setState('unavailable')
      return
    }
    setState('locating')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        // Same shareable-URL rule as the text search (US-101) — the result of
        // locating is a URL you can bookmark, not hidden client state.
        const params = new URLSearchParams(carry)
        params.set('lat', latitude.toFixed(5))
        params.set('lng', longitude.toFixed(5))
        router.push(`/storage/search?${params.toString()}`)
      },
      // Covers an outright denial and a timeout alike: either way the answer to
      // the user is the same, and it must not be a dead end.
      () => setState('denied'),
      { timeout: 10_000 },
    )
  }

  return (
    <div className="mt-3">
      {/* `aria-busy` rather than `disabled` while locating. Disabling the
          element that currently has focus blurs it to <body> in Chromium, so a
          screen-reader user pressing Enter here lost their place in the
          document and then heard nothing for up to ten seconds. */}
      <button
        type="button"
        onClick={locate}
        aria-busy={state === 'locating'}
        className="text-sm underline underline-offset-4 aria-busy:opacity-60"
      >
        {state === 'locating' ? t('location.finding') : t('location.use')}
      </button>

      {/* Rendered unconditionally and empty, then written into. A live region
          inserted into the DOM with its text already inside is unreliably
          announced by VoiceOver and routinely missed by NVDA — the region has to
          pre-exist the event it reports. That is what the "attached on load"
          e2e assertion is protecting.

          The locating state is announced too: a control that goes silent for
          ten seconds after activation has failed the user, whatever it does
          next. */}
      <p role="status" className="text-muted-foreground mt-1 text-sm empty:mt-0">
        {state === 'locating' && t('location.findingStatus')}
        {state === 'unavailable' && t('location.unavailable')}
        {state === 'denied' && t('location.denied')}
      </p>
    </div>
  )
}
