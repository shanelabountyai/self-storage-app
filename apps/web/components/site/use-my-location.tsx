'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// US-101: browser geolocation is "offered but never required; declining it
// degrades gracefully to manual entry."
//
// This is the only client component on the search path. The form beside it is a
// plain GET form that works with JavaScript disabled, so this button is purely
// additive — if it never runs, search still works.

export function UseMyLocation() {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'locating' | 'unavailable' | 'denied'>('idle')

  function locate() {
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
        router.push(`/storage/search?lat=${latitude.toFixed(5)}&lng=${longitude.toFixed(5)}`)
      },
      // Covers an outright denial and a timeout alike: either way the answer to
      // the user is the same, and it must not be a dead end.
      () => setState('denied'),
      { timeout: 10_000 },
    )
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={locate}
        disabled={state === 'locating'}
        className="text-sm underline underline-offset-4 disabled:opacity-60"
      >
        {state === 'locating' ? 'Finding you…' : 'Use my location'}
      </button>

      {/* Announced to screen readers when it appears, since the failure is the
          result of an action the user just took. */}
      {(state === 'denied' || state === 'unavailable') && (
        <p role="status" className="text-muted-foreground mt-1 text-sm">
          {state === 'unavailable'
            ? "This browser can't share your location."
            : "We couldn't get your location."}{' '}
          Enter a zip code or city instead.
        </p>
      )}
    </div>
  )
}
