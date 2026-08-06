import { applyDeliveryEvent } from '@/lib/comms/delivery'
import { timestampIsFresh, verifyResendSignature } from '@/lib/comms/webhook-signature'

// PRD 05 FR-14 (B-054). Resend's delivery webhook.
//
// Same three rules as the Stripe endpoint (apps/web/app/api/stripe/webhook),
// for the same reasons: verify before parsing, be idempotent, and acknowledge
// what we do not handle. This one carries less money and more consequence — a
// forged `email.bounced` would suppress a real tenant's address and cut them
// off from every notice this system sends.

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed, like the Stripe route: without the secret we cannot tell a
    // real delivery from anyone else's POST, and acting on it anyway would be
    // worse than being down.
    return Response.json({ error: 'webhooks_not_configured' }, { status: 503 })
  }

  const id = request.headers.get('svix-id')
  const timestamp = request.headers.get('svix-timestamp')
  const header = request.headers.get('svix-signature')
  if (!id || !timestamp || !header) {
    return Response.json({ error: 'missing_signature' }, { status: 400 })
  }
  if (!timestampIsFresh(timestamp)) {
    return Response.json({ error: 'stale_timestamp' }, { status: 400 })
  }

  // text(), not json(): reserialising would change the bytes that were signed.
  const body = await request.text()
  if (!verifyResendSignature({ secret, id, timestamp, body, header })) {
    return Response.json({ error: 'invalid_signature' }, { status: 400 })
  }

  let payload: { type?: string; data?: { email_id?: string } }
  try {
    payload = JSON.parse(body)
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  const providerMessageId = payload.data?.email_id
  if (!payload.type || !providerMessageId) {
    // Acknowledged: a shape we do not recognise is not something a retry will
    // fix, and a non-2xx would have Resend resending it for days.
    return Response.json({ received: true, ignored: 'unrecognised_payload' })
  }

  const outcome = await applyDeliveryEvent({ type: payload.type, providerMessageId })
  return Response.json({ received: true, ...outcome })
}
