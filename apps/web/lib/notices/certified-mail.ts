import {
  apiKeyMode,
  keyAllowed,
  proofFromLetter,
  type LetterRequest,
  type ProofResult,
} from '@storage/core/notices'

// PRD 02 §4.6 US-30 (B-083). The HTTP half of certified mail.
//
// Written against Lob's documented `POST /v1/letters` REST endpoint with
// `fetch` — no SDK, for the same reason B-082 part 5 hand-rolled the Search
// Console client rather than pulling in `googleapis` for two calls.
//
// The vendor is named rather than abstracted behind an interface with one
// implementation. There is exactly one provider and no second one in prospect;
// the shape that would survive a swap is `sendCertifiedLetter` returning a
// proof record, which is what it does. A second provider earns the port.
//
// **No simulator.** See the header of packages/core/notices/certified-mail.ts:
// a fabricated tracking number is a claim about what the postal service did,
// sitting in the evidence chain for a lien sale.

const LETTERS_URL = 'https://api.lob.com/v1/letters'

/// Long enough for a slow provider, short enough that a staff member pressing a
/// button is not left staring at a spinner. A timeout here is safe to report as
/// a failure BECAUSE the request carries an idempotency key — see `sendCertifiedLetter`.
const TIMEOUT_MS = 20_000

export type MailConfig = { apiKey: string }

export type MailConfigResult =
  | { configured: true; config: MailConfig }
  /// Names the variable rather than saying "not configured", so the screen can
  /// tell an operator exactly what to set.
  | { configured: false; missing: string[] }
  /// Configured, and refused anyway — a live key outside production or a test
  /// key inside it. Distinct from `missing` because the fix is completely
  /// different and the consequence of ignoring it is a mailed or fabricated
  /// legal notice.
  | { configured: false; missing: []; refused: string }

export function certifiedMailConfig(): MailConfigResult {
  const apiKey = process.env.CERTIFIED_MAIL_API_KEY?.trim()
  if (!apiKey) return { configured: false, missing: ['CERTIFIED_MAIL_API_KEY'] }

  const verdict = keyAllowed(apiKeyMode(apiKey), process.env.NODE_ENV === 'production')
  if (!verdict.allowed) return { configured: false, missing: [], refused: verdict.reason }

  return { configured: true, config: { apiKey } }
}

export type SendResult = ProofResult

/// Posts one certified letter and returns the proof to record against the
/// notice, or a refusal in words a staff member can act on.
///
/// Nothing here throws: this is called from a server action behind a button on
/// a screen, and a provider outage has to render as a sentence rather than a
/// 500 — the same rule the notice screen's other refusals follow.
///
/// **`idempotencyKey` is the notice id, and that is load-bearing.** A timeout
/// or a dropped connection after the provider has accepted the letter would
/// otherwise leave us with no record and a staff member pressing the button
/// again — mailing a second copy of a legal notice, with two tracking numbers
/// and no way to say which one was served. With the key, the retry returns the
/// ORIGINAL letter and its original tracking number.
export async function sendCertifiedLetter(
  config: MailConfig,
  idempotencyKey: string,
  request: LetterRequest,
): Promise<SendResult> {
  let response: Response
  try {
    response = await fetch(LETTERS_URL, {
      method: 'POST',
      headers: {
        // Basic auth with the key as the username and an empty password, which
        // is how Lob authenticates.
        Authorization: `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(toProviderBody(request)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    return {
      ok: false,
      reason:
        `The mail provider could not be reached (${error instanceof Error ? error.message : 'network error'}). ` +
        'Nothing has been recorded. Pressing send again is safe — the request carries a key that stops a second copy being posted.',
    }
  }

  if (!response.ok) {
    // The provider's own message, because "400 Bad Request" tells a staff
    // member nothing and the body usually names the field.
    const detail = await response.text().catch(() => '')
    return {
      ok: false,
      reason: `The mail provider refused the letter (HTTP ${response.status}). ${providerMessage(detail)}`.trim(),
    }
  }

  const body = await response.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      reason:
        'The mail provider returned something this system could not read. Check the provider dashboard before sending again — the letter may already be in the post.',
    }
  }

  return proofFromLetter(body as Record<string, unknown>)
}

/// The provider's wire format. Kept here rather than in the pure module so that
/// `LetterRequest` stays a description of what we are asking for, and only this
/// file knows how one vendor spells it.
function toProviderBody(request: LetterRequest): Record<string, unknown> {
  return {
    description: request.description,
    to: addressBody(request.to),
    from: addressBody(request.from),
    file: request.html,
    extra_service: request.extraService,
    color: request.color,
    double_sided: request.doubleSided,
  }
}

function addressBody(address: LetterRequest['to']): Record<string, unknown> {
  return {
    name: address.name,
    address_line1: address.line1,
    address_line2: address.line2 ?? undefined,
    address_city: address.city,
    address_state: address.state,
    address_zip: address.postalCode,
    address_country: 'US',
  }
}

/// Pulls the human-readable part out of an error body, falling back to nothing
/// rather than dumping raw JSON onto an admin screen.
function providerMessage(detail: string): string {
  try {
    const parsed = JSON.parse(detail)
    const message = parsed?.error?.message
    return typeof message === 'string' ? message : ''
  } catch {
    return ''
  }
}
