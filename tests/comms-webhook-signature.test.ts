import { describe, expect, it } from 'vitest'
import {
  SIGNATURE_TOLERANCE_SECONDS,
  signResendPayload,
  timestampIsFresh,
  verifyResendSignature,
} from '../apps/web/lib/comms/webhook-signature'

// B-054 / PRD 05 FR-14. The security boundary of /api/comms/webhook.
//
// This endpoint is public and unauthenticated. Without the check below, anyone
// who found the URL could post `email.bounced` for a tenant and have the system
// suppress their address — which stops every notice, including the ones a lien
// depends on having been served.

const SECRET = 'whsec_dGVzdC1yZXNlbmQtc2VjcmV0'
const ID = 'msg_2abc'
const TIMESTAMP = '1754500000'
const BODY = JSON.stringify({ type: 'email.bounced', data: { email_id: 'em_1' } })

function header(overrides: Partial<Parameters<typeof signResendPayload>[0]> = {}) {
  return signResendPayload({ secret: SECRET, id: ID, timestamp: TIMESTAMP, body: BODY, ...overrides })
}

describe('resend webhook signature', () => {
  it('accepts a signature it just produced', () => {
    expect(
      verifyResendSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        body: BODY,
        header: header(),
      }),
    ).toBe(true)
  })

  it('rejects a body tampered with after signing', () => {
    const tampered = JSON.stringify({ type: 'email.bounced', data: { email_id: 'em_SOMEONE_ELSE' } })
    expect(
      verifyResendSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        body: tampered,
        header: header(),
      }),
    ).toBe(false)
  })

  it('rejects a signature made with another secret', () => {
    expect(
      verifyResendSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        body: BODY,
        header: header({ secret: 'whsec_c29tZW9uZS1lbHNl' }),
      }),
    ).toBe(false)
  })

  it('rejects a signature for a different message id or timestamp', () => {
    // Both are inside the signed payload, so replaying one delivery's signature
    // against another's headers must not pass.
    for (const overrides of [{ id: 'msg_other' }, { timestamp: '1754509999' }]) {
      expect(
        verifyResendSignature({
          secret: SECRET,
          id: ID,
          timestamp: TIMESTAMP,
          body: BODY,
          header: header(overrides),
        }),
      ).toBe(false)
    }
  })

  it('accepts one valid signature among several — secret rotation', () => {
    const rotated = `v1,AAAA ${header()}`
    expect(
      verifyResendSignature({
        secret: SECRET,
        id: ID,
        timestamp: TIMESTAMP,
        body: BODY,
        header: rotated,
      }),
    ).toBe(true)
  })

  it('rejects a malformed header without throwing', () => {
    for (const bad of ['', 'not-a-real-header', 'v1,', 'v2,abc']) {
      expect(
        verifyResendSignature({
          secret: SECRET,
          id: ID,
          timestamp: TIMESTAMP,
          body: BODY,
          header: bad,
        }),
      ).toBe(false)
    }
  })
})

describe('replay window', () => {
  const now = Number(TIMESTAMP) * 1000

  it('accepts a fresh delivery', () => {
    expect(timestampIsFresh(TIMESTAMP, now)).toBe(true)
    expect(timestampIsFresh(TIMESTAMP, now + (SIGNATURE_TOLERANCE_SECONDS - 1) * 1000)).toBe(true)
  })

  it('rejects a captured delivery replayed later', () => {
    expect(timestampIsFresh(TIMESTAMP, now + (SIGNATURE_TOLERANCE_SECONDS + 1) * 1000)).toBe(false)
  })

  it('rejects a timestamp that is not a number', () => {
    expect(timestampIsFresh('yesterday', now)).toBe(false)
    expect(timestampIsFresh('', now)).toBe(false)
  })
})
