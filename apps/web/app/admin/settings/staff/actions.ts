'use server'

import { revalidatePath } from 'next/cache'
import { getAdminActor } from '@/lib/admin/context'
import { resetStaffMfa } from '@/lib/admin/staff-security'
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
