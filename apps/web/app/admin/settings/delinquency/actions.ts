'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { exampleTimeline, saveTimeline } from '@/lib/admin/delinquency-timeline'
import {
  AUTOMATED_ACTIONS,
  DELIVERY_METHODS,
  PROOF_FIELDS,
  type AutomatedAction,
  type DeliveryMethod,
  type ProofField,
  type TimelineStep,
} from '@storage/core/delinquency'

// PRD 02 US-25/US-29 (B-056). Every gate lives in
// lib/admin/delinquency-timeline.ts; these read the form and turn a refusal
// into a sentence.

/// The form posts one indexed group of fields per step. Parsed defensively:
/// this is a legal configuration and a silently-dropped step is a notice that
/// never goes out.
function stepsFromForm(formData: FormData): TimelineStep[] {
  const steps: TimelineStep[] = []
  const count = Number(formData.get('stepCount') ?? 0)

  for (let index = 0; index < count; index += 1) {
    const day = formData.get(`day-${index}`)
    // A removed row posts an empty day. Skipping is how "delete this step"
    // works without a second action.
    if (day === null || String(day).trim() === '') continue

    const pick = <T extends string>(name: string, allowed: readonly T[]): T[] =>
      formData.getAll(`${name}-${index}`).map(String).filter((value): value is T =>
        (allowed as readonly string[]).includes(value),
      )

    steps.push({
      dayOffset: Number(day),
      label: String(formData.get(`label-${index}`) ?? ''),
      automatedActions: pick<AutomatedAction>('action', AUTOMATED_ACTIONS),
      noticeTemplateKey: String(formData.get(`template-${index}`) ?? '').trim() || null,
      deliveryMethods: pick<DeliveryMethod>('delivery', DELIVERY_METHODS),
      staffTaskLabel: String(formData.get(`task-${index}`) ?? '').trim() || null,
      requiredProofFields: pick<ProofField>('proof', PROOF_FIELDS),
    })
  }

  return steps
}

export async function saveTimelineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const result = await saveTimeline(actor, facilityId, {
    label: String(formData.get('label') ?? ''),
    qualifyingAmount: formData.get('qualifyingAmount') === 'rent_only' ? 'rent_only' : 'full_balance',
    steps: stepsFromForm(formData),
  })

  if (!result.ok) {
    // Numbered by step so a person can find the row, since the refusals are
    // about a specific day rather than about the form as a whole.
    return fieldError({
      steps: result.problems
        .map((problem) => (problem.index === null ? problem.problem : `Step ${problem.index + 1}: ${problem.problem}`))
        .join(' '),
    })
  }

  revalidatePath('/admin/settings/delinquency')
  return success(
    `Saved as version ${result.version} and made active. Earlier versions are kept — leases they governed still point at them.`,
  )
}

/// US-29's example, loaded into the form for editing. Deliberately a separate
/// action from saving: an operator has to look at it and press save, so no
/// facility ends up running a timeline nobody read.
export async function loadExampleAction(): Promise<{ label: string; steps: TimelineStep[] }> {
  await requireStaffActor()
  return exampleTimeline()
}
