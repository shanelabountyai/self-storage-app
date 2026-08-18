// PRD 02 §4.6 US-30 (B-083). Mailing a lien notice by certified mail, and the
// proof that comes back.
//
// Everything here is pure: building the request, deciding whether an address is
// mailable, turning a provider response into evidence, and judging whether a
// given API key may be used in a given environment. The HTTP call itself lives
// in apps/web/lib/notices/certified-mail.ts.
//
// **There is deliberately no simulator, and this is the strongest case in the
// repo for that rule.** A simulated gate is a device we control (D-4). A
// simulated Search Console verdict was refused in B-082 part 5 because it is a
// claim about what Google did. A simulated certified-mail receipt is a claim
// about what the POSTAL SERVICE did, written into the evidence chain that
// defends a lien sale under Texas Property Code ch. 59 — a fabricated tracking
// number there is not a bad screen, it is a document produced in litigation.
// Unconfigured therefore means the button is not offered and the screen names
// the missing variables; staff record the mailing by hand exactly as they do
// today.

/// What the provider needs to put a letter in the post. Built from the address
/// SNAPSHOTTED on the notice (US-13), never from the tenant's current address:
/// the envelope has to match what the notice says it was sent to, and a tenant
/// who moved between generation and mailing must not silently redirect it.
export type MailingAddress = {
  name: string
  line1: string
  line2: string | null
  city: string
  state: string
  postalCode: string
}

export type AddressResult =
  | { ok: true; address: MailingAddress }
  /// Which parts are missing, so the refusal can name them rather than saying
  /// "bad address" about a record somebody has to go and fix.
  | { ok: false; missing: string[] }

const ADDRESS_LABELS: Record<string, string> = {
  name: 'recipient name',
  line1: 'street address',
  city: 'city',
  state: 'state',
  postalCode: 'postal code',
}

/// Turns the notice's rendered-address snapshot into something mailable, or
/// says what is missing.
///
/// `line2` is genuinely optional; every other part is not. A letter posted with
/// a blank city is a letter that comes back, and it would come back AFTER the
/// deadline the notice sets.
export function mailingAddress(input: {
  name: string | null | undefined
  line1: string | null | undefined
  line2: string | null | undefined
  city: string | null | undefined
  state: string | null | undefined
  postalCode: string | null | undefined
}): AddressResult {
  const trimmed = {
    name: input.name?.trim() ?? '',
    line1: input.line1?.trim() ?? '',
    line2: input.line2?.trim() || null,
    city: input.city?.trim() ?? '',
    state: input.state?.trim() ?? '',
    postalCode: input.postalCode?.trim() ?? '',
  }

  const missing = (['name', 'line1', 'city', 'state', 'postalCode'] as const)
    .filter((key) => trimmed[key] === '')
    .map((key) => ADDRESS_LABELS[key])

  if (missing.length > 0) return { ok: false, missing }
  return { ok: true, address: trimmed as MailingAddress }
}

/// The provider's letter request.
///
/// `extraService: 'certified'` is the whole point — it is what produces a
/// tracking number and a green card rather than an ordinary letter, and a
/// request that omitted it would post something that looks identical in our
/// records and is not certified mail in a courtroom.
export type LetterRequest = {
  description: string
  to: MailingAddress
  from: MailingAddress
  /// The notice's own rendered HTML — the same bytes `documentHash` covers, so
  /// what was mailed is what was hashed.
  html: string
  extraService: 'certified'
  color: false
  doubleSided: false
}

export function letterRequest(input: {
  noticeId: string
  noticeLabel: string
  to: MailingAddress
  from: MailingAddress
  html: string
}): LetterRequest {
  return {
    // The notice id is in the description so a letter found in the provider's
    // dashboard can be traced back to the record without a lookup table.
    description: `${input.noticeLabel} — notice ${input.noticeId}`,
    to: input.to,
    from: input.from,
    html: input.html,
    extraService: 'certified',
    // Black and white, single sided. A legal notice is not a brochure, and both
    // flags change the price.
    color: false,
    doubleSided: false,
  }
}

