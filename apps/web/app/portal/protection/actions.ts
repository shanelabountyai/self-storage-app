'use server'

import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import {
  cancelProtectionChange,
  scheduleProtectionChange,
  submitInsuranceProof,
} from '@/lib/protection/changes'
import { CHANGE_PROBLEM_MESSAGES, scheduledNotice } from '@storage/core/billing'
import { fieldError, parseDate, success, type FormState } from '@/lib/admin/form-state'

// PRD 01 US-705 (B-104). The tenant's own protection controls.

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

export async function changeProtectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTenantActor()
  const leaseId = String(formData.get('leaseId') ?? '')
  const raw = String(formData.get('tier') ?? '')
  // The empty string is the "my own cover" option, which is a real choice
  // rather than a missing one — hence a sentinel rather than an absent field.
  const tier = raw === 'waiver' ? null : raw

  if (!leaseId) return fieldError({ tier: 'Choose which unit this is for.' })
  if (raw === '') return fieldError({ tier: 'Choose a level of cover.' })

  const result = await scheduleProtectionChange({ tenantId: actor.tenantId, leaseId, tier })

  if (!result.ok) {
    return fieldError({
      tier:
        result.reason === 'not_your_lease'
          ? 'We could not find that unit on your account.'
          : CHANGE_PROBLEM_MESSAGES[result.reason],
    })
  }

  revalidatePath('/portal/protection')
  return success(
    scheduledNotice({
      selection: result.selection,
      effectiveFrom: result.effectiveFrom,
      formatDate,
    }),
  )
}

export async function cancelProtectionChangeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTenantActor()
  const changeId = String(formData.get('changeId') ?? '')

  const result = await cancelProtectionChange({ tenantId: actor.tenantId, changeId })
  if (!result.ok) {
    return fieldError({ changeId: 'That change has already taken effect or was already cancelled.' })
  }

  revalidatePath('/portal/protection')
  return success('That change has been called off. Your cover stays as it is.')
}

export async function submitProofAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const leaseId = String(formData.get('leaseId') ?? '')
  const carrier = String(formData.get('carrier') ?? '').trim()
  const policyNumber = String(formData.get('policyNumber') ?? '').trim()

  const errors: Record<string, string> = {}
  if (!carrier) errors.carrier = 'Enter the name of your insurer, for example State Farm.'
  if (!policyNumber) {
    errors.policyNumber = 'Enter your policy number — it is on your declaration page.'
  }

  const expires = parseDate(formData.get('expiresAt'))
  if ('error' in expires) errors.expiresAt = expires.error
  else if (expires.value.getTime() < Date.now()) {
    // A policy that has already run out is not cover. Accepting it would put a
    // lapsed waiver on the lease and hand D-17's scan something to auto-enrol
    // against the same night.
    errors.expiresAt = 'That policy has already run out. Enter cover that is still current.'
  }

  if (Object.keys(errors).length > 0) return fieldError(errors)
  if ('error' in expires) return fieldError(errors)

  const result = await submitInsuranceProof({
    tenantId: actor.tenantId,
    leaseId,
    carrier,
    policyNumber,
    expiresAt: expires.value,
  })
  if (!result.ok) return fieldError({ carrier: 'We could not find that unit on your account.' })

  revalidatePath('/portal/protection')
  return success(
    'Thanks — we have your policy details. Someone will check them against your declaration page, and we will email you if anything is missing.',
  )
}
