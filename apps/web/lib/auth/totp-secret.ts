import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

// B-079. Encryption at rest for the TOTP shared secret.
//
// The threat this answers is narrow and real: a database dump. Every other
// authentication material in this system is one-way — passwords are argon2
// hashes, recovery codes are SHA-256, auth tokens are stored hashed. A TOTP
// secret cannot be, because the server has to recompute codes from it. So it is
// the one credential a stolen dump would hand over intact, and a second factor
// the attacker can generate is not a second factor.
//
// AES-256-GCM, keyed by HKDF from the same AUTH_SECRET that signs every other
// token here, with its own `info` string so the key is unrelated to the signing
// keys. Rotating AUTH_SECRET invalidates every enrolment and forces re-enrolment,
// which is the correct blast radius and is documented on the enrolment screen.

const VERSION = 1

function encryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET is required to encrypt TOTP secrets')
  }
  return Buffer.from(hkdfSync('sha256', secret, 'storage-totp-secret', `totp-secret-v${VERSION}`, 32))
}

/// Stored as `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version prefix is
/// what makes a future key rotation a migration rather than a guessing game.
export function encryptTotpSecret(base32Secret: string): string {
  // 12 bytes is the GCM standard nonce length — the only size the mode uses
  // directly, without the extra hashing step any other length triggers.
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(base32Secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    `v${VERSION}`,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/// Returns null rather than throwing on anything malformed, tampered with, or
/// encrypted under a different AUTH_SECRET. The caller treats that identically
/// to "not enrolled", which fails closed: an unreadable secret must never be
/// silently skipped past as if MFA had passed.
export function decryptTotpSecret(stored: string): string | null {
  const parts = stored.split('.')
  if (parts.length !== 4 || parts[0] !== `v${VERSION}`) return null

  try {
    const [, iv, tag, ciphertext] = parts
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
    // GCM verifies this on `final()`; a wrong key or a flipped bit throws there
    // rather than returning plausible-looking garbage.
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}
