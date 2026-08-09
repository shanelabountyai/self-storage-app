import { prisma } from '@storage/db'
import { isAnalyticsEvent, type AnalyticsEvent } from '@storage/core/analytics'

// PRD 04 FR-AN-1 (B-069). "Internal `track(event, properties)` wrapper on web +
// server; vendor adapters (GA4 and/or privacy-friendly alternative) configured
// per environment."
//
// The wrapper exists so the vendor is swappable (US-15 AC1), and Q1 in the PRD's
// own open questions has not chosen one. So there is no vendor here yet — and
// that is not a gap, because FR-AN-2 makes the SERVER log the source of truth
// and the vendor "for exploration and campaign tooling". The reporting this
// item ships works with no vendor configured, forever, which is the property
// worth having.

export type TrackInput = {
  event: AnalyticsEvent
  /// Pseudonymous, first-party, per browser session. Never a user id.
  sessionId: string
  facilityId?: string | null
  channel?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  path?: string | null
  properties?: Record<string, string | number | boolean | null>
}

/// Records one event. Never throws.
///
/// Analytics must not be able to break the thing it is measuring. A failed
/// insert here — a dead connection, a column that grew a constraint — has to
/// leave the checkout, the form or the move-in it was called from completely
/// unaffected, because the alternative is losing a rental to record that we
/// nearly had one.
export async function track(input: TrackInput): Promise<void> {
  try {
    if (!isAnalyticsEvent(input.event)) return

    await prisma.analyticsEvent.create({
      data: {
        name: input.event,
        sessionId: input.sessionId.slice(0, 100),
        facilityId: input.facilityId ?? null,
        channel: input.channel ?? null,
        utmSource: input.utmSource?.slice(0, 200) ?? null,
        utmMedium: input.utmMedium?.slice(0, 200) ?? null,
        path: input.path?.slice(0, 500) ?? null,
        properties: input.properties ? sanitise(input.properties) : undefined,
      },
    })
  } catch {
    // Deliberately silent. There is nowhere useful to report this from — every
    // caller is mid-transaction on something that matters more — and a log line
    // per dropped event on a broken connection is its own outage.
  }
}

/// Strips anything that could carry a person's details into the event log.
///
/// A property bag is where PII arrives by accident: somebody adds
/// `{ email }` to a form-submit event because it was to hand. The funnel needs
/// counts, so the allow-list is by VALUE TYPE and the keys are capped — a long
/// string is prose, and prose is where a name hides.
function sanitise(
  properties: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'number' || typeof value === 'boolean') {
      clean[key.slice(0, 40)] = value
      continue
    }
    if (typeof value === 'string') {
      // Anything remotely address-shaped is dropped rather than truncated:
      // half an email address is still an email address.
      if (value.includes('@')) continue
      clean[key.slice(0, 40)] = value.slice(0, 100)
    }
  }
  return clean
}

/// The cookie holding the pseudonymous session id.
///
/// First-party, `lax`, and short-lived: a session is a visit, not a person.
/// Deliberately NOT the 90-day attribution cookie — that one answers "where did
/// this visitor come from" and this one answers "is this the same visit", and
/// merging them would turn a 30-minute pseudonymous id into a 90-day one.
export const SESSION_COOKIE = 'st_sid'
export const SESSION_COOKIE_MINUTES = 30
