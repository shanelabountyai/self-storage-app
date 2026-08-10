import { classifySmsKeyword } from '@storage/core/comms'
import { verifyTwilioSignature } from '@/lib/comms/twilio-signature'
import { applySmsStart, applySmsStop, facilityContactForPhone } from '@/lib/comms/sms-consent'

// PRD 05 CN-14 (B-074). Twilio's inbound-message webhook — STOP/HELP/START,
// application-level. CN-14 AC: "provider-level (Twilio Advanced Opt-Out) AND
// application-level (our suppression check), so a race can't slip a message
// through." Advanced Opt-Out is a Twilio-console setting on the Messaging
// Service (no code — see the settings screen's own note); this route is the
// second, independent layer, and it works whether or not that console
// setting is on: our own `Suppression` row is what `deliverSmsForRule`
// actually checks before every send.
//
// No auth beyond the Twilio signature — same posture as `/unsubscribe/[token]`
// and the Resend webhook: this route grants exactly the actions CN-14 lists,
// nothing else in the application knows it exists.
export const dynamic = 'force-dynamic'

function twiml(message: string | null): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response/>`
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function POST(request: Request): Promise<Response> {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    // Fail closed, like every other webhook in this codebase: without the
    // token we cannot tell a real Twilio delivery from anyone else's POST,
    // and a forged STOP would silently cut a tenant off from every SMS —
    // no worse than acting on one we cannot verify.
    return Response.json({ error: 'webhooks_not_configured' }, { status: 503 })
  }

  const header = request.headers.get('X-Twilio-Signature')
  if (!header) return Response.json({ error: 'missing_signature' }, { status: 400 })

  // Twilio signs the exact URL it was configured to call plus every sorted
  // form param — `request.formData()` gives back the same field set the
  // signature was computed over, so no raw-body handling is needed here the
  // way the Svix webhook needs `.text()`. The caveat that matters is
  // `request.url` must match the Twilio console's configured URL
  // byte-for-byte (scheme, host, path) — a proxy that rewrites any of those
  // breaks verification by Twilio's own design, not a bug here.
  const formData = await request.formData()
  const params: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') params[key] = value
  }

  if (!verifyTwilioSignature({ authToken, url: request.url, params, header })) {
    return Response.json({ error: 'invalid_signature' }, { status: 400 })
  }

  const from = params.From
  const body = params.Body ?? ''
  if (!from) return twiml(null)

  const keyword = classifySmsKeyword(body)

  if (keyword === 'stop') {
    await applySmsStop({ rawPhone: from, source: 'sms_stop_keyword' })
    // CN-14 AC: "sends the single confirmation message carriers require."
    return twiml('You have been unsubscribed and will not receive any more messages from us. Reply START to resubscribe.')
  }

  if (keyword === 'start') {
    await applySmsStart({ rawPhone: from })
    return twiml('You are re-subscribed to messages from us. Reply STOP to opt out again at any time.')
  }

  if (keyword === 'help') {
    const contact = await facilityContactForPhone(from)
    const identification = contact
      ? `This is ${contact.facilityName}.${contact.facilityPhone ? ` Call ${contact.facilityPhone} for help.` : ''}`
      : 'This is your self-storage facility.'
    return twiml(`${identification} Reply STOP to opt out.`)
  }

  // Not a recognised keyword: acknowledged with no reply. Nothing in this
  // item's scope reads or routes an ordinary inbound text (a tenant replying
  // to a reminder with a question) — that is a real gap, left for the
  // delivery-dashboard item that already owns "what happens to an inbound
  // message we cannot act on automatically" (PROGRESS.md).
  return twiml(null)
}
