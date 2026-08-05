'use server'

import { completePasswordReset } from '@/lib/auth/flows'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirmPassword') ?? '')

  if (password.length < 8) {
    return fieldError({ password: 'Password must be at least 8 characters.' })
  }
  if (password !== confirm) {
    return fieldError({ confirmPassword: 'Passwords do not match.' })
  }

  const result = await completePasswordReset(token, password)
  if (!result.ok) {
    return result.reason === 'invalid_token'
      ? fieldError({ token: 'This link is no longer good. It may have expired or already been used.' })
      : fieldError({ password: 'Password must be at least 8 characters.' })
  }

  return success('Password updated. You can sign in with it now.')
}
