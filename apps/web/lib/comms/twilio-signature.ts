import { createHmac, timingSafeEqual } from 'node:crypto'

// PRD 05 FR-14 (B-074). Twilio signs inbound webhooks (the SMS status
// callback and, here, inbound STOP/HELP/START) with `X-Twilio-Signature`.
//
// Same reasoning as `webhook-signature.ts` (Resend/Svix): this is the whole
// security boundary of a public unauthenticated endpoint. Unlike Svix's
// timestamped scheme, Twilio's algorithm is URL + form-params, no timestamp —
// so there is no freshness check here, only the signature. A replayed old
// inbound STOP is harmless (`suppress()` is an idempotent upsert; re-applying
// "this number opted out" changes nothing), which is exactly the property
// that makes the missing timestamp a non-issue rather than a gap.
//
// No `twilio` SDK dependency, same rule as Resend: the scheme is one HMAC-SHA1
// over a string Twilio's own docs specify byte-for-byte, and a package whose
// job is that one computation is supply-chain surface this does not need.

/// Twilio's algorithm: take the full request URL, then for a form-encoded
/// POST, sort the parameters by key (byte order) and append each key
/// immediately followed by its value — no separator — directly onto the URL.
/// HMAC-SHA1 that string with the auth token, base64-encode the digest.
function digestFor(authToken: string, url: string, params: Record<string, string>): Buffer {
  const sorted = Object.keys(params).sort()
  const signed = sorted.reduce((acc, key) => `${acc}${key}${params[key]}`, url)
  return createHmac('sha1', authToken).update(signed, 'utf8').digest()
}

/// Produces the `X-Twilio-Signature` header value for a request. Only tests
/// send; exists so a test can prove the verifier accepts a genuine signature,
/// not only that it rejects garbage.
export function signTwilioRequest(authToken: string, url: string, params: Record<string, string>): string {
  return digestFor(authToken, url, params).toString('base64')
}

/// Whether the header carries a valid signature for this exact URL and
/// form body. `url` must be the EXACT URL Twilio was configured to call
/// (scheme, host, path, query string) — a proxy that rewrites the host or
/// terminates TLS differently than what is configured in the Twilio console
/// breaks this by construction, which is Twilio's own documented caveat, not
/// a bug in this check.
export function verifyTwilioSignature(input: {
  authToken: string
  url: string
  params: Record<string, string>
  header: string
}): boolean {
  const expected = digestFor(input.authToken, input.url, input.params)
  let given: Buffer
  try {
    given = Buffer.from(input.header, 'base64')
  } catch {
    return false
  }
  // timingSafeEqual throws on a length mismatch, so the length is checked
  // rather than caught — a throw here would 500 instead of rejecting.
  return given.length === expected.length && timingSafeEqual(given, expected)
}
