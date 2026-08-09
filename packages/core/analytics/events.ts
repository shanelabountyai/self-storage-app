// PRD 04 §3.8 US-15, FR-AN-1/2/4 (B-069). The event vocabulary, written down
// once.
//
// FR-AN-2 is the load-bearing sentence: "Server-side event log is the source of
// truth for funnel reporting (immune to ad blockers/consent declines); client
// vendor is for exploration and campaign tooling."
//
// That inverts the usual arrangement and it is the right way round. Somewhere
// between a fifth and a third of visitors block third-party analytics, and
// consent declines remove more. A funnel built on the client would under-count
// exactly the traffic an owner is deciding budget from — and it would
// under-count it unevenly, because ad-blocker use correlates with the channel.

export const ANALYTICS_EVENTS = [
  'page_view',
  'quote_form_submit',
  'callback_request',
  'reservation_started',
  'reservation_completed',
  'move_in_completed',
  'promo_applied',
  'review_request_click',
] as const

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number]

export function isAnalyticsEvent(value: string): value is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(value)
}

/// US-15 AC3: "`move_in_completed` is fired server-side from the admin
/// dashboard's move-in event (client analytics can't see it)."
///
/// Broader than that one event in practice — anything that happens after money
/// moves, or in a job, has no browser to fire from. Listed so a client-side
/// `track()` call for one of these can be refused rather than silently
/// producing a duplicate the funnel then counts twice.
export const SERVER_ONLY_EVENTS: readonly AnalyticsEvent[] = [
  'move_in_completed',
  'reservation_completed',
]

export function isServerOnly(event: AnalyticsEvent): boolean {
  return SERVER_ONLY_EVENTS.includes(event)
}

/// US-15 AC4's funnel: "sessions → leads → reservations started → completed →
/// move-ins."
///
/// Ordered, and the order is the report. Each step counts DISTINCT sessions
/// reaching it, not events — one person refreshing a facility page six times is
/// one session, and counting page views here would make the top of the funnel
/// look wide and the conversion rate look terrible.
export const FUNNEL_STEPS = [
  { key: 'sessions', label: 'Sessions', event: 'page_view' },
  { key: 'leads', label: 'Asked a question', event: 'quote_form_submit' },
  { key: 'reservations_started', label: 'Started a hold', event: 'reservation_started' },
  { key: 'reservations_completed', label: 'Completed a hold', event: 'reservation_completed' },
  { key: 'move_ins', label: 'Moved in', event: 'move_in_completed' },
] as const

export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]['key']

export type FunnelCounts = Record<FunnelStepKey, number>

export type FunnelStepResult = {
  key: FunnelStepKey
  label: string
  count: number
  /// Share of the step ABOVE, which is the number somebody acts on: "half the
  /// people who started a hold finished it" is a fixable problem, while "0.3%
  /// of sessions moved in" is a statistic.
  fromPrevious: number | null
  /// Share of the top of the funnel, for the one number an owner quotes.
  fromTop: number | null
}

export function funnelFrom(counts: FunnelCounts): FunnelStepResult[] {
  const top = counts[FUNNEL_STEPS[0].key]
  let previous: number | null = null

  return FUNNEL_STEPS.map((step) => {
    const count = counts[step.key]
    const result: FunnelStepResult = {
      key: step.key,
      label: step.label,
      count,
      // Null rather than zero when there is nothing above: 0% implies a
      // measured failure, and "no sessions yet" is not one.
      fromPrevious: previous === null ? null : previous > 0 ? count / previous : null,
      fromTop: top > 0 ? count / top : null,
    }
    previous = count
    return result
  })
}

export function emptyFunnel(): FunnelCounts {
  return {
    sessions: 0,
    leads: 0,
    reservations_started: 0,
    reservations_completed: 0,
    move_ins: 0,
  }
}

// ── FR-AN-4: the UTM registry ────────────────────────────────────────────

/// "UTM convention documented and enforced (lowercase; registry of approved
/// `utm_source`/`utm_medium` values, including `google/organic_gbp` for GBP
/// website links and `aggregator` sources)."
///
/// A registry rather than free text because the failure is not an error, it is
/// a quietly split report: `utm_source=Google`, `google` and `google.com` are
/// three rows in every breakdown, and nobody notices until the three of them
/// individually look too small to matter.
export const APPROVED_UTM_SOURCES = [
  'google',
  'bing',
  'facebook',
  'instagram',
  'yelp',
  'nextdoor',
  'sparefoot',
  'storable',
  'email',
  'partner',
] as const

export const APPROVED_UTM_MEDIUMS = [
  'cpc',
  'organic',
  /// PRD 04 US-5 AC1's Google Business Profile link.
  'organic_gbp',
  'social',
  'paid-social',
  'email',
  'referral',
  'aggregator',
  'display',
] as const

export type UtmProblem = { field: 'utm_source' | 'utm_medium'; value: string; problem: string }

/// Checks a URL's UTM tags against the registry. Reports rather than rejects —
/// this is a lint for the operator building a campaign link, and refusing a tag
/// somebody has already spent money on would lose the attribution entirely.
export function checkUtm(params: {
  utm_source?: string | null
  utm_medium?: string | null
}): UtmProblem[] {
  const problems: UtmProblem[] = []

  const check = (
    field: 'utm_source' | 'utm_medium',
    value: string | null | undefined,
    approved: readonly string[],
  ) => {
    if (!value) return
    if (value !== value.toLowerCase()) {
      problems.push({
        field,
        value,
        problem: `Use lower case. “${value}” and “${value.toLowerCase()}” become two separate rows in every report.`,
      })
      return
    }
    if (!approved.includes(value)) {
      problems.push({
        field,
        value,
        problem: `“${value}” is not in the approved list. Add it there first, or the report grows a column nobody recognises.`,
      })
    }
  }

  check('utm_source', params.utm_source, APPROVED_UTM_SOURCES)
  check('utm_medium', params.utm_medium, APPROVED_UTM_MEDIUMS)
  return problems
}
