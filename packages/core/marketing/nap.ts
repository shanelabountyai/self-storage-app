// PRD 04 FR-SEO-7 (B-066). Name, address, phone — formatted in exactly one
// place.
//
// "A single formatting utility guarantees consistency." That is not a tidiness
// note. Local search ranking leans on NAP consistency: a footer that writes
// "Ste 200" where the schema writes "Suite 200" and the header writes nothing
// at all reads to an aggregator as three plausibly-different businesses, and
// the citation signal splits three ways.
//
// So every surface — header, footer, contact block, JSON-LD, lease document,
// email footer — formats through here, and nothing hand-assembles an address
// from its parts again.

export type NapSource = {
  name: string
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  postalCode: string
  phone: string | null
}

/// The address on one line: "2400 South Congress Ave, Suite 200, Austin, TX
/// 78704". What a footer or a contact block prints.
export function formatStreetAddress(facility: NapSource): string {
  return [
    facility.addressLine1,
    facility.addressLine2,
    facility.city,
    `${facility.state} ${facility.postalCode}`,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ')
}

/// The same address over several lines, for a card or a letterhead. Same parts,
/// same order, same spelling — only the separator differs.
export function addressLines(facility: NapSource): string[] {
  return [
    facility.addressLine1,
    facility.addressLine2,
    `${facility.city}, ${facility.state} ${facility.postalCode}`,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
}

/// Digits only, with a leading `+1` for a ten-digit US number. What a `tel:`
/// href and schema.org's `telephone` both want.
///
/// Returns null rather than a broken href when there is no number: a
/// `tel:` link that dials nothing is worse than a page with no call button,
/// because the renter believes they tried.
export function telHref(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  // Anything else is left as the operator typed it, minus separators. An
  // international or extension format is a real thing a facility may have, and
  // rejecting it would silently drop the phone number from the page.
  return digits.length > 0 ? `+${digits}` : null
}

/// "(512) 555-0100" for a ten-digit US number; otherwise exactly what the
/// operator typed. Never invents punctuation for a shape it does not recognise.
export function formatPhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (local.length !== 10) return phone.trim()
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
}

/// FR-SEO-3's title template: `{Facility Name} | Storage Units in {City},
/// {State}`.
///
/// The PRD writes it with a pipe and this follows it exactly, even though the
/// rest of the app uses a middot — a title template is a thing an SEO audit
/// will be run against, and matching the spec character for character is
/// cheaper than explaining the deviation later.
export function facilityTitle(facility: Pick<NapSource, 'name' | 'city' | 'state'>): string {
  return `${facility.name} | Storage Units in ${facility.city}, ${facility.state}`
}

/// A meta description that stays inside the ~155 characters search engines
/// render, without truncating mid-word.
///
/// Built from the facility record rather than written per site, because a
/// missing description is worse than a formulaic one: the engine invents its
/// own from page text, and what it picks is usually the cookie banner.
export function facilityDescription(
  facility: Pick<NapSource, 'name' | 'city' | 'state'>,
  extras: { lowestRate?: string | null } = {},
): string {
  const price = extras.lowestRate ? ` from ${extras.lowestRate}/mo` : ''
  return truncateAtWord(
    `Self-storage units${price} at ${facility.name} in ${facility.city}, ${facility.state}. Compare sizes, see gate hours, and rent online in minutes.`,
    155,
  )
}

export function truncateAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,.\s]+$/, '')}…`
}
