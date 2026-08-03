import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// PRD 03 SR-2: "viewing a tenant's actual code is a separate, audited
// permission (default masked ••••)." That is only possible if the code is
// retrievable — so it is stored encrypted at rest, not merely referenced.
//
// This is a different kind of secret from B-028's hardware-webhook signing
// key. That one only has to agree with itself within a single sign-then-verify
// call, so an ephemeral per-process value was honest and harmless. This key
// has to decrypt codes written by a PREVIOUS process, possibly a different
// serverless instance entirely — an ephemeral key would make every code
// permanently unrecoverable the moment the process that wrote it recycled.
// There is no safe dev fallback here: unconfigured means reveal is
// unavailable, the same posture B-025 takes when Stripe has no key.

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

export function accessCodeEncryptionKey(): Buffer | null {
  const raw = process.env.ACCESS_CODE_ENCRYPTION_KEY
  if (!raw) return null
  const key = Buffer.from(raw, 'hex')
  // A silently-truncated or wrong-length key would encrypt fine and fail to
  // decrypt ever, for every code, discovered only when someone tries to read
  // one back — worth rejecting immediately instead.
  if (key.length !== 32) return null
  return key
}

/// `enc:<iv>:<authTag>:<ciphertext>`, all hex. Stored directly in
/// `AccessCredential.valueRef`.
export function encryptCode(code: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`
}

export class CodeNotRevealableError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'CodeNotRevealableError'
  }
}

/// Decrypts a `valueRef`. Throws rather than returning null on any failure —
/// a caller silently showing an empty gate code is a worse outcome than one
/// that has to handle an explicit error, and every failure mode here (wrong
/// key, tampered ciphertext, an `unrevealable:` row) is something the caller
/// needs to tell a human about rather than paper over.
export function decryptCode(valueRef: string, key: Buffer): string {
  if (!valueRef.startsWith('enc:')) {
    throw new CodeNotRevealableError('This credential was issued without a recoverable code.')
  }
  const [, ivHex, authTagHex, ciphertextHex] = valueRef.split(':')
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ])
    return plaintext.toString('utf8')
  } catch {
    // setAuthTag makes a wrong key or tampered ciphertext throw here, by
    // design — GCM's whole point is that a modified ciphertext fails to
    // authenticate rather than decrypting to silently wrong plaintext.
    throw new CodeNotRevealableError('This code could not be decrypted with the current key.')
  }
}

/// A stand-in `valueRef` for when no encryption key is configured. Distinct
/// from `enc:` so `decryptCode` can tell "not encrypted" from "encrypted but
/// wrong key" — the two want different messages.
export function unrevealableRef(): string {
  return `unrevealable:${randomBytes(16).toString('hex')}`
}

/// FR-2's uniqueness check, and the reason `codeHash` exists at all: it lets
/// "is this exact code already active at this facility" be an indexed lookup
/// instead of decrypting every credential on file.
export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}
