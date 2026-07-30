import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

// scrypt ships with Node, so there is no native build step and nothing to keep
// patched. N=2^15/r=8/p=1 costs ~32 MB and ~100 ms per hash — enough to make
// offline cracking expensive without pricing out a serverless login.
//
// scrypt needs roughly 128 * N * r bytes, which lands exactly on Node's default
// 32 MB maxmem and fails; the ceiling is raised explicitly with headroom.
const PARAMS = { N: 32768, r: 8, p: 1 }
const MAXMEM = 128 * PARAMS.N * PARAMS.r * 2
const KEY_LENGTH = 64
const SALT_LENGTH = 16

function withMaxmem(params: { N: number; r: number; p: number }) {
  return { ...params, maxmem: Math.max(MAXMEM, 128 * params.N * params.r * 2) }
}

/// Format: scrypt$N$r$p$<salt base64>$<derived key base64>. The parameters are
/// stored with the hash so they can be raised later without invalidating
/// existing passwords.
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }
  const salt = randomBytes(SALT_LENGTH)
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, withMaxmem(PARAMS))
  const { N, r, p } = PARAMS
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

/// Constant-time. Returns false rather than throwing on a malformed or absent
/// hash so callers cannot distinguish "no account" from "wrong password".
export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) {
    // Burn comparable work so a missing account is not measurably faster than
    // a wrong password.
    await scryptAsync(
      password.normalize('NFKC'),
      randomBytes(SALT_LENGTH),
      KEY_LENGTH,
      withMaxmem(PARAMS),
    )
    return false
  }

  const parts = storedHash.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, n, r, p, saltB64, keyB64] = parts
  const params = { N: Number(n), r: Number(r), p: Number(p) }
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return false
  }

  const expected = Buffer.from(keyB64, 'base64')
  const derived = await scryptAsync(
    password.normalize('NFKC'),
    Buffer.from(saltB64, 'base64'),
    expected.length,
    withMaxmem(params),
  )
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

/// True when the stored hash was produced with weaker parameters than we use
/// now, so the caller can transparently re-hash on next successful login.
export function needsRehash(storedHash: string | null | undefined): boolean {
  if (!storedHash) return false
  const parts = storedHash.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true
  return Number(parts[1]) < PARAMS.N || Number(parts[2]) < PARAMS.r || Number(parts[3]) < PARAMS.p
}
