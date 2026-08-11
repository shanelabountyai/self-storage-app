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

  // The file is optional. Read here rather than inside the service so the
  // service takes bytes and knows nothing about forms.
  const file = formData.get('document')
  const document =
    file instanceof File && file.size > 0
      ? {
          bytes: new Uint8Array(await file.arrayBuffer()),
          declaredType: file.type || null,
          filename: file.name || null,
        }
      : undefined

  const result = await submitInsuranceProof({
    tenantId: actor.tenantId,
    leaseId,
    carrier,
    policyNumber,
    expiresAt: expires.value,
    document,
  })
  if (!result.ok) return fieldError({ carrier: 'We could not find that unit on your account.' })

  revalidatePath('/portal/protection')

  // A rejected file is reported WITHOUT losing the submission. The expiry date
  // is what stops D-17 auto-enrolling them into a paid plan, and throwing that
  // away because a photo was in the wrong format would be the worse failure by
  // a distance.
  if (result.documentProblem) {
    return success(
      `We have your policy details. We could not keep the file, though — ${result.documentProblem}`,
    )
  }

  return success(
    document
      ? 'Thanks — we have your policy details and your declaration page. Someone here will check them over.'
      : 'Thanks — we have your policy details. Someone will check them against your declaration page, and we will email you if anything is missing.',
  )
}
