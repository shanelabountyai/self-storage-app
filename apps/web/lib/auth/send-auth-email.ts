import { randomUUID } from 'node:crypto'
import type { AuthTokenPurpose } from '@storage/db'
import { SITE } from '@/lib/site-config'
import { sendDirectEmail } from '@/lib/comms/service'

// Delivery seam, now wired to B-030's provider (this comment used to point
// forward to that item by name; B-030 has shipped, so this closes the loop
// rather than leaving a stale reference for the next person to trip over).
//
// A direct send, not the rule/template pipeline: a sign-in link is security-
// sensitive and time-critical in a way that has nothing to do with per-
// facility content overrides, and — like a reservation or checkout token —
// the raw URL exists only in this call, never persisted, so there is nothing
// for a later-run consumer to re-derive it from anyway.

type SendArgs = {
  to: string
  purpose: AuthTokenPurpose
  url: string
  expiresAt: Date
}

const SUBJECT: Record<AuthTokenPurpose, string> = {
  magic_link: `Sign in to ${SITE.name}`,
  password_reset: `Reset your ${SITE.name} password`,
}

const INTRO: Record<AuthTokenPurpose, string> = {
  magic_link: 'Use this link to sign in:',
  password_reset: 'Use this link to choose a new password:',
}

export async function sendAuthEmail({ to, purpose, url, expiresAt }: SendArgs): Promise<void> {
  const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60_000)
  const text = `${INTRO[purpose]}\n\n${url}\n\nThis link expires in ${minutes} minutes. If you did not request this, you can ignore this email.`

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
    to,
    fromName: SITE.name,
    subject: SUBJECT[purpose],
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
