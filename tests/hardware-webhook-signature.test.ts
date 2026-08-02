import { describe, expect, it } from 'vitest'
import {
  InvalidHardwareSignatureError,
  signHardwarePayload,
  verifyHardwareSignature,
} from '../apps/web/lib/access/webhook-signature'

// B-028 / PRD 03 FR-8: "Simulator exposes the same webhook signature scheme
// as the design's real-vendor contract so security code paths are exercised."
// No network and no live route — pure crypto, the same posture B-019 used for
// the Stripe signature tests.

const SECRET = 'whsec_test_hardware_secret'
const BODY = JSON.stringify({ facilityId: 'f1', vendorEventId: 'evt_1', result: 'granted' })

describe('hardware webhook signature', () => {
  it('verifies a signature it just produced', () => {
    const header = signHardwarePayload(BODY, SECRET)
    expect(() => verifyHardwareSignature(BODY, header, SECRET)).not.toThrow()
  })

  it('rejects a body that was tampered with after signing', () => {
    // The endpoint is written as if a real vendor could reach it — without
    // this check anyone who found the URL could post "access granted".
    const header = signHardwarePayload(BODY, SECRET)
    const tampered = JSON.stringify({ facilityId: 'f1', vendorEventId: 'evt_1', result: 'denied' })
    expect(() => verifyHardwareSignature(tampered, header, SECRET)).toThrow(
      InvalidHardwareSignatureError,
    )
  })

  it('rejects a signature made with a different secret', () => {
    const header = signHardwarePayload(BODY, 'whsec_someone_elses_secret')
    expect(() => verifyHardwareSignature(BODY, header, SECRET)).toThrow(
      InvalidHardwareSignatureError,
    )
  })

  it('rejects a malformed header', () => {
    expect(() => verifyHardwareSignature(BODY, 'not-a-real-header', SECRET)).toThrow(
      InvalidHardwareSignatureError,
    )
    expect(() => verifyHardwareSignature(BODY, '', SECRET)).toThrow(InvalidHardwareSignatureError)
  })

  it('rejects a replayed capture of a genuine old delivery', () => {
    // Signed correctly, but hours ago — the timestamp tolerance is what stops
    // someone re-posting a captured success later.
    const hoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
    const header = signHardwarePayload(BODY, SECRET, hoursAgo)
    expect(() => verifyHardwareSignature(BODY, header, SECRET)).toThrow(
      InvalidHardwareSignatureError,
    )
  })

  it('accepts a signature within the tolerance window', () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)
    const header = signHardwarePayload(BODY, SECRET, twoMinutesAgo)
    expect(() => verifyHardwareSignature(BODY, header, SECRET)).not.toThrow()
  })
})
