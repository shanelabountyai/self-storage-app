'use server'

import { revalidatePath } from 'next/cache'
import { isSharedAccessPreset, SHARED_ACCESS_PRESETS } from '@storage/core/access'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import {
  issueNonTenantCode,
  revokeNonTenantCode,
  type IssueNonTenantRefusal,
} from '@/lib/access/non-tenant'

// PRD 03 US-10 (B-436). Thin session wrappers over lib/access/non-tenant.ts.

const HOLDER_TYPES = ['staff', 'vendor', 'temporary'] as const

const REFUSALS: Record<IssueNonTenantRefusal, { field: string; message: string }> = {
  name_required: {
    field: 'holderName',
    message: 'Enter the name the gate log should show, e.g. "Lone Star Pest Control".',
  },
  staff_required: { field: 'staffUserId', message: 'Choose the staff member this code is for.' },
  staff_not_active: {
    field: 'staffUserId',
    message: 'That staff account is not active. Choose an active staff member.',
  },
  staff_has_code: {
    field: 'staffUserId',
    message: 'They already have a code at this facility. Revoke it below before issuing another.',
  },
  expiry_required: {
    field: 'expiresOn',
    message: 'A temporary code needs a last day, e.g. the day of the visit.',
  },
  expiry_in_past: { field: 'expiresOn', message: 'Choose today or a later date.' },
}

export async function issueNonTenantCodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const holderType = String(formData.get('holderType') ?? '')
  const hours = String(formData.get('hours') ?? 'anytime')
  const expiresOn = String(formData.get('expiresOn') ?? '').trim()

  if (!(HOLDER_TYPES as readonly string[]).includes(holderType)) {
    return fieldError({ holderType: 'Choose staff, vendor or temporary.' })
  }

  const issued = await issueNonTenantCode(actor, {
    facilityId,
    holderType: holderType as (typeof HOLDER_TYPES)[number],
    holderName: String(formData.get('holderName') ?? ''),
    staffUserId: String(formData.get('staffUserId') ?? '') || undefined,
    accessHours: isSharedAccessPreset(hours) ? SHARED_ACCESS_PRESETS[hours].schedule : null,
    expiresOn: expiresOn || null,
  })
  if (!issued.ok) {
    const refusal = REFUSALS[issued.reason]
    return fieldError({ [refusal.field]: refusal.message })
  }

  revalidatePath('/admin/access/codes')
  // The digits are shown here once and nowhere afterwards.
  return success('Code issued. Give it to the holder now. It is not shown again.', [
    `Gate code: ${issued.code}`,
  ])
}

export async function revokeNonTenantCodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const grantId = String(formData.get('grantId') ?? '')
  const holderName = String(formData.get('holderName') ?? '')

  if (formData.get('confirmed') !== 'yes') {
    return {
      status: 'confirm',
      message: 'The code stops working at the keypad as soon as you confirm.',
      echo: [{ label: 'Holder', value: holderName }],
      confirmLabel: 'Yes, revoke the code',
      cancel: { label: 'Keep the code', message: 'The code was not revoked.' },
    }
  }

  const result = await revokeNonTenantCode(actor, grantId, 'staff_revoked')
  revalidatePath('/admin/access/codes')
  return success(
    result.ok ? `${holderName}'s code is revoked.` : 'That code was already revoked.',
  )
}
