import { randomUUID } from 'node:crypto'
import type { AuthTokenPurpose } from '@storage/db'
import { SITE } from '@/lib/site-config'
import { sendDirectEmail } from '@/lib/comms/service'
import { proseFor } from '@/lib/comms/prose'
import type { Locale } from '@/lib/i18n'

// Delivery seam, now wired to B-030's provider (this comment used to point
// forward to that item by name; B-030 has shipped, so this closes the loop
// rather than leaving a stale reference for the next person to trip over).
//
// A direct send, not the rule/template pipeline: a sign-in link is security-
// sensitive and time-critical in a way that has nothing to do with per-
// facility content overrides, and — like a reservation or checkout token —
// the raw URL exists only in this call, never persisted, so there is nothing
// for a later-run consumer to re-derive it from anyway.

/// The purposes this generic "here is a link" email actually fits.
///
/// Narrower than `AuthTokenPurpose` on purpose: `email_change` is also a
/// token-bearing auth flow, but it sends two different messages to two
/// different addresses (lib/auth/email-change.ts) and neither is this shape.
/// Typing it out rather than accepting the whole enum means adding a purpose
/// that does not belong here is a compile error instead of a wrong email.
type LinkEmailPurpose = Extract<AuthTokenPurpose, 'magic_link' | 'password_reset'>

type SendArgs = {
  to: string
  purpose: LinkEmailPurpose
  url: string
  expiresAt: Date
  /// B-265 (D-130). Resolved by the caller, which is the only thing that knows
  /// whose account this is: `requestPasswordReset` serves STAFF as well as
  /// tenants, and D-122 keeps the staff side English regardless of what the
  /// browser asking for the link happens to be set to.
  locale: Locale
}

export async function sendAuthEmail({ to, purpose, url, expiresAt, locale }: SendArgs): Promise<void> {
  const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60_000)
  const say = proseFor(locale).direct
  const text = `${say.authIntro[purpose]}\n\n${url}\n\n${say.authExpiry(minutes)}`

  // Auth tokens are minted once per request (no stable id to key an
  // idempotency column on), so a random key is correct here — unlike a
  // reservation or checkout send, "the same request twice" is not a case this
  // needs to dedupe; a second request just mints and sends a second, newer
  // link, which is exactly what `requestMagicLink`/`requestPasswordReset`
  // already invalidate the previous one for.
  const sent = await sendDirectEmail({
    idempotencyKey: `auth:${purpose}:${randomUUID()}`,
    eventId: `auth:${purpose}`,
    templateKey: `auth_${purpose}`,
    classification: 'transactional',
    locale,
    to,
    fromName: SITE.name,
    subject: say.authSubject[purpose](SITE.name),
    html: `<p>${text.replace(/\n/g, '<br>')}</p>`,
    text,
  })

  if (!sent.sent && process.env.NODE_ENV === 'production') {
    // Failing loudly beats silently dropping a sign-in link in production —
    // sendDirectEmail already logged why (suppressed, or a provider error) in
    // the Message row; this is what tells the caller the send did not happen.
    throw new Error(`Could not send ${purpose} email to ${to}`)
  }

  if (!process.env.RESEND_API_KEY) {
    console.info(`\n[auth] ${purpose} link for ${to} (expires in ${minutes} min):\n  ${url}\n`)
  }
}
