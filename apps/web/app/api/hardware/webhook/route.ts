import { applyHardwareWebhookEvent, type HardwareWebhookPayload } from '@/lib/access/webhook-handler'
import { acceptableSecrets } from '@/lib/access/webhook-secrets'
import {
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
//
// B-080 made the secret per-facility with a rotation window (SR-4). The route
// now tries every currently-acceptable secret for the site rather than one
// global value, which is what lets a rotation happen without dropping the
// events in flight while somebody updates a vendor portal.

/// Reads the site id out of the body so the right secrets can be looked up.
///
/// Parsing before verifying looks like trusting unverified input, and is not:
/// nothing from here reaches the handler, and the only thing this decides is
/// WHICH keys the signature is checked against. An attacker who names another
/// facility gets their forgery checked against that facility's secrets, which
/// it also does not match. Returns null on anything unparseable, and a null
/// site simply has no secrets and is rejected.
function siteIdFrom(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { facilityId?: unknown }
    return typeof parsed.facilityId === 'string' ? parsed.facilityId : null
  } catch {
    return null
  }
}

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get('x-hardware-signature')
  if (!signature) return Response.json({ error: 'missing_signature' }, { status: 400 })

  const body = await request.text()
  const facilityId = siteIdFrom(body)
  if (!facilityId) return Response.json({ error: 'unrecognized_payload' }, { status: 400 })

  const secrets = await acceptableSecrets(facilityId)
  if (secrets.length === 0) {
    return Response.json({ error: 'hardware_webhooks_not_configured' }, { status: 503 })
  }

  // Tried newest-first. During a rotation window both the new and the outgoing
  // secret verify; outside one there is exactly a single candidate and this is
  // the same check it always was.
  let lastError: unknown = null
  const verified = secrets.some((secret) => {
    try {
      verifyHardwareSignature(body, signature, secret)
      return true
    } catch (error) {
      lastError = error
      return false
    }
  })

  if (!verified) {
    const message =
      lastError instanceof InvalidHardwareSignatureError ? lastError.message : 'invalid signature'
    return Response.json({ error: 'invalid_signature', message }, { status: 400 })
  }

  const payload = JSON.parse(body) as HardwareWebhookPayload
  await applyHardwareWebhookEvent(payload)

  return Response.json({ received: true })
}
