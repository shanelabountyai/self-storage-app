'use server'

import { requestMagicLink } from '@/lib/auth/flows'
import { audienceFor } from '@/lib/auth/login-audience'
import { requestMetadata } from '@/lib/http/request-metadata'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// Split from actions.ts — see that file's note. This one imports nothing from
// `@/auth`, so it is directly unit-testable (tests/login-flow-db.test.ts).

export async function requestMagicLinkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim()
  const from = String(formData.get('from') ?? '') || undefined
  const audience = audienceFor(from)

  if (!email) return fieldError({ email: 'Enter your email address.' })

  // Always the same response whether or not the address has an account
  // (flows.ts's own rule) — the UI must not branch on the result either.
  await requestMagicLink(email, audience, (await requestMetadata()).ipAddress)

  return success('If that email has an account, a sign-in link is on its way. It works for 15 minutes.')
}
