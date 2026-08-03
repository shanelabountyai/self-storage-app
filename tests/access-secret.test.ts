import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  accessCodeEncryptionKey,
  CodeNotRevealableError,
  decryptCode,
  encryptCode,
  hashCode,
  unrevealableRef,
} from '../apps/web/lib/access/secret'

// B-029 / PRD 03 SR-2. No database needed — this is pure crypto.

describe('gate code encryption', () => {
  const key = randomBytes(32)

  it('round-trips a code through encrypt and decrypt', () => {
    const ref = encryptCode('482913', key)
    expect(ref.startsWith('enc:')).toBe(true)
    expect(decryptCode(ref, key)).toBe('482913')
  })

  it('refuses to decrypt with the wrong key', () => {
    const ref = encryptCode('482913', key)
    expect(() => decryptCode(ref, randomBytes(32))).toThrow(CodeNotRevealableError)
  })

  it('refuses an unrevealable reference rather than returning garbage', () => {
    expect(() => decryptCode(unrevealableRef(), key)).toThrow(CodeNotRevealableError)
  })

  it('rejects a key of the wrong length rather than silently truncating it', () => {
    const original = process.env.ACCESS_CODE_ENCRYPTION_KEY
    process.env.ACCESS_CODE_ENCRYPTION_KEY = 'too-short'
    expect(accessCodeEncryptionKey()).toBeNull()
    process.env.ACCESS_CODE_ENCRYPTION_KEY = original
  })

  it('is unset by default, matching honest-degradation posture', () => {
    const original = process.env.ACCESS_CODE_ENCRYPTION_KEY
    delete process.env.ACCESS_CODE_ENCRYPTION_KEY
    expect(accessCodeEncryptionKey()).toBeNull()
    process.env.ACCESS_CODE_ENCRYPTION_KEY = original
  })

  it('hashes deterministically, for the uniqueness lookup', () => {
    expect(hashCode('482913')).toBe(hashCode('482913'))
    expect(hashCode('482913')).not.toBe(hashCode('482914'))
  })
})
