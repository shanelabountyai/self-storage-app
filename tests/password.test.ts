import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../apps/web/lib/auth/password'

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('Correct horse battery staple', hash)).resolves.toBe(false)
    await expect(verifyPassword('', hash)).resolves.toBe(false)
  })

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('hunter2000'), hashPassword('hunter2000')])
    expect(a).not.toEqual(b)
    await expect(verifyPassword('hunter2000', a)).resolves.toBe(true)
    await expect(verifyPassword('hunter2000', b)).resolves.toBe(true)
  })

  it('never stores the password in the hash', async () => {
    const hash = await hashPassword('plaintext-leak-canary')
    expect(hash).not.toContain('plaintext-leak-canary')
  })

  it('refuses passwords under 8 characters', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 8/)
  })

  it('treats a missing hash as a failed login rather than an error', async () => {
    await expect(verifyPassword('anything', null)).resolves.toBe(false)
    await expect(verifyPassword('anything', undefined)).resolves.toBe(false)
  })

  it('rejects malformed and tampered hashes instead of throwing', async () => {
    const hash = await hashPassword('correct horse battery staple')
    const [, n, r, p, salt] = hash.split('$')

    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false)
    await expect(verifyPassword('x', 'scrypt$a$b$c$d$e')).resolves.toBe(false)
    // Truncated derived key must not pass by comparing only a prefix.
    await expect(
      verifyPassword('correct horse battery staple', `scrypt$${n}$${r}$${p}$${salt}$AAAA`),
    ).resolves.toBe(false)
  })

  it('normalizes unicode so the same typed password verifies', async () => {
    // U+00E9 vs e + U+0301 — visually identical, different bytes.
    const hash = await hashPassword('passwordé123')
    await expect(verifyPassword('passwordé123', hash)).resolves.toBe(true)
  })

  it('flags weaker legacy parameters for rehash', async () => {
    const current = await hashPassword('correct horse battery staple')
    expect(needsRehash(current)).toBe(false)
    expect(needsRehash('scrypt$1024$8$1$c2FsdA==$aGFzaA==')).toBe(true)
    expect(needsRehash('bcrypt$2b$10$whatever')).toBe(true)
    expect(needsRehash(null)).toBe(false)
  })
})
