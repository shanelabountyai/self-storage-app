import { describe, expect, it } from 'vitest'
import {
  base32Decode,
  base32Encode,
  formatSecretForDisplay,
  hotp,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
  otpauthUri,
  recoveryCodeFromBytes,
  totpCode,
  totpStep,
  verifyTotp,
} from '../packages/core/auth/totp'

// B-079 / PRD 00 §7.1. The reason this codebase is allowed to implement RFC
// 4226 and RFC 6238 itself rather than take a dependency: both RFCs publish
// official test vectors, and every one of them runs below. If any of these
// fail, staff MFA is broken in a way no amount of manual testing with one
// phone would reliably catch.

// RFC 4226 Appendix D / RFC 6238 Appendix B both use this seed: the ASCII
// string "12345678901234567890".
const SEED = new TextEncoder().encode('12345678901234567890')

describe('HOTP — RFC 4226 Appendix D', () => {
  const VECTORS = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ]

  it.each(VECTORS.map((code, counter) => ({ counter, code })))(
    'counter $counter is $code',
    ({ counter, code }) => {
      expect(hotp(SEED, counter)).toBe(code)
    },
  )
})

describe('TOTP — RFC 6238 Appendix B (SHA-1)', () => {
  // The published table is 8-digit. The 6-digit code every authenticator app
  // shows is the same truncation modulo 10^6, so both are asserted from one
  // source of truth.
  const VECTORS = [
    { seconds: 59, eight: '94287082' },
    { seconds: 1_111_111_109, eight: '07081804' },
    { seconds: 1_111_111_111, eight: '14050471' },
    { seconds: 1_234_567_890, eight: '89005924' },
    { seconds: 2_000_000_000, eight: '69279037' },
    { seconds: 20_000_000_000, eight: '65353130' },
  ]

  it.each(VECTORS)('T=$seconds gives $eight', ({ seconds, eight }) => {
    expect(totpCode(SEED, seconds * 1000, { digits: 8 })).toBe(eight)
    expect(totpCode(SEED, seconds * 1000)).toBe(eight.slice(-6))
  })

  it('does not truncate a counter past 2^32', () => {
    // Every published vector sits inside 32 bits, so none of them exercises the
    // high word of the eight-byte counter. A `<<`-based implementation would
    // silently wrap here and agree with the vectors anyway.
    const low = 7n
    expect(hotp(SEED, Number(low))).not.toBe(hotp(SEED, Number(2n ** 32n + low)))
  })
})

describe('base32', () => {
  // RFC 4648 §10 test vectors, minus the padding this codebase never emits.
  const VECTORS: [string, string][] = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ]

  it.each(VECTORS)('encodes %j as %j', (plain, encoded) => {
    expect(base32Encode(new TextEncoder().encode(plain))).toBe(encoded)
  })

  it.each(VECTORS)('decodes back to %j', (plain, encoded) => {
    expect(new TextDecoder().decode(base32Decode(encoded))).toBe(plain)
  })

  it('tolerates how a person actually types a secret', () => {
    expect(base32Decode('mzxw 6ytb-oi')).toEqual(base32Decode('MZXW6YTBOI'))
    expect(base32Decode('MZXW6YTBOI======')).toEqual(base32Decode('MZXW6YTBOI'))
  })

  it('throws on a character that is not base32', () => {
    // Silently skipping it would decode to different bytes than the app has,
    // producing codes that never match and no clue why.
    expect(() => base32Decode('MZXW6YTB0I')).toThrow(/not a base32/)
  })
})

