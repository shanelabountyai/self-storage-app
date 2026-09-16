'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import {
  beginEnrollment,
  confirmEnrollment,
  regenerateRecoveryCodes,
} from '@/lib/auth/mfa'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { messages } from '@/lib/i18n/server'

// B-079. The three writes the enrolment screen makes. All three act on the
// SIGNED-IN staff member and take no id from the form — an id in a hidden field
// would be a way to re-key somebody else's second factor.

export async function beginEnrollmentAction(_prev: FormState): Promise<FormState> {
  const actor = await requireStaffActor()
  const { t } = await messages()
  const result = await beginEnrollment(actor.staffUserId)

  if ('error' in result) {
    return fieldError({ code: t('mfa.problem.alreadyOn') })
  }

  revalidatePath('/mfa')
  return success(t('mfa.setupStarted'))
}

export async function confirmEnrollmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const { t } = await messages()
  const code = String(formData.get('code') ?? '').trim()

  if (!code) return fieldError({ code: t('mfa.problem.codeRequired') })

  const result = await confirmEnrollment(actor.staffUserId, code)

  if (!result.ok) {
    return fieldError({
      code: result.reason === 'bad_code' ? t('mfa.problem.badCode') : t('mfa.problem.noEnrollment'),
    })
  }

  revalidatePath('/mfa')
  return success(t('mfa.enrolled.confirmed'), result.recoveryCodes)
}

export async function regenerateRecoveryCodesAction(_prev: FormState): Promise<FormState> {
  const actor = await requireStaffActor()
  const { t } = await messages()
  const codes = await regenerateRecoveryCodes(actor.staffUserId)

  revalidatePath('/mfa')
  return success(t('mfa.enrolled.regenerated'), codes)
}
