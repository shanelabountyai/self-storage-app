'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import {
  beginEnrollment,
  confirmEnrollment,
  regenerateRecoveryCodes,
} from '@/lib/auth/mfa'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// B-079. The three writes the enrolment screen makes. All three act on the
// SIGNED-IN staff member and take no id from the form — an id in a hidden field
// would be a way to re-key somebody else's second factor.

export async function beginEnrollmentAction(_prev: FormState): Promise<FormState> {
  const actor = await requireStaffActor()
  const result = await beginEnrollment(actor.staffUserId)

  if ('error' in result) {
    return fieldError({
      code: 'Two-factor authentication is already switched on for this account. Ask an administrator to reset it if you have lost your authenticator.',
    })
  }

  revalidatePath('/mfa')
  return success('Setup started. Add the key below to your authenticator app, then enter a code to finish.')
}

export async function confirmEnrollmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const code = String(formData.get('code') ?? '').trim()

  if (!code) return fieldError({ code: 'Enter the 6-digit code from your authenticator app.' })

  const result = await confirmEnrollment(actor.staffUserId, code)

  if (!result.ok) {
    return fieldError({
      code:
        result.reason === 'bad_code'
          ? 'That code was not right. Codes change every 30 seconds — wait for the next one and try again.'
          : 'Start the setup again — this account has no half-finished enrolment to confirm.',
    })
  }

  revalidatePath('/mfa')
  return success(
    'Two-factor authentication is on. Save these recovery codes somewhere safe — each works once, and this is the only time they are shown.',
    result.recoveryCodes,
  )
}

export async function regenerateRecoveryCodesAction(_prev: FormState): Promise<FormState> {
  const actor = await requireStaffActor()
  const codes = await regenerateRecoveryCodes(actor.staffUserId)

  revalidatePath('/mfa')
  return success(
    'New recovery codes issued. Every previous code has stopped working, including any you have not used.',
    codes,
  )
}
