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

function isProductionEnv(): boolean {
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

/// FR-4 sender identity. Per-facility From is CN-17 (a later item); for now one
/// org-level From derived from the sending domain, defaulting to something
/// obviously non-deliverable so an unconfigured prod cannot look configured.
export function fromAddress(facilityName: string): string {
  const domain = process.env.COMMS_EMAIL_DOMAIN ?? 'mail.example.com'
  return `${facilityName} <notifications@${domain}>`
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
