'use server'

import { requestPasswordReset } from '@/lib/auth/flows'
import { audienceHint } from '@/lib/auth/login-audience'
import { requestMetadata } from '@/lib/http/request-metadata'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim()
  const from = String(formData.get('from') ?? '') || undefined
  const hint = audienceHint(from)

  if (!email) return fieldError({ email: 'Enter your email address.' })

  // Same response whether or not the address has an account (flows.ts's own
  // rule) — nothing here for the UI to branch on.
  await requestPasswordReset(email, hint, (await requestMetadata()).ipAddress)

  return success('If that email has an account, a password reset link is on its way. It works for 60 minutes.')
}