/// What the provider sends back. Only the fields that become evidence are
/// modelled; the rest of the response is deliberately ignored rather than
/// stored, because a record we do not read is a record nobody maintains.
export type LetterResponse = {
  id?: unknown
  tracking_number?: unknown
  expected_delivery_date?: unknown
  carrier?: unknown
  url?: unknown
}

export type ProofResult =
  | { ok: true; proof: Record<string, string> }
  | { ok: false; reason: string }

/// Turns a provider response into the delivery proof recorded on the notice.
///
/// **A response without a tracking number is a failure, not a partial success.**
/// The tracking number IS the proof of certified mailing; recording a delivery
/// without one would produce a `Notice` row that reads as served, satisfies the
/// auction pipeline's served-notice precondition, and has nothing behind it.
/// Better to refuse and let somebody look at the provider dashboard.
export function proofFromLetter(response: LetterResponse): ProofResult {
  const tracking = typeof response.tracking_number === 'string' ? response.tracking_number.trim() : ''
  if (!tracking) {
    return {
      ok: false,
      reason:
        'The mail provider accepted the letter but returned no tracking number, so there is no proof of certified mailing to record. Check the provider dashboard before sending again — the letter may already be in the post.',
    }
  }

  const proof: Record<string, string> = { tracking_number: tracking }
  // Optional extras, each only recorded when the provider actually sent it. An
  // empty string in an evidence field is worse than an absent key: it reads as
  // "we asked and got nothing" rather than "we did not ask".
  if (typeof response.id === 'string' && response.id.trim()) proof.provider_id = response.id.trim()
  if (typeof response.carrier === 'string' && response.carrier.trim()) proof.carrier = response.carrier.trim()
  if (typeof response.expected_delivery_date === 'string' && response.expected_delivery_date.trim()) {
    proof.expected_delivery = response.expected_delivery_date.trim()
  }
  if (typeof response.url === 'string' && response.url.trim()) proof.provider_url = response.url.trim()

  return { ok: true, proof }
}

// ------------------------------------------------------- key safety ----

export type KeyMode = 'test' | 'live' | 'unknown'

/// Which kind of key this is, by the provider's own documented prefix.
export function apiKeyMode(key: string): KeyMode {
  const trimmed = key.trim()
  if (trimmed.startsWith('test_')) return 'test'
  if (trimmed.startsWith('live_')) return 'live'
  return 'unknown'
}

export type KeyVerdict = { allowed: true } | { allowed: false; reason: string }

/// Whether a key may be used in this environment — refused in BOTH directions,
/// and the second direction is the one that matters most.
///
/// A **live key outside production** puts real paper in a real mailbox from a
/// laptop or a preview deploy. Email has a sandbox inbox for this (FR-20); post
/// has no such thing, because a letter that has been collected cannot be
/// recalled. So the refusal is absolute rather than redirected.
///
/// A **test key in production** is worse in a quieter way: the provider accepts
/// the letter, returns a well-formed tracking number, mails NOTHING, and we
/// write that number into a lien file as proof of service. That is a fabricated
/// evidence record produced by a configuration mistake — precisely the outcome
/// this module refuses to build a simulator for, arrived at through the back
/// door.
export function keyAllowed(mode: KeyMode, isProduction: boolean): KeyVerdict {
  if (mode === 'unknown') {
    return {
      allowed: false,
      reason:
        'That mail-provider key is neither a test key nor a live key by its prefix, so this system cannot tell whether sending would put real paper in the post. Check the key.',
    }
  }
  if (mode === 'live' && !isProduction) {
    return {
      allowed: false,
      reason:
        'A live mail-provider key is refused outside production: it would post a real legal notice to a real tenant from a non-production environment, and a letter already collected cannot be recalled. Use a test key here.',
    }
  }
  if (mode === 'test' && isProduction) {
    return {
      allowed: false,
      reason:
        'A test mail-provider key is refused in production: it returns a valid-looking tracking number and mails nothing, which would write proof of a service that never happened into a lien file.',
    }
  }
  return { allowed: true }
}
