// PRD 04 US-2, US-5 (B-067). The rules the marketing profile editor enforces.
//
// Pure, so the same guidance drives the editor's counters, the save-time
// validation and the readiness check on the dashboard — three surfaces that
// would otherwise each have their own idea of "too long".

/// US-2 AC3's character guidance. These are what a search result actually
/// renders, not hard limits: Google truncates rather than rejects, and a title
/// of 63 characters is fine while one of 95 is a sentence nobody will read the
/// end of. So the editor WARNS and never blocks — a marketer who wants 70
/// characters has a reason, and refusing them would just move the copy into a
/// spreadsheet.
export const TITLE_IDEAL_MAX = 60
export const TITLE_HARD_MAX = 90
export const DESCRIPTION_IDEAL_MAX = 155
export const DESCRIPTION_HARD_MAX = 200

export type LengthAdvice = {
  length: number
  /// Under the ideal: nothing to say.
  status: 'ok' | 'long' | 'too_long'
  message: string | null
}

export function titleAdvice(value: string): LengthAdvice {
  return advise(value, TITLE_IDEAL_MAX, TITLE_HARD_MAX, 'title')
}

export function descriptionAdvice(value: string): LengthAdvice {
  return advise(value, DESCRIPTION_IDEAL_MAX, DESCRIPTION_HARD_MAX, 'description')
}

function advise(value: string, ideal: number, hard: number, what: string): LengthAdvice {
  const length = value.trim().length
  if (length === 0) {
    return { length, status: 'ok', message: null }
  }
  if (length > hard) {
    return {
      length,
      status: 'too_long',
      // Named as a refusal because this is the one length the save rejects: a
      // 300-character title is not a stylistic choice, it is a paste accident.
      message: `This ${what} is ${length} characters. Anything over ${hard} will not be saved — check for a paste that ran on.`,
    }
  }
  if (length > ideal) {
    return {
      length,
      status: 'long',
      message: `${length} characters. Search results usually show about ${ideal}, so the end of this may be cut off.`,
    }
  }
  return { length, status: 'ok', message: null }
}

/// US-2 AC3: "a duplicate-content warning if the description matches another
/// facility's above a similarity threshold."
///
/// Trigram Jaccard similarity — cheap, order-insensitive enough to catch the
/// real case (somebody pasted Austin's description into Dallas and changed the
/// city), and it does not need a library. Exact-match detection alone would
/// miss precisely that edit, which is the one that happens.
export function similarity(a: string, b: string): number {
  const left = trigrams(a)
  const right = trigrams(b)
  if (left.size === 0 || right.size === 0) return 0

  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return shared / (left.size + right.size - shared)
}

function trigrams(value: string): Set<string> {
  const normalised = value.toLowerCase().replace(/\s+/g, ' ').trim()
  const grams = new Set<string>()
  for (let index = 0; index + 3 <= normalised.length; index += 1) {
    grams.add(normalised.slice(index, index + 3))
  }
  return grams
}

/// Above this, two descriptions are the same description with a city swapped.
///
/// 0.8 rather than 0.95: the near-identical case is what matters, and two
/// genuinely different descriptions of two storage facilities in the same
/// state still share a lot of vocabulary — "climate-controlled", "drive-up",
/// "month-to-month" — so the floor has to sit above ordinary shared language
/// and below a copy-paste.
export const DUPLICATE_THRESHOLD = 0.8

export type DuplicateWarning = { facilityName: string; similarity: number }

