import { describe, expect, it } from 'vitest'
import { signTwilioRequest, verifyTwilioSignature } from '../apps/web/lib/comms/twilio-signature'

// B-074 / PRD 05 FR-14. The security boundary of /api/comms/sms-webhook.
//
// Public and unauthenticated. Without this check, anyone who found the URL
// could post a fake inbound STOP and suppress a real tenant's phone number,
// or a fake START to re-enable a number the real owner opted out.

const AUTH_TOKEN = 'test-auth-token'
const URL = 'https://example.com/api/comms/sms-webhook'
const PARAMS = { From: '+15125550100', Body: 'STOP', To: '+15125559999', MessageSid: 'SM123' }

describe('twilio webhook signature', () => {
  it('accepts a signature it just produced', () => {
    const header = signTwilioRequest(AUTH_TOKEN, URL, PARAMS)
    expect(verifyTwilioSignature({ authToken: AUTH_TOKEN, url: URL, params: PARAMS, header })).toBe(true)
  })

  it('rejects a param tampered with after signing', () => {
    const header = signTwilioRequest(AUTH_TOKEN, URL, PARAMS)
    const tampered = { ...PARAMS, Body: 'START' }
    expect(verifyTwilioSignature({ authToken: AUTH_TOKEN, url: URL, params: tampered, header })).toBe(false)
  })

  it('rejects a signature made with another auth token', () => {
    const header = signTwilioRequest('someone-elses-token', URL, PARAMS)
    expect(verifyTwilioSignature({ authToken: AUTH_TOKEN, url: URL, params: PARAMS, header })).toBe(false)
  })

  it('rejects a signature computed for a different URL', () => {
    const header = signTwilioRequest(AUTH_TOKEN, URL, PARAMS)
    expect(
      verifyTwilioSignature({ authToken: AUTH_TOKEN, url: `${URL}/other`, params: PARAMS, header }),
    ).toBe(false)
  })

  it('rejects a header that is not valid base64', () => {
    expect(
      verifyTwilioSignature({ authToken: AUTH_TOKEN, url: URL, params: PARAMS, header: '!!!not-base64!!!' }),
    ).toBe(false)
  })

  it('is order-independent — param order does not change the signature', () => {
    const header = signTwilioRequest(AUTH_TOKEN, URL, PARAMS)
    const reordered = { Body: 'STOP', MessageSid: 'SM123', To: '+15125559999', From: '+15125550100' }
    expect(verifyTwilioSignature({ authToken: AUTH_TOKEN, url: URL, params: reordered, header })).toBe(true)
  })
})