describe('verifyTotp', () => {
  const now = 1_700_000_000_000

  it('accepts the current code', () => {
    const result = verifyTotp(SEED, totpCode(SEED, now), now)
    expect(result).toEqual({ ok: true, step: totpStep(now) })
  })

  it('accepts one step of drift either way', () => {
    expect(verifyTotp(SEED, totpCode(SEED, now - 30_000), now).ok).toBe(true)
    expect(verifyTotp(SEED, totpCode(SEED, now + 30_000), now).ok).toBe(true)
  })

  it('refuses two steps out', () => {
    expect(verifyTotp(SEED, totpCode(SEED, now - 61_000), now)).toEqual({
      ok: false,
      reason: 'no_match',
    })
  })

  it('refuses a code that has already been used', () => {
    // The whole point of the replay guard: without it, a code read over
    // somebody's shoulder stays good for the rest of its window plus the drift
    // either side.
    const step = totpStep(now)
    expect(verifyTotp(SEED, totpCode(SEED, now), now, { lastUsedStep: step })).toEqual({
      ok: false,
      reason: 'replayed',
    })
  })

  it('refuses an EARLIER step than the last one used', () => {
    // A stored code from the previous window is still inside the drift window,
    // so `<=` rather than `===` is load-bearing.
    const previous = totpCode(SEED, now - 30_000)
    expect(verifyTotp(SEED, previous, now, { lastUsedStep: totpStep(now) })).toEqual({
      ok: false,
      reason: 'replayed',
    })
  })

  it('still accepts the NEXT code after one is used', () => {
    const step = totpStep(now)
    const result = verifyTotp(SEED, totpCode(SEED, now + 30_000), now, { lastUsedStep: step })
    expect(result).toEqual({ ok: true, step: step + 1 })
  })

  it('rejects malformed input without consulting the secret', () => {
    expect(verifyTotp(SEED, '12345', now).reason).toBe('malformed')
    expect(verifyTotp(SEED, 'abcdef', now).reason).toBe('malformed')
    expect(verifyTotp(SEED, '', now).reason).toBe('malformed')
  })

  it('accepts a code typed with a space in it', () => {
    const code = totpCode(SEED, now)
    expect(verifyTotp(SEED, `${code.slice(0, 3)} ${code.slice(3)}`, now).ok).toBe(true)
  })
})

describe('otpauthUri', () => {
  it('percent-encodes a label that contains a separator', () => {
    const uri = otpauthUri({
      secret: 'MZXW6YTBOI',
      account: 'ada@example.com',
      issuer: 'Acme Storage / North',
    })
    // A raw slash here would enrol the account under the wrong name.
    expect(uri).toContain('otpauth://totp/Acme%20Storage%20%2F%20North:ada%40example.com?')
    expect(uri).toContain('secret=MZXW6YTBOI')
    expect(uri).toContain('digits=6')
    expect(uri).toContain('period=30')
  })
})

describe('recovery codes', () => {
  it('formats ten bytes as xxxxx-xxxxx', () => {
    const code = recoveryCodeFromBytes(Uint8Array.from({ length: 10 }, (_, i) => i))
    expect(code).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/)
  })

  it('never emits a 0 or a 1', () => {
    // Every byte value, so this is exhaustive rather than a spot check.
    for (let byte = 0; byte < 256; byte += 1) {
      const code = recoveryCodeFromBytes(new Uint8Array(10).fill(byte))
      expect(code).not.toMatch(/[01]/)
    }
  })

  it('folds the digits nobody can read back onto their letters', () => {
    expect(normalizeRecoveryCode('ABC0E-F1HIJ')).toBe('abcoefihij')
  })

  it('is told apart from a TOTP code by length', () => {
    expect(looksLikeRecoveryCode('abcde-fghij')).toBe(true)
    expect(looksLikeRecoveryCode('123456')).toBe(false)
  })

  it('refuses to build a code from too little entropy', () => {
    expect(() => recoveryCodeFromBytes(new Uint8Array(4))).toThrow(/needs 10 bytes/)
  })
})

describe('formatSecretForDisplay', () => {
  it('groups in fours for someone typing it by hand', () => {
    expect(formatSecretForDisplay('MZXW6YTBOIABCDEF')).toBe('MZXW 6YTB OIAB CDEF')
  })
})
