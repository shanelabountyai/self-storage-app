'use server'

import { requestPasswordReset } from '@/lib/auth/flows'
import { audienceHint } from '@/lib/auth/login-audience'
import { requestMetadata } from '@/lib/http/request-metadata'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { messages } from '@/lib/i18n/server'

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t } = await messages()
  const email = String(formData.get('email') ?? '').trim()
  const from = String(formData.get('from') ?? '') || undefined
  const hint = audienceHint(from)

  if (!email) return fieldError({ email: t('auth.problem.email') })

  // Same response whether or not the address has an account (flows.ts's own
  // rule) — nothing here for the UI to branch on.
  await requestPasswordReset(email, hint, (await requestMetadata()).ipAddress)

  return success(t('fpwd.linkSent'))
}
