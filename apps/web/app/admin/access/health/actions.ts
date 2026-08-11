'use server'

import { revalidatePath } from 'next/cache'
import { getAdminActor } from '@/lib/admin/context'
import { reconcileFacility } from '@/lib/access/reconciliation'
import { requirePermission, ForbiddenError } from '@/lib/rbac/authorize'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

/// FR-9's "nightly + ON-DEMAND expected-vs-actual diff".
///
/// The on-demand half matters more than it looks: the nightly run is what finds
/// drift, but this is what tells somebody who has just fixed it whether they
/// actually did — and without it the only way to confirm a repair is to wait
/// until 3am and check in the morning.
export async function reconcileNowAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await getAdminActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  if (!facilityId) return fieldError({ facilityId: 'Choose a facility to reconcile.' })

  try {
    requirePermission(actor, 'access:events', facilityId)
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fieldError({ facilityId: 'You do not have gate access for that facility.' })
    }
    throw error
  }

  const result = await reconcileFacility(facilityId)
  revalidatePath('/admin/access/health')

  if (!result.verifiable) {
    return success(
      `Could not read this controller back: ${result.reason ?? 'the adapter cannot enumerate what it holds'}. Nothing has been verified — this is not a clean result.`,
    )
  }

  if (result.drifts.length === 0) {
    return success(
      `Checked ${result.credentialsChecked} credential${result.credentialsChecked === 1 ? '' : 's'} against the controller. No differences.`,
    )
  }

  return success(
    `Checked ${result.credentialsChecked}, found ${result.drifts.length} difference${result.drifts.length === 1 ? '' : 's'}${result.permissiveCount > 0 ? `, ${result.permissiveCount} of which leave the gate more open than intended` : ''}.`,
    result.drifts.map(
      (drift) =>
        `${drift.gateTooPermissive ? '[gate too open] ' : ''}${drift.detail}${drift.externalId ? ` (controller entry ${drift.externalId})` : ''}`,
    ),
  )
}
