'use server'

import { revalidatePath } from 'next/cache'
import { getAdminActor } from '@/lib/admin/context'
import { ForbiddenError, type MonetaryAction } from '@/lib/rbac/authorize'
import {
  MONETARY_ACTIONS,
  MONETARY_ACTION_LABELS,
  describe,
  saveRoleLimits,
  type RoleLimits,
} from '@/lib/admin/role-limits'
import { fieldError, parseScaled, success, type FormState } from '@/lib/admin/form-state'

// PRD 02 RBAC-2 (B-197). One save per role, all four limits at once.

/// Blank is unlimited and `0` is no authority at all — two different facts that
/// a single empty box would collapse. `parseScaled` refuses an empty string, so
/// the blank is handled here before it ever reaches the range check.
function parseLimit(raw: FormDataEntryValue | null): { value: number | null } | { error: string } {
  const text = String(raw ?? '').trim()
  if (text === '') return { value: null }
  const parsed = parseScaled(raw, { scale: 100, min: 0, max: 1_000_000, unit: 'dollars' })
  return 'error' in parsed ? parsed : { value: parsed.value }
}

export async function saveRoleLimitsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await getAdminActor()
  const roleKey = String(formData.get('roleKey') ?? '').trim()
  if (!roleKey) return fieldError({ fee_waiver: 'Something went wrong — reload and try again.' })
  // Only for the announcement. The save is keyed on `roleKey` and never trusts
  // this, so a tampered value changes nothing but the sentence read back.
  const roleName = String(formData.get('roleName') ?? '').trim() || roleKey

  const limits = {} as RoleLimits
  const parseErrors: Partial<Record<MonetaryAction, string>> = {}
  for (const action of MONETARY_ACTIONS) {
    const parsed = parseLimit(formData.get(action))
    if ('error' in parsed) parseErrors[action] = parsed.error
    else limits[action] = parsed.value
  }
  if (Object.keys(parseErrors).length > 0) return fieldError(parseErrors)

  let result
  try {
    result = await saveRoleLimits(actor, { roleKey, limits })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fieldError({
        fee_waiver:
          'Only an owner, or a manager assigned to every facility, can change what a role may approve.',
      })
    }
    throw error
  }

  if (!result.ok) {
    if (result.reason === 'unknown_role') {
      return fieldError({ fee_waiver: 'That role no longer exists. Reload the page.' })
    }
    // Lands on the field that caused it (3.3.1): the ladder check reports per
    // action, and each action is one named input on this form.
    return fieldError(result.errors)
  }

  revalidatePath('/admin/settings/roles')
  return success(
    `${roleName} saved. ${MONETARY_ACTIONS.map(
      (action) => `${MONETARY_ACTION_LABELS[action]}: ${describe(limits[action])}`,
    ).join('; ')}.`,
  )
}
