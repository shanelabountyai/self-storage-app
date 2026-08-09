import { cookies, headers } from 'next/headers'
import { decodeTouch, LAST_TOUCH_COOKIE } from '@storage/core/marketing'
import { SESSION_COOKIE } from '@/lib/analytics/track'

// PRD 04 FR-AN-1/2 (B-069). Reading the pseudonymous session and its channel
// off the request, so every `track()` call site does not have to.
//
// The channel comes from the attribution cookie B-068 already writes, which is
// what lets the funnel be split by source (US-15 AC4) without joining back to a
// lead that may not exist — most sessions never become one, and those are
// exactly the ones a funnel is about.

export type TrackingContext = {
  sessionId: string | null
  channel: string | null
  utmSource: string | null
  utmMedium: string | null
}

export async function trackingContext(): Promise<TrackingContext> {
  const store = await cookies()
  const touch = decodeTouch(store.get(LAST_TOUCH_COOKIE)?.value)

  return {
    // Null rather than a fresh id: the proxy mints these, and inventing one
    // here would create a single-event "session" for every request that somehow
    // missed it, inflating the top of the funnel with sessions that never
    // existed.
    sessionId: store.get(SESSION_COOKIE)?.value ?? null,
    channel: touch?.channel ?? null,
    utmSource: touch?.source ?? null,
    utmMedium: touch?.medium ?? null,
  }
}

export async function currentPath(): Promise<string | null> {
  const headerList = await headers()
  return headerList.get('x-pathname') ?? headerList.get('referer')
}
