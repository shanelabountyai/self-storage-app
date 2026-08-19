'use client'

import { useEffect, useState } from 'react'

/// The "remaining time" half of FR-14.
///
/// The number ticks for the sighted reader and is `aria-hidden`; the sentence
/// beside it states the wall-clock time the session ends and never changes.
/// A live-updating minute count in the banner's `role="alert"` would re-announce
/// the whole banner every time it moved, which is how a required notice becomes
/// something people turn off.
///
/// Expiry itself is server-enforced (FR-3) — this is a display. When it reaches
/// zero the next request is what actually ends the session.
export function ImpersonationCountdown({ expiresAt }: { expiresAt: string }) {
  const end = new Date(expiresAt).getTime()
  const [remaining, setRemaining] = useState(() => end - Date.now())

  useEffect(() => {
    const timer = setInterval(() => setRemaining(end - Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [end])

  const minutes = Math.max(0, Math.ceil(remaining / 60_000))
  return (
    <span aria-hidden="true">
      {minutes === 0 ? 'expiring now' : `${minutes} min left`}
    </span>
  )
}
