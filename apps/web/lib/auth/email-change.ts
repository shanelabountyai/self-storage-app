import { randomUUID } from 'node:crypto'
import { prisma } from '@storage/db'
import { sendDirectEmail } from '@/lib/comms/service'
import { proseFor } from '@/lib/comms/prose'
import { writingLocale } from '@/lib/i18n/server'
import { escapeHtml } from '@storage/core/comms'
import { SITE } from '@/lib/site-config'
import { consumeToken, mintToken } from './tokens'

// PRD 01 US-706: "email change requires confirmation to both old and new
// addresses."
//
// Two messages, two different jobs. The link goes ONLY to the new address —
// opening it is what proves the person asking can actually receive mail
// there, and a link sent to the old address would prove nothing about the new
// one. The old address gets a notice with no link at all: it is the security
// alert, and its whole value is that someone who did not ask for this finds
// out while the change has not happened yet.
//
// Changing the email changes what signs in (auth.ts resolves accounts by
// email), so this is an account-takeover path if it is done on trust. Nothing
// is written to the tenant until the token comes back.

export type EmailChangeRequest =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'unchanged' | 'taken' }

function appUrl(): string {
  return process.env.AUTH_URL ?? 'http://localhost:3000'
}

/// Starts an email change. Never writes the new address anywhere but the
/// token — see the note above.
export async function requestEmailChange(
  tenantId: string,
  rawNewEmail: string,
): Promise<EmailChangeRequest> {
  const newEmail = rawNewEmail.trim().toLowerCase()
  if (!newEmail || !newEmail.includes('@') || /\s/.test(newEmail)) {
    return { ok: false, reason: 'invalid' }
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { id: true, email: true, firstName: true, preferredLocale: true },
  })
  if (newEmail === tenant.email.toLowerCase()) return { ok: false, reason: 'unchanged' }

  // Told plainly rather than hidden behind a generic success. Email is the
  // account identifier and it is unique — a silent no-op would leave someone
  // waiting for a message that is never coming. This does leak that an
  // address is registered, which is the same fact the sign-up path exposes
  // anyway, and the alternative is a flow that appears to work and does not.
  const taken = await prisma.tenant.findFirst({
    where: { email: newEmail, id: { not: tenantId } },
    select: { id: true },
  })
  if (taken) return { ok: false, reason: 'taken' }

  // mintToken consumes any previous live token for this subject and purpose,
  // so asking twice invalidates the first link rather than leaving two live
  // ways to change the same account's address.
  const { token } = await mintToken({
    purpose: 'email_change',
    audience: 'tenant',
    subjectId: tenant.id,
    email: newEmail,
  })

  // Outside /portal deliberately — see the page's own note: the token is the
  // credential, and requiring a session too would break opening the link on a
  // phone that has none.
  const link = `${appUrl()}/confirm-email?token=${encodeURIComponent(token)}`
  const name = tenant.firstName

  // B-265 (D-130). Both messages go to the same person, so they resolve one
  // language between them — a confirmation in Spanish and a security alert in
  // English about the same request would read as two unrelated events.
  const locale = await writingLocale(tenant.preferredLocale)
  const say = proseFor(locale).direct
  const greeting = say.hi(name)
  // Both HTML parts below escape every interpolated value. They did not: the
  // tenant's own first name went into the markup raw, so a name containing a
  // tag reached the inbox as a tag. Same `escapeHtml` the render path uses.

  await sendDirectEmail({
    idempotencyKey: `email-change-confirm:${tenantId}:${randomUUID()}`,
    eventId: `email-change:${tenantId}`,
    templateKey: 'email_change_confirm',
    classification: 'transactional',
    locale,
    to: newEmail,
    fromName: SITE.name,
    subject: say.emailChangeConfirmSubject,
    html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(say.emailChangeConfirmIntro(SITE.name))}</p><p><a href="${link}">${escapeHtml(say.emailChangeConfirmCta)}</a></p><p>${escapeHtml(say.emailChangeConfirmIgnore)}</p>`,
    text: `${greeting}\n\n${say.emailChangeConfirmText(SITE.name)}\n${link}\n\n${say.emailChangeConfirmIgnore}`,
  })

  // Deliberately linkless. Anyone who can read this mailbox but did not ask
  // for the change needs a way to react, and that way is the phone number —
  // not a one-click control an attacker with mailbox access could also use.
  await sendDirectEmail({
    idempotencyKey: `email-change-notice:${tenantId}:${randomUUID()}`,
    eventId: `email-change:${tenantId}`,
    templateKey: 'email_change_notice',
    classification: 'transactional',
    locale,
    to: tenant.email,
    fromName: SITE.name,
    subject: say.emailChangeNoticeSubject,
    // The new address arrives bold in the HTML and plain in the text, from one
    // sentence — the plaintext part used to carry a SHORTER sentence that
    // dropped "it only takes effect when the link is opened", which is the
    // half that tells somebody reading this alert that they still have time.
    html: `<p>${escapeHtml(greeting)}</p><p>${say.emailChangeNotice(escapeHtml(SITE.name), `<strong>${escapeHtml(newEmail)}</strong>`)}</p><p>${escapeHtml(say.emailChangeNoticeCall(SITE.phone.display))}</p>`,
    text: `${greeting}\n\n${say.emailChangeNotice(SITE.name, newEmail)}\n\n${say.emailChangeNoticeCall(SITE.phone.display)}`,
  })

  return { ok: true }
}

export type EmailChangeResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'invalid_token' | 'taken' }

/// Applies a confirmed email change.
///
/// The address is re-checked for uniqueness here as well as at request time:
/// the link is good for 24 hours and someone else can register it in between,
/// and the unique constraint would otherwise surface as a crash on a link the
/// tenant was told to open.
export async function confirmEmailChange(token: string): Promise<EmailChangeResult> {
  const record = await consumeToken(token, 'email_change')
  if (!record) return { ok: false, reason: 'invalid_token' }

  const newEmail = record.email.toLowerCase()
  const taken = await prisma.tenant.findFirst({
    where: { email: newEmail, id: { not: record.subjectId } },
    select: { id: true },
  })
  if (taken) return { ok: false, reason: 'taken' }

  await prisma.tenant.update({
    where: { id: record.subjectId },
    data: {
      email: newEmail,
      // The new address has just proved it receives mail; the old one's
      // verification said nothing about this one.
      emailVerifiedAt: new Date(),
    },
  })
  return { ok: true, email: newEmail }
}
