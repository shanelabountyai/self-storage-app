'use server'

import { completePasswordReset, resetLinkLocale } from '@/lib/auth/flows'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { dictionaryFor, translate } from '@/lib/i18n'

// B-311. Translated from the TOKEN's tenant, not the visitor's cookie — this
// action's response renders on the same page `resetLinkLocale` already chose
// a language for (page.tsx's own `pageLocale`), and the two must agree or a
// Spanish page would announce an English refusal.
export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirmPassword') ?? '')
  const dict = dictionaryFor(await resetLinkLocale(token))
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)

  if (password.length < 8) {
    return fieldError({ password: t('rpwd.problem.weak') })
  }
  if (password !== confirm) {
    return fieldError({ confirmPassword: t('rpwd.problem.mismatch') })
  }

  const result = await completePasswordReset(token, password)
  if (!result.ok) {
    return result.reason === 'invalid_token'
      ? fieldError({ token: t('rpwd.problem.badToken') })
      : fieldError({ password: t('rpwd.problem.weak') })
  }

  return success(t('rpwd.updated'))
}
