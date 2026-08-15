// PRD 04 FR-LEAD-2 (B-068). Where a lead actually came from.
//
// "Channel derivation rules: `utm_source` → mapped channel; no UTMs +
// search-engine referrer → `organic`; no referrer → `direct`;
// operator-selectable `aggregator`, `walk_in`, `phone` for manually created
// leads."
//
// This is the number an owner uses to decide where to spend, so the rules are
// written down once and tested rather than inferred at each call site. The
// specific failure to avoid: everything that is not obviously paid landing in
// `direct`, which makes organic search look worthless and is the classic way
// software talks an operator into defunding the channel that was working.

export const MARKETING_CHANNELS = [
  'paid_search',
  'paid_social',
  'organic',
  'organic_social',
  'email',
  'referral',
  'aggregator',
  'direct',
  /// B-097's counter capture. Present so one vocabulary covers every lead.
  'phone',
  'walk_in',
  /// PRD 10 FR-REF-3 (B-100). A tenant's own referral link, and deliberately
  /// NOT `referral` above — that one means a link from another website, and
  /// the two have completely different costs. One is free traffic somebody
  /// else chose to send; this one is traffic the business pays $50 twice for.
  /// The report exists to tell them apart, so the vocabulary has to.
  'referral_tenant',
] as const

export type MarketingChannel = (typeof MARKETING_CHANNELS)[number]

/// `utm_medium` is the field that actually distinguishes paid from organic —
/// `utm_source: google` says nothing about whether money changed hands.
const PAID_MEDIUMS = ['cpc', 'ppc', 'paidsearch', 'paid', 'sem', 'display', 'banner', 'retargeting']
const SOCIAL_MEDIUMS = ['social', 'social-paid', 'paid-social', 'sm']
const EMAIL_MEDIUMS = ['email', 'newsletter', 'e-mail']

const SOCIAL_HOSTS = [
  'facebook.',
  'instagram.',
  'twitter.',
  'x.com',
  't.co',
  'linkedin.',
  'pinterest.',
  'reddit.',
  'tiktok.',
  'nextdoor.',
  'youtube.',
]

/// Hosts whose visits are search, not referral. Deliberately a list rather than
/// a "contains the word search" heuristic: `researchgate.net` is not a search
/// engine, and misfiling it inflates the number this exists to protect.
const SEARCH_HOSTS = [
  'google.',
  'bing.',
  'duckduckgo.',
  'yahoo.',
  'ecosia.',
  'brave.com',
  'startpage.',
  'baidu.',
  'yandex.',
  'search.',
]

/// The aggregators PRD 04 §2 names as a structural fact of the industry:
/// SpareFoot and the Storable Marketplace charge per completed move-in. A lead
/// from one is not organic and is certainly not direct — it is the most
/// expensive kind there is, and it has to be visible as such.
const AGGREGATOR_HOSTS = ['sparefoot.', 'storable.', 'selfstorage.com', 'storagefront.', 'yelp.']

export type AttributionInput = {
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  /// Google's click identifier. Its presence alone is proof of a paid click,
  /// even when the UTM tags were stripped by a redirect — which happens.
  gclid?: string | null
  /// The `Referer` header, as sent.
  referrer?: string | null
  /// The site's own host, so a visit from one of our own pages is not counted
  /// as a referral from ourselves.
  selfHost?: string | null
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function matches(host: string, needles: readonly string[]): boolean {
  return needles.some((needle) => host.includes(needle))
}

/// FR-LEAD-2's derivation, in the order the rules are stated.
export function deriveChannel(input: AttributionInput): MarketingChannel {
  const source = input.utmSource?.trim().toLowerCase() ?? ''
  const medium = input.utmMedium?.trim().toLowerCase() ?? ''

  // A gclid outranks everything. It is only ever set by an ad click, and
  // trusting a stripped `utm_medium` over it would file paid traffic as
  // organic — the single most expensive misattribution available here.
  if (input.gclid?.trim()) return 'paid_search'

  if (medium) {
    if (PAID_MEDIUMS.includes(medium)) {
      return SOCIAL_MEDIUMS.includes(medium) || matches(source, SOCIAL_HOSTS) || isSocialName(source)
        ? 'paid_social'
        : 'paid_search'
    }
    if (SOCIAL_MEDIUMS.includes(medium)) return 'paid_social'
    if (EMAIL_MEDIUMS.includes(medium)) return 'email'
    if (medium === 'referral') return 'referral'
    if (medium === 'organic') return isSocialName(source) ? 'organic_social' : 'organic'
    if (medium === 'aggregator') return 'aggregator'
  }

  // A source with no medium still tells us something.
  if (source) {
    if (matches(source, AGGREGATOR_HOSTS) || source === 'sparefoot') return 'aggregator'
    if (isSocialName(source)) return 'organic_social'
    if (source === 'google' || source === 'bing') return 'organic'
    return 'referral'
  }

  const host = hostOf(input.referrer)
  // No UTMs and no referrer: somebody typed the address, used a bookmark, or
  // arrived from an app that strips the header. `direct` is the honest label
  // for "we cannot tell", and it is deliberately last.
  if (!host) return 'direct'
  if (input.selfHost && host.includes(input.selfHost.toLowerCase())) return 'direct'
  if (matches(host, AGGREGATOR_HOSTS)) return 'aggregator'
  if (matches(host, SEARCH_HOSTS)) return 'organic'
  if (matches(host, SOCIAL_HOSTS)) return 'organic_social'
  return 'referral'
}

function isSocialName(source: string): boolean {
  return ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'pinterest', 'reddit', 'nextdoor'].includes(
    source,
  )
}

