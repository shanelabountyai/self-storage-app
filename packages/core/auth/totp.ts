import { createHmac, timingSafeEqual } from 'node:crypto'

// PRD 00 §7.1 (B-079): "Staff auth requires MFA (TOTP) from Phase 2."
//
// RFC 4226 (HOTP) and RFC 6238 (TOTP), implemented directly rather than pulled
// in as a dependency. The whole algorithm is an HMAC, a four-byte truncation
// and a modulo — smaller than the package that would wrap it — and it is one
// of the very few crypto constructions with an official, published set of test
// vectors. `tests/totp.test.ts` runs every vector from both RFCs, which is what
// makes hand-rolling this defensible where hand-rolling a cipher would not be.
//
// SHA-1 is correct here and is not the weakness it looks like. RFC 6238 defines
// SHA-1 as the default, every authenticator app (Google Authenticator, 1Password,
// Authy) implements that default, and several ignore the `algorithm=` parameter
// in the enrolment URI entirely. HMAC-SHA1 is not affected by the collision
// attacks that retired bare SHA-1: it needs a preimage, not a collision.

/// RFC 4648 §6. No padding — authenticator apps universally reject '='.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/// Tolerant of the spaces and lowercase a person types when copying a secret by
/// hand, and of the '=' padding some issuers emit. Throws on anything else
/// rather than silently decoding to the wrong bytes — a secret that decodes to
/// garbage produces codes that never match, which is a miserable thing to debug.
export function base32Decode(encoded: string): Uint8Array {
  const cleaned = encoded.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (cleaned === '') return new Uint8Array(0)

  let bits = 0
  let value = 0
  const out: number[] = []

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index < 0) throw new Error(`"${char}" is not a base32 character`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return Uint8Array.from(out)
}

export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6

/// RFC 4226 §5.3. The counter is eight bytes, big-endian.
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8)
  // A JS number holds counter values well past year 275760 at a 30-second step,
  // but bitwise operators truncate to 32 bits — so the high word is written with
  // arithmetic and only the low word with `writeUInt32BE`.
  message.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0)
  message.writeUInt32BE(counter >>> 0, 4)

  const digest = createHmac('sha1', Buffer.from(secret)).update(message).digest()

  // Dynamic truncation: the low nibble of the last byte picks the offset.
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]

  return String(binary % 10 ** digits).padStart(digits, '0')
}

/// Which 30-second window a moment falls in. Exported because the replay guard
/// stores it: a code is only good once, and "once" is measured in steps.
export function totpStep(atMs: number, stepSeconds = TOTP_STEP_SECONDS): number {
  return Math.floor(atMs / 1000 / stepSeconds)
}

export function totpCode(
  secret: Uint8Array,
  atMs: number,
  options: { digits?: number; stepSeconds?: number } = {},
): string {
  return hotp(secret, totpStep(atMs, options.stepSeconds), options.digits)
}

export type TotpVerification =
  | { ok: true; step: number }
  | { ok: false; reason: 'malformed' | 'no_match' | 'replayed' }

/// Checks a submitted code against the steps within `window` either side of now.
///
/// `lastUsedStep` is the replay guard and is not optional in practice: without
/// it a code shoulder-surfed or read off a shared screen stays valid for the
/// rest of its window plus the drift either side — around 90 seconds, which is
/// ample for someone standing behind you. Callers persist the returned `step`.
///
/// The comparison is constant-time. The timing signal from a plain `===` on a
/// six-digit code is small, but it is free to remove.
export function verifyTotp(
  secret: Uint8Array,
  submitted: string,
  atMs: number,
  options: { window?: number; digits?: number; stepSeconds?: number; lastUsedStep?: number | null } = {},
): TotpVerification {
  const digits = options.digits ?? TOTP_DIGITS
  const code = submitted.replace(/[\s-]/g, '')
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return { ok: false, reason: 'malformed' }

  // One step either side. RFC 6238 §5.2 recommends "at most one" — each extra
  // step widens the window a stolen code stays live in, and clock drift beyond
  // 30 seconds on a phone is rare enough not to pay for.
  const window = options.window ?? 1
  const current = totpStep(atMs, options.stepSeconds)

  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset
    if (step < 0) continue
    const expected = hotp(secret, step, digits)
    if (!constantTimeEquals(expected, code)) continue
    if (options.lastUsedStep != null && step <= options.lastUsedStep) {
      return { ok: false, reason: 'replayed' }
    }
    return { ok: true, step }
  }

  return { ok: false, reason: 'no_match' }
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/// The `otpauth://` URI an authenticator app scans. Every label component is
/// percent-encoded: a facility named "Acme Storage / North" would otherwise
/// inject a path separator and produce a QR code that enrols under the wrong
/// account name.
export function otpauthUri(input: {
  secret: string
  account: string
  issuer: string
  digits?: number
  stepSeconds?: number
}): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(input.digits ?? TOTP_DIGITS),
    period: String(input.stepSeconds ?? TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/// Groups a base32 secret for the "can't scan the code?" fallback. Someone
/// typing 32 unbroken characters off a screen into a phone will lose their
/// place; four-character groups are what every issuer displays.
export function formatSecretForDisplay(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ')
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10

export const RECOVERY_CODE_LENGTH = 10

/// Codes are ten characters, shown as `xxxxx-xxxxx`. Ten, where a TOTP code is
/// six: the login form takes both in one field and tells them apart by length
/// alone, which is what lets somebody who has lost their phone sign in without
/// first having to find a different form.
///
/// The alphabet is base32 lowercased — 32 characters, so `& 31` maps a byte
/// onto it with no modulo bias, and it contains no 0 or 1 at all. That last
/// part matters more than it looks: these get written on paper and read back
/// weeks later, and 0/O and 1/I is where that goes wrong. Since neither digit
/// is a legal character, `normalizeRecoveryCode` can simply fold them.
const RECOVERY_ALPHABET = BASE32_ALPHABET.toLowerCase()

export function recoveryCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < RECOVERY_CODE_LENGTH) {
    throw new Error(`recoveryCodeFromBytes needs ${RECOVERY_CODE_LENGTH} bytes`)
  }
  let out = ''
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i += 1) {
    out += RECOVERY_ALPHABET[bytes[i] & 31]
    if (i === 4) out += '-'
  }
  return out
}

/// Lowercases, drops the separator, and folds the two digits nobody can read
/// back reliably onto the letters they are always mistaken for. The stored hash
/// must not depend on how carefully somebody retyped it.
export function normalizeRecoveryCode(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
}

export function looksLikeRecoveryCode(input: string): boolean {
  return normalizeRecoveryCode(input).length === RECOVERY_CODE_LENGTH
}
