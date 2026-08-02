import { applyHardwareWebhookEvent, type HardwareWebhookPayload } from '@/lib/access/webhook-handler'
import {
  hardwareWebhookSecret,
  InvalidHardwareSignatureError,
  verifyHardwareSignature,
} from '@/lib/access/webhook-signature'

// PRD 03 FR-8 / FR-4. The endpoint a gate vendor's webhook would call.
//
// Today only the simulator calls it (B-028), but the route is written as if a
// real vendor already could — same posture as B-019's Stripe endpoint: verify
// the raw body first, and treat a signature failure as a 400 rather than
// trusting the payload. It fails closed once a real vendor secret is expected
// (production, or HARDWARE_WEBHOOK_SECRET explicitly set) — see
// hardwareWebhookSecret()'s own note for why dev is allowed a generated one.

export async function POST(request: Request): Promise<Response> {
  const secret = hardwareWebhookSecret()
  if (!secret) {
    return Response.json({ error: 'hardware_webhooks_not_configured' }, { status: 503 })
  }

  const signature = request.headers.get('x-hardware-signature')
  if (!signature) return Response.json({ error: 'missing_signature' }, { status: 400 })

  const body = await request.text()

  try {
    verifyHardwareSignature(body, signature, secret)
  } catch (error) {
    const message = error instanceof InvalidHardwareSignatureError ? error.message : 'invalid signature'
    return Response.json({ error: 'invalid_signature', message }, { status: 400 })
  }

  const payload = JSON.parse(body) as HardwareWebhookPayload
  await applyHardwareWebhookEvent(payload)

  return Response.json({ received: true })
}
