'use server'

import { revalidatePath } from 'next/cache'
import { DAYS_OF_WEEK, type WeeklySchedule } from '@storage/core/facility-settings'
import { requireStaffActor } from '@/lib/rbac/session'
import { formatCents } from '@/lib/format'
import {
  fieldError,
  parseDate,
  parseScaled,
  success,
  type FieldErrors,
  type FormState,
} from '@/lib/admin/form-state'
import {
  addFeeScheduleEntry,
  addTaxComponent,
  updateFacilityDetails,
  updateFacilityHours,
} from '@/lib/admin/facility-settings'

// PRD 02 FR-19: these RETURN error state rather than throwing it. Before B-094
// every one of them was `await doThing(...)` with no try/catch, so a rejected
// value rendered an error boundary instead of a message beside the field.

function readWeeklySchedule(formData: FormData, namePrefix: string): WeeklySchedule {
  const schedule = {} as WeeklySchedule
  for (const day of DAYS_OF_WEEK) {
    const closed = formData.get(`${namePrefix}.${day}.closed`) != null
    schedule[day] = closed
      ? { closed: true }
      : {
          closed: false,
          open: String(formData.get(`${namePrefix}.${day}.open`) ?? ''),
          close: String(formData.get(`${namePrefix}.${day}.close`) ?? ''),
        }
  }
  return schedule
}

/// Domain-layer rejections still arrive as exceptions (the libs under
/// lib/admin/ throw, and B-094 is not rewriting those). This turns the last one
/// into a form-level message so the user sees a sentence rather than a stack.
function asFormError(error: unknown, fallback: string): FormState {
  const message = error instanceof Error ? error.message : fallback
  return { status: 'error', message, fieldErrors: {} }
}

export async function updateFacilityDetailsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId'))

  const state = String(formData.get('state') ?? '').trim()
  const errors: FieldErrors = {}
  // 3.3.3 wants a suggestion, not just an identification.
  if (!/^[A-Za-z]{2}$/.test(state)) {
    errors.state = 'State must be a 2-letter code, for example TX.'
  }
  if (String(formData.get('name') ?? '').trim() === '') {
    errors.name = 'Enter the facility name as customers should see it.'
  }
  if (Object.keys(errors).length > 0) return fieldError(errors)

  try {
    await updateFacilityDetails(actor, facilityId, {
      name: String(formData.get('name')),
      addressLine1: String(formData.get('addressLine1')),
      addressLine2: String(formData.get('addressLine2') || '') || null,
      city: String(formData.get('city')),
      state: state.toUpperCase(),
      postalCode: String(formData.get('postalCode')),
      timezone: String(formData.get('timezone')),
      phone: String(formData.get('phone') || '') || null,
      email: String(formData.get('email') || '') || null,
    })
  } catch (error) {
    return asFormError(error, 'Could not save the facility details.')
  }

  revalidatePath('/admin/settings')
  return success('Facility details saved.')
}

export async function updateFacilityHoursAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId'))

  try {
    await updateFacilityHours(actor, facilityId, {
      officeHours: readWeeklySchedule(formData, 'officeHours'),
      gateHours: readWeeklySchedule(formData, 'gateHours'),
    })
  } catch (error) {
    // The domain layer rejects a day whose close is not after its open, which
    // is the realistic failure here.
    return asFormError(error, 'Could not save the hours.')
  }

  revalidatePath('/admin/settings')
  return success('Office and gate hours saved.')
}

export async function addTaxComponentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId'))

  const jurisdiction = String(formData.get('jurisdiction') ?? '').trim()
  // Entered as a percentage (e.g. "8.25"); stored as basis points (825).
  const rate = parseScaled(formData.get('ratePercent'), {
    scale: 100,
    min: 0,
    max: 100,
    unit: 'percent',
  })
  const effectiveFrom = parseDate(formData.get('effectiveFrom'))

  const errors: FieldErrors = {}
  if (jurisdiction === '') errors.jurisdiction = 'Name the jurisdiction, for example "state".'
  if ('error' in rate) errors.ratePercent = rate.error
  if ('error' in effectiveFrom) errors.effectiveFrom = effectiveFrom.error
  if (Object.keys(errors).length > 0) return fieldError(errors)
  if ('error' in rate || 'error' in effectiveFrom) return fieldError(errors)

  // 3.3.4 Error Prevention (Legal, Financial, Data). Tax components are
  // append-only by design (FR-9) — there is no edit and no delete — so this is
  // one click away from a rate every future invoice applies, forever. Echo back
  // what we parsed, in the user's terms, and make them agree to it.
  if (formData.get('confirmed') !== 'yes') {
    return {
      status: 'confirm',
      message: 'Check this before it is published — it cannot be edited or deleted.',
      echo: [
        { label: 'Jurisdiction', value: jurisdiction },
        { label: 'Rate', value: `${(rate.value / 100).toFixed(2)}%` },
        { label: 'Effective from', value: effectiveFrom.value.toISOString().slice(0, 10) },
      ],
    }
  }

  try {
    await addTaxComponent(actor, facilityId, {
      jurisdiction,
      rateBasisPoints: rate.value,
      effectiveFrom: effectiveFrom.value,
    })
  } catch (error) {
    return asFormError(error, 'Could not add the tax rate.')
  }

  revalidatePath('/admin/settings')
  return success(
    `${jurisdiction} tax of ${(rate.value / 100).toFixed(2)}% added, effective ${effectiveFrom.value
      .toISOString()
      .slice(0, 10)}.`,
  )
}

export async function addFeeScheduleEntryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId'))

  const feeType = String(formData.get('feeType') ?? '')
  // Entered in dollars; stored as cents, per the money-is-cents convention.
  // Capped at $10,000: a fee schedule is admin/late/nsf/lien amounts, so a
  // five-figure entry is a typo, not a policy.
  const amount = parseScaled(formData.get('amountDollars'), {
    scale: 100,
    min: 0,
    max: 10_000,
    unit: 'dollars',
  })
  const effectiveFrom = parseDate(formData.get('effectiveFrom'))

  const errors: FieldErrors = {}
  if ('error' in amount) errors.amountDollars = amount.error
  if ('error' in effectiveFrom) errors.effectiveFrom = effectiveFrom.error
  if (Object.keys(errors).length > 0) return fieldError(errors)
  if ('error' in amount || 'error' in effectiveFrom) return fieldError(errors)

  if (formData.get('confirmed') !== 'yes') {
    return {
      status: 'confirm',
      message: 'Check this before it is published — it cannot be edited or deleted.',
      echo: [
        { label: 'Fee', value: feeType },
        { label: 'Amount', value: formatCents(amount.value) },
        { label: 'Effective from', value: effectiveFrom.value.toISOString().slice(0, 10) },
      ],
    }
  }

  try {
    await addFeeScheduleEntry(actor, facilityId, {
      feeType: feeType as 'admin' | 'late' | 'nsf' | 'lien',
      amountCents: amount.value,
      effectiveFrom: effectiveFrom.value,
    })
  } catch (error) {
    return asFormError(error, 'Could not add the fee.')
  }

  revalidatePath('/admin/settings')
  return success(
    `${feeType} fee of ${formatCents(amount.value)} added, effective ${effectiveFrom.value
      .toISOString()
      .slice(0, 10)}.`,
  )
}
