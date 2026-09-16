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
import { messages } from '@/lib/i18n/server'

// PRD 01 US-705 (B-104). The tenant's own protection controls.

// B-284 left this English on purpose: it feeds `scheduledNotice`, whose whole
// sentence is English prose from `@storage/core/billing`. A Spanish date inside
// an English sentence is not the fix; moving that sentence out of the package is.
function formatDate(date: Date): string {
  // eslint-disable-next-line no-restricted-syntax
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

export async function changeProtectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTenantActor()
  const { t } = await messages()
  const leaseId = String(formData.get('leaseId') ?? '')
  const raw = String(formData.get('tier') ?? '')
  // The empty string is the "my own cover" option, which is a real choice
  // rather than a missing one — hence a sentinel rather than an absent field.
  const tier = raw === 'waiver' ? null : raw

  if (!leaseId) return fieldError({ tier: t('prot.problem.chooseUnit') })
  if (raw === '') return fieldError({ tier: t('prot.problem.chooseLevel') })

  const result = await scheduleProtectionChange({ tenantId: actor.tenantId, leaseId, tier })

  if (!result.ok) {
    return fieldError({
      tier:
        result.reason === 'not_your_lease'
          ? t('prot.problem.notYourLease')
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
  const { t } = await messages()
  const changeId = String(formData.get('changeId') ?? '')

  const result = await cancelProtectionChange({ tenantId: actor.tenantId, changeId })
  if (!result.ok) {
    return fieldError({ changeId: t('prot.problem.alreadyCancelled') })
  }

  revalidatePath('/portal/protection')
  return success(t('prot.cancelled'))
}

export async function submitProofAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const { t } = await messages()
  const leaseId = String(formData.get('leaseId') ?? '')
  const carrier = String(formData.get('carrier') ?? '').trim()
  const policyNumber = String(formData.get('policyNumber') ?? '').trim()

  const errors: Record<string, string> = {}
  if (!carrier) errors.carrier = t('prot.problem.insurer')
  if (!policyNumber) errors.policyNumber = t('prot.problem.policyNumber')

  const expires = parseDate(formData.get('expiresAt'))
  if ('error' in expires) errors.expiresAt = expires.error
  else if (expires.value.getTime() < Date.now()) {
    // A policy that has already run out is not cover. Accepting it would put a
    // lapsed waiver on the lease and hand D-17's scan something to auto-enrol
    // against the same night.
    errors.expiresAt = t('prot.problem.policyExpired')
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
  if (!result.ok) return fieldError({ carrier: t('prot.problem.notYourLease') })

  revalidatePath('/portal/protection')

  // A rejected file is reported WITHOUT losing the submission. The expiry date
  // is what stops D-17 auto-enrolling them into a paid plan, and throwing that
  // away because a photo was in the wrong format would be the worse failure by
  // a distance.
  //
  // `result.documentProblem` is the upload validator's own English reason
  // (`lib/protection/changes.ts`'s `upload.message`) and stays untranslated —
  // the same D-140 boundary as `CHANGE_PROBLEM_MESSAGES` above: this row is
  // the interface, not every message a lower module composes.
  if (result.documentProblem) {
    return success(t('prot.proofSavedNoFile', { reason: result.documentProblem }))
  }

  return success(document ? t('prot.proofSavedWithFile') : t('prot.proofSavedNoDoc'))
}