export function findDuplicates(
  description: string,
  others: readonly { name: string; metaDescription: string | null }[],
  threshold = DUPLICATE_THRESHOLD,
): DuplicateWarning[] {
  if (!description.trim()) return []
  return others
    .filter((other) => other.metaDescription?.trim())
    .map((other) => ({
      facilityName: other.name,
      similarity: similarity(description, other.metaDescription!),
    }))
    .filter((match) => match.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
}

export type PhotoSummary = { kind: string; alt: string }

export type ReadinessCheck = {
  key: string
  label: string
  ok: boolean
  /// What to do about it, when it is not ok. Written for the person who has to
  /// fix it, not as a restatement of the rule.
  fix: string | null
}

/// B-067's launch gate and the rest of what makes a facility page worth
/// crawling.
///
/// The backlog states the gate plainly: "at least one exterior photo per active
/// facility — with no photos, no CTA and one price, the facility page is
/// currently less persuasive than the search card that links to it."
///
/// Reported rather than enforced. Blocking a facility from going active over a
/// missing photo would take a rentable unit off sale to fix a marketing
/// problem, which is the wrong trade — so this is a checklist a person clears,
/// and the dashboard says how many facilities have not.
export function facilityReadiness(input: {
  photos: readonly PhotoSummary[]
  seoTitle: string | null
  metaDescription: string | null
  longDescription: string | null
  faqCount: number
  hasGateHours: boolean
  hasPhone: boolean
}): ReadinessCheck[] {
  const exterior = input.photos.filter((photo) => photo.kind === 'exterior').length

  return [
    {
      key: 'exterior_photo',
      label: 'At least one exterior photo',
      ok: exterior > 0,
      fix: exterior > 0 ? null : 'Add a photo of the front of the site, so a renter can recognise it from the road.',
    },
    {
      key: 'photo_alt',
      label: 'Every photo has alt text',
      // Structurally guaranteed by the column being NOT NULL, so this only
      // catches whitespace somebody typed to get past the field.
      ok: input.photos.every((photo) => photo.alt.trim().length > 0),
      fix: 'Describe each photo in a few words. Screen readers read it, and so does an image search.',
    },
    {
      key: 'five_photos',
      label: 'Five or more photos',
      ok: input.photos.length >= 5,
      fix: `${input.photos.length} so far. PRD 01 US-103 asks for exterior, gate, hallway, a sample unit and a security feature.`,
    },
    {
      key: 'unique_description',
      label: 'Long-form description written',
      ok: Boolean(input.longDescription?.trim()),
      fix: 'Without this the page reads as a template with the city swapped, which is what a thin-content penalty is.',
    },
    {
      key: 'meta',
      label: 'SEO title and description set',
      ok: Boolean(input.seoTitle?.trim()) && Boolean(input.metaDescription?.trim()),
      fix: 'Generated defaults are in use. They are true, but they are the same shape as every other facility’s.',
    },
    {
      key: 'faqs',
      label: 'Facility-specific FAQs',
      ok: input.faqCount >= 5,
      fix: `${input.faqCount} written. The five generated ones are showing until there are five here.`,
    },
    {
      key: 'gate_hours',
      label: 'Gate hours published',
      ok: input.hasGateHours,
      fix: 'The page says “call for hours”, which is a reason to call somewhere else.',
    },
    {
      key: 'phone',
      label: 'Facility phone number',
      ok: input.hasPhone,
      fix: 'Calls fall back to the main line, and the local number is a local-search signal.',
    },
  ]
}

/// PRD 04 US-5 AC1. The Google Business Profile checklist, as data.
///
/// Manually confirmed at MVP (AC2) — this project does not write to GBP, and
/// the non-goals say so explicitly. The value is that the list exists and has a
/// date against it, not that software checked it.
export const GBP_CHECKLIST = [
  { key: 'nap', label: 'Name, address and phone match this record exactly' },
  { key: 'hours', label: 'Opening hours in GBP match the office hours here' },
  { key: 'website', label: 'Website link points at this facility’s page, with the GBP UTM tags' },
  { key: 'photos', label: 'Ten or more photos on the profile' },
  { key: 'category', label: 'Primary category is “Self-storage facility”' },
  { key: 'posts', label: 'A post in the last 30 days' },
] as const

export type GbpChecklistKey = (typeof GBP_CHECKLIST)[number]['key']

/// AC2: "the system flags items unverified for >90 days."
export const GBP_STALE_DAYS = 90

export function gbpIsStale(verifiedAt: Date | null, now: Date = new Date()): boolean {
  if (!verifiedAt) return true
  return now.getTime() - verifiedAt.getTime() > GBP_STALE_DAYS * 86_400_000
}

/// AC1's UTM tags, so a click from the Google profile is attributable rather
/// than landing in "direct".
export function gbpWebsiteUrl(facilityUrl: string): string {
  const separator = facilityUrl.includes('?') ? '&' : '?'
  return `${facilityUrl}${separator}utm_source=google&utm_medium=organic_gbp`
}
