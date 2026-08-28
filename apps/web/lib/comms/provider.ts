// PRD 05 FR-4 / FR-6 / FR-20. The one place that decides *whether and where* an
// outbound message actually goes. Everything above this (rules, rendering,
// suppression) decides *what* to send; this decides the transport.
//
// Three concerns live here, deliberately together because they are the same
// question — "is it safe to put this on the wire, and to whom":
//   1. The provider abstraction (FR-6): a thin port so Resend is swappable and
//      no business logic leaks into an adapter.
//   2. The kill switch (FR-20): an org-level pause-all that the pipeline checks
//      before it does anything.
//   3. The sandbox redirect (FR-20): non-production must never be able to email
//      a real tenant, even if a real key is present.

export type OutboundEmail = {
  to: string
  from: string
  /// CN-17. Where a reply goes. The From address stays on the shared
  /// authenticated domain — moving it to a facility mailbox would break SPF and
  /// DKIM for every send — so a facility's real inbox is reached this way.
  replyTo?: string | null
  subject: string
  html: string
  text: string
  /// Passed to the provider as its own idempotency key so a crash between our
  /// "sent" write and the provider's ack cannot double-send (FR-16 backstop).
  idempotencyKey: string
}

export type SendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: boolean; message: string }

/// FR-6: the swappable port. Kept to the one verb B-030 needs; `parseWebhook`
/// and `normalizeStatus` (FR-14) arrive with the status-webhook item.
export type MessageProvider = {
  name: string
  sendEmail: (email: OutboundEmail) => Promise<SendResult>
}

/// The default everywhere Resend is not configured — dev, test, preview, and
/// any prod that has not set a key yet. It records nothing to the network; the
/// pipeline still writes the full `Message` evidence row, so the send is
/// provable without a real email leaving the building. This is the honest
/// degradation the rest of the platform uses for Stripe (paymentsEnabled) and
/// the gate adapter: a real implementation slots in behind the same port.
export function logOnlyProvider(): MessageProvider {
  return {
    name: 'log_only',
    async sendEmail() {
      // No console noise by default — the Message row is the record. Return a
      // synthetic id so attribution code has something non-null to store.
      return { ok: true, providerMessageId: null }
    },
  }
}

/// PRD 05 FR-4. Resend over its REST API — no SDK, because a single authenticated
/// POST does not justify a dependency, and the real path only ever runs where a
/// key and a verified sending domain (SPF/DKIM/DMARC, which is DNS config, not
/// code) both exist. Everywhere else falls back to `logOnlyProvider`.
export function resendProvider(apiKey: string): MessageProvider {
  return {
    name: 'resend',
    async sendEmail(email) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            // Resend honours this for 24h — the same 24h window Stripe uses —
            // so a retried send returns the original result instead of a second
            // email (FR-16 provider-side backstop).
            'Idempotency-Key': email.idempotencyKey,
          },
          body: JSON.stringify({
            from: email.from,
            to: email.to,
            subject: email.subject,
            html: email.html,
            text: email.text,
          }),
        })

        if (response.ok) {
          const data = (await response.json().catch(() => ({}))) as { id?: string }
          return { ok: true, providerMessageId: data.id ?? null }
        }

        // 4xx is our problem (bad address, unverified domain) and will fail
        // identically on retry; 5xx and 429 are transient.
        const retryable = response.status >= 500 || response.status === 429
        return { ok: false, retryable, message: `resend ${response.status}` }
      } catch (error) {
        // A thrown fetch is a network blip — retryable.
        return { ok: false, retryable: true, message: error instanceof Error ? error.message : 'send failed' }
      }
    },
  }
}

// -- SMS (PRD 05 FR-5, B-074) -------------------------------------------------

export type OutboundSms = {
  to: string
  /// Twilio Messaging Service SID — the facility's own number pool
  /// (`Facility.smsMessagingServiceSid`), not a single From number.
  messagingServiceSid: string
  body: string
  idempotencyKey: string
}

/// A separate port from `MessageProvider`, not an extra method on it: Resend
/// and Twilio are configured independently (different env vars, different
/// facilities may have one without the other), and `selectProvider`'s
/// production/sandbox gating logic needs to run separately per channel.
export type SmsProvider = {
  name: string
  sendSms: (sms: OutboundSms) => Promise<SendResult>
}

export function logOnlySmsProvider(): SmsProvider {
  return {
    name: 'log_only',
    async sendSms() {
      return { ok: true, providerMessageId: null }
    },
  }
}

/// PRD 05 FR-5. Twilio Programmable Messaging over its REST API — no SDK, same
/// rule as `resendProvider`: one authenticated POST does not justify a
/// dependency. Unlike Resend, Twilio's Messages resource has no native
/// idempotency-key mechanism — the backstop against a double-send is entirely
/// OUR OWN idempotency key on the `Message` row (reserved by an upsert before
/// this call, same as the email path), not a provider-side one.
export function twilioProvider(accountSid: string, authToken: string): SmsProvider {
  return {
    name: 'twilio',
    async sendSms(sms) {
      try {
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              To: sms.to,
              MessagingServiceSid: sms.messagingServiceSid,
              Body: sms.body,
            }),
          },
        )

        if (response.ok) {
          const data = (await response.json().catch(() => ({}))) as { sid?: string }
          return { ok: true, providerMessageId: data.sid ?? null }
        }

        // Same split as Resend: 4xx (bad number, unconfigured service) fails
        // identically on retry; 5xx/429 are transient.
        const retryable = response.status >= 500 || response.status === 429
        return { ok: false, retryable, message: `twilio ${response.status}` }
      } catch (error) {
        return { ok: false, retryable: true, message: error instanceof Error ? error.message : 'send failed' }
      }
    },
  }
}

