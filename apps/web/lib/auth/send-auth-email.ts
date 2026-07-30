import type { AuthTokenPurpose } from '@storage/db'

// Delivery seam. The real sender — Resend with domain auth, consent checks,
// templates and an idempotent message log — is B-030; this keeps B-003
// self-contained without pretending to be that service.

type SendArgs = {
  to: string
  purpose: AuthTokenPurpose
  url: string
  expiresAt: Date
}

export async function sendAuthEmail({ to, purpose, url, expiresAt }: SendArgs): Promise<void> {
  if (process.env.RESEND_API_KEY) {
    throw new Error(
      'RESEND_API_KEY is set but the comms service is not built yet — wire this to the notification service in B-030.',
    )
  }

  if (process.env.NODE_ENV === 'production') {
    // Failing loudly beats silently dropping a sign-in link in production.
    throw new Error(`Cannot send ${purpose} email: no email provider configured`)
  }

  const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60_000)
  console.info(
    `\n[auth] ${purpose} link for ${to} (expires in ${minutes} min):\n  ${url}\n`,
  )
}