export type TouchPoint = {
  source: string | null
  medium: string | null
  campaign: string | null
  landingPage: string | null
  channel: MarketingChannel
}

export function touchFrom(
  input: AttributionInput & { landingPage?: string | null },
): TouchPoint {
  return {
    source: input.utmSource?.trim() || null,
    medium: input.utmMedium?.trim() || null,
    campaign: input.utmCampaign?.trim() || null,
    landingPage: input.landingPage?.trim() || null,
    channel: deriveChannel(input),
  }
}

/// FR-LEAD-2: "First-touch UTMs + landing page persisted 90 days; last-touch
/// updated each session."
export const ATTRIBUTION_COOKIE_DAYS = 90
export const FIRST_TOUCH_COOKIE = 'st_ft'
export const LAST_TOUCH_COOKIE = 'st_lt'

/// PRD 10 FR-REF-3 (B-100). The referral code a visitor arrived on, kept
/// alongside the touch cookies and for the same 90 days.
///
/// Its OWN cookie rather than a field on the touch, and that is load-bearing:
/// FR-REF-3 says "last-touch does not overwrite a referral. If somebody
/// arrives on a tenant's link and later clicks an ad, the referral still
/// pays." The touch cookie is rewritten on every new session by design, so
/// storing the code in it would delete the tenant's claim the first time the
/// friend clicked anything else — and the alternative teaches tenants the
/// program does not work.
export const REFERRAL_COOKIE = 'st_ref'

/// What goes in the cookie. Short keys because a cookie is sent on every
/// request to the site, and a landing page URL is already long.
export type StoredTouch = { s?: string; m?: string; c?: string; l?: string; ch?: string }

/// Plain JSON, NOT percent-encoded.
///
/// Next's cookie API encodes on write and decodes on read, so encoding here too
/// produced a double-encoded value: correct on the round trip, but only because
/// two layers happened to cancel. Anything reading the cookie by another route
/// — `document.cookie` in B-069's analytics wrapper, or a debugger — would have
/// seen `%257B` and had to know to decode twice.
export function encodeTouch(touch: TouchPoint): string {
  const stored: StoredTouch = {}
  if (touch.source) stored.s = touch.source
  if (touch.medium) stored.m = touch.medium
  if (touch.campaign) stored.c = touch.campaign
  if (touch.landingPage) stored.l = touch.landingPage
  stored.ch = touch.channel
  return JSON.stringify(stored)
}

/// Never throws. A cookie is attacker-controlled input and a malformed one must
/// degrade to "no attribution" rather than taking down a form somebody is
/// trying to submit.
export function decodeTouch(raw: string | null | undefined): TouchPoint | null {
  if (!raw) return null
  try {
    // Tolerates both shapes: plain JSON as written now, and the percent-encoded
    // form earlier builds wrote. A visitor carrying a 90-day-old cookie from
    // before that change must not silently lose their first touch.
    const text = raw.trimStart().startsWith('{') ? raw : decodeURIComponent(raw)
    const stored = JSON.parse(text) as StoredTouch
    if (typeof stored !== 'object' || stored === null) return null
    const channel = (MARKETING_CHANNELS as readonly string[]).includes(stored.ch ?? '')
      ? (stored.ch as MarketingChannel)
      : 'direct'
    return {
      source: str(stored.s),
      medium: str(stored.m),
      campaign: str(stored.c),
      landingPage: str(stored.l),
      channel,
    }
  } catch {
    return null
  }
}

/// Caps what a cookie can put in a database column. Attacker-controlled, so the
/// length limit is not politeness.
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null
}

/// FR-LEAD-1: "unique per (email/phone, facility, 30-day window) with new
/// inquiries appended as activities rather than duplicate leads."
export const DEDUP_WINDOW_DAYS = 30

export function isWithinDedupWindow(existingCreatedAt: Date, now: Date): boolean {
  return now.getTime() - existingCreatedAt.getTime() <= DEDUP_WINDOW_DAYS * 86_400_000
}

/// Normalised keys for matching. Email lower-cased; phone reduced to digits so
/// `(512) 555-0100` and `512-555-0100` are the same person — which they are,
/// and treating them as two leads is how a facility calls somebody twice.
export function dedupKeys(input: { email?: string | null; phone?: string | null }): {
  email: string | null
  phone: string | null
} {
  const digits = input.phone?.replace(/\D/g, '') ?? ''
  return {
    email: input.email?.trim().toLowerCase() || null,
    // Last ten digits, so a number entered with a country code matches one
    // entered without.
    phone: digits.length >= 10 ? digits.slice(-10) : null,
  }
}