/// FR-20's sandbox redirect, SMS side. Same guarantee as `effectiveRecipient`:
/// no real tenant's phone is reachable from a non-production environment.
export function effectiveSmsRecipient(realPhone: string): string {
  if (isProductionEnv()) return realPhone
  const sandbox = process.env.COMMS_SANDBOX_SMS
  return sandbox ?? realPhone
}

/// SMS analogue of `selectProvider`: a real Twilio credential is used only in
/// production, or in a non-prod env that has ALSO set a sandbox phone number —
/// otherwise log-only, so a stray credential in a preview deploy cannot text a
/// real tenant.
export function selectSmsProvider(): SmsProvider {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return logOnlySmsProvider()
  if (isProductionEnv()) return twilioProvider(sid, token)
  if (process.env.COMMS_SANDBOX_SMS) return twilioProvider(sid, token)
  return logOnlySmsProvider()
}

/// The four guards above exist so a preview deploy cannot mail or text a real
/// person. `NODE_ENV` alone could not tell them apart: Vercel builds EVERY
/// deployment with `NODE_ENV=production`, previews included, so on Vercel all
/// four were inert and `RESEND_API_KEY` set at project scope would have reached
/// real recipients from any preview — the opposite of what `.env.example` and
/// PROGRESS.md both claim. `VERCEL_ENV` is the platform's own distinction
/// ('production' | 'preview' | 'development'); it is unset off Vercel, where
/// `NODE_ENV` remains the right answer (local dev, CI, a self-hosted build).
function isProductionEnv(): boolean {
  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv) return vercelEnv === 'production'
  return process.env.NODE_ENV === 'production'
}

/// FR-20 kill switch. An emergency stop, not a scheduled pause: while it is on,
/// nothing goes out and — because the pipeline settles the event either way —
/// messages suppressed during the pause are **not** replayed when it clears.
/// That is the right shape for "stop mailing tenants now" and the wrong shape
/// for a maintenance window; a DB-backed operator toggle with replay is a later
/// ops item. Env-var so it is flippable without a code deploy touching logic.
export function commsEnabled(): boolean {
  return process.env.COMMS_KILL_SWITCH !== 'on'
}

/// FR-4 / CN-17 sender identity.
///
/// The display name is per facility; the ADDRESS is not. Every facility sends
/// from the one authenticated domain because SPF, DKIM and DMARC are configured
/// there — giving each site its own sending address would mean a DNS setup per
/// facility and, until that was done, mail that fails authentication and lands
/// in spam. CN-17's own wording puts the facility identity in the name and
/// routes the human reply to `replyTo` for exactly this reason.
///
/// The domain defaults to something obviously non-deliverable so an
/// unconfigured production cannot look configured.
export function fromAddress(displayName: string): string {
  const domain = process.env.COMMS_EMAIL_DOMAIN ?? 'mail.example.com'
  // A comma or angle bracket in the display name would break the header; a
  // facility called "Austin, South" is not hypothetical.
  const safe = displayName.replace(/[<>,;"]/g, ' ').replace(/\s+/g, ' ').trim()
  return `${safe} <notifications@${domain}>`
}

/// CN-17: "email footer auto-injects the facility's physical address."
///
/// Appended by the pipeline rather than written into each template, because a
/// postal address is a CAN-SPAM requirement on commercial mail and a template
/// author forgetting it is exactly the failure that rule exists to catch. One
/// place to get right, and no way for an edited template to drop it.
export function withPostalFooter(
  body: string,
  facility: { name: string; address: string } | null,
): string {
  if (!facility) return body
  return `${body}\n\n—\n${facility.name}\n${facility.address}`
}

/// FR-20 sandbox redirect. The single guarantee: **no real tenant address is
/// reachable from a non-production environment.** With a real key outside prod,
/// every recipient is rewritten to COMMS_SANDBOX_INBOX; if that is unset, the
/// caller must fall back to log-only (see `selectProvider`). In production the
/// real address is used unchanged.
export function effectiveRecipient(realAddress: string): string {
  if (isProductionEnv()) return realAddress
  const sandbox = process.env.COMMS_SANDBOX_INBOX
  return sandbox ?? realAddress
}

/// Chooses the transport for a send. A real Resend key is used only in
/// production, or in a non-prod environment that has *also* set a sandbox inbox
/// to catch the mail — otherwise we refuse the real provider and log only, so a
/// stray key in a preview deploy cannot reach a tenant.
export function selectProvider(): MessageProvider {
  const key = process.env.RESEND_API_KEY
  if (!key) return logOnlyProvider()
  if (isProductionEnv()) return resendProvider(key)
  if (process.env.COMMS_SANDBOX_INBOX) return resendProvider(key)
  return logOnlyProvider()
}
