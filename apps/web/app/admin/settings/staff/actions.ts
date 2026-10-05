'use server'

import { revalidatePath } from 'next/cache'
import { getAdminActor } from '@/lib/admin/context'
import { deactivateStaffUser, resetStaffMfa } from '@/lib/admin/staff-security'
import { ForbiddenError } from '@/lib/rbac/authorize'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

export async function resetStaffMfaAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await getAdminActor()
  const staffUserId = String(formData.get('staffUserId') ?? '')
  const reasonCode = String(formData.get('reasonCode') ?? '').trim()

  if (!staffUserId) return fieldError({ staffUserId: 'Choose whose second factor to reset.' })
  // `mfa.reset_by_admin` is in the catalog as requiring a reason, so recordAudit
  // would throw without one — caught here so it reads as a field error rather
  // than an error page.
  if (!reasonCode) {
    return fieldError({
      reasonCode: 'Say why, e.g. "lost phone, identity confirmed by video call".',
    })
  }

  let result
  try {
    result = await resetStaffMfa(actor, { staffUserId, reasonCode })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fieldError({
        staffUserId: 'Only an owner, or a manager assigned to every facility, can reset a second factor.',
      })
    }
    throw error
  }

  if (!result.ok) {
    return fieldError({
      staffUserId:
        result.reason === 'self'
          ? 'Manage your own second factor from the two-factor page — this button is for other people.'
          : 'That staff account no longer exists.',
    })
  }

  revalidatePath('/admin/settings/staff')
  return success(
    'Second factor cleared. They will be asked to set up a new authenticator the next time they open the admin — their password is unchanged.',
  )
}

/// PRD 03 US-10 AC2 (B-436). Two presses: the first echoes who, the second
/// deactivates. There is no undo control, so the echo is the check.
export async function deactivateStaffAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await getAdminActor()
  const staffUserId = String(formData.get('deactivateStaffUserId') ?? '')
  const reasonCode = String(formData.get('deactivateReason') ?? '').trim()

  if (!staffUserId) return fieldError({ deactivateStaffUserId: 'Choose whose account to deactivate.' })
  if (!reasonCode) {
    return fieldError({ deactivateReason: 'Say why, e.g. "left the company on 3 October".' })
  }

  if (formData.get('confirmed') !== 'yes') {
    return {
      status: 'confirm',
      message:
        'They are signed out and every gate code they hold stops working. There is no button to undo this.',
      echo: [{ label: 'Reason', value: reasonCode }],
      confirmLabel: 'Yes, deactivate the account',
      cancel: { label: 'Keep the account', message: 'The account was not changed.' },
    }
  }

  let result
  try {
    result = await deactivateStaffUser(actor, { staffUserId, reasonCode })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fieldError({
        deactivateStaffUserId:
          'Only an owner, or a manager assigned to every facility, can deactivate an account.',
      })
    }
    throw error
  }

  if (!result.ok) {
    return fieldError({
      deactivateStaffUserId:
        result.reason === 'self'
          ? 'You cannot deactivate your own account. Ask another owner.'
          : result.reason === 'already_inactive'
            ? 'That account is already inactive.'
            : 'That staff account no longer exists.',
    })
  }

  revalidatePath('/admin/settings/staff')
  return success(
    `Account deactivated. ${result.gateCodesRevoked} gate code${result.gateCodesRevoked === 1 ? '' : 's'} revoked.`,
  )
}
