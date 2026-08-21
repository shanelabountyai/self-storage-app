import { classifySmsKeyword, SMS_CONFIRM_KEYWORD, SMS_OPT_IN_KEYWORD } from '@storage/core/comms'
import { verifyTwilioSignature } from '@/lib/comms/twilio-signature'
import { routeInboundSms } from '@/lib/comms/sms-inbound'
import { SITE } from '@/lib/site-config'
import {
  applySmsStart,
  applySmsStop,
  beginSmsOptIn,
  confirmSmsOptIn,
  facilityContactForPhone,
} from '@/lib/comms/sms-consent'

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

  if (keyword === 'opt_in') {
    const result = await beginSmsOptIn({ rawPhone: from })
    if (!result.ok) {
      return twiml(
        `${SITE.name}: we do not recognise this number, so we have not subscribed it. Call ${SITE.smsNumber.display} and we will add it to your account.`,
      )
    }
    // The "request for final confirmation" a campaign review looks for. It
    // names the brand and the service, and it does not subscribe anybody on
    // its own.
    return twiml(
      `${SITE.name}: reply ${SMS_CONFIRM_KEYWORD} to confirm you want account and payment alerts by text. Msg frequency varies (about 1-4/mo). Msg & data rates may apply. Reply HELP for help, STOP to cancel.`,
    )
  }

  if (keyword === 'confirm') {
    const result = await confirmSmsOptIn({ rawPhone: from })
    if (!result.ok) {
      // A bare YES with nothing pending subscribes nobody, and says so rather
      // than confirming something that never happened.
      return twiml(
        `${SITE.name}: there is nothing to confirm. Text ${SMS_OPT_IN_KEYWORD} to sign up for account and payment alerts.`,
      )
    }
    return twiml(
      `${SITE.name}: you are subscribed to account and payment alerts. Msg frequency varies (about 1-4/mo). Msg & data rates may apply. Reply HELP for help, STOP to cancel.`,
    )
  }

  if (keyword === 'start') {
    const result = await applySmsStart({ rawPhone: from })

    // A number we cannot place gets told so, rather than a confirmation for a
    // subscription that was never created. Confirming one would be the worst
    // possible reply: it is the message a carrier audit reads as proof of
    // consent, and there would be no consent behind it.
    if (!result.optedIn) {
      return twiml(
        `${SITE.name}: we do not recognise this number, so we have not subscribed it. Call ${SITE.smsNumber.display} and we will add it to your account.`,
      )
    }

    // The opt-in confirmation carriers expect, and the one an A2P 10DLC review
    // checks for: who is texting, what they will get, how often, that rates may
    // apply, and both keywords. All five in one message.
    return twiml(
      `${SITE.name}: you are subscribed to account and payment alerts. Msg frequency varies (about 1-4/mo). Msg & data rates may apply. Reply HELP for help, STOP to cancel.`,
    )
  }

  if (keyword === 'help') {
    const contact = await facilityContactForPhone(from)
    const identification = contact
      ? `This is ${contact.facilityName}.${contact.facilityPhone ? ` Call ${contact.facilityPhone} for help.` : ''}`
      : 'This is your self-storage facility.'
    return twiml(`${identification} Reply STOP to opt out.`)
  }

  // Not a recognised keyword — an ordinary message, which until B-135 was
  // answered with `<Response/>`: no reply, no record, nobody told. D-78
  // declined the two-way inbox; this routes to the queue staff already work
  // (US-41) and tells the sender a person has it.
  const routed = await routeInboundSms({ rawPhone: from, body })

  if (routed.ok) {
    // Their OWN site's number, not the shared SMS line: the person who can
    // actually open a gate or look at a unit is at that counter. Falls back to
    // the SMS line only when the facility has no phone on file.
    const callNumber = routed.facilityPhone ?? SITE.smsNumber.display
    return twiml(
      `${SITE.name}: thanks — we have passed this to the team at ${routed.facilityName} and someone will get back to you. For anything urgent call ${callNumber}.`,
    )
  }

  // An empty body is a carrier artefact, not a person. Saying "we have passed
  // it on" would be a lie about a message with no content.
  if (routed.reason === 'empty') return twiml(null)

  // A number we cannot place. The message is recorded either way (the event is
  // written before this branch), but there is no honest facility to raise a
  // task at — this SMS number is site-wide, so `To` cannot supply one. Give
  // them a number to call rather than a receipt nobody can act on.
  return twiml(
    `${SITE.name}: we cannot match this number to an account, so we may not be able to reply. Please call ${SITE.smsNumber.display}.`,
  )
}
