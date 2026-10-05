'use server'

import { revalidatePath } from 'next/cache'
import type { OrgDefaultScope } from '@storage/db'
import { getAdminActor } from '@/lib/admin/context'
import { getOrgDefault, pushOrgDefault, saveOrgDefault } from '@/lib/admin/org-defaults'
import { activeTimeline } from '@/lib/admin/delinquency-timeline'
import { ForbiddenError } from '@/lib/rbac/authorize'
import { saveUnrentableLimits } from '@/lib/admin/unrentable'
import { fieldError, parseDate, parseScaled, success, type FormState } from '@/lib/admin/form-state'
import type { LateFeeBasis } from '@storage/core/billing'

const LATE_FEE_BASES: LateFeeBasis[] = ['flat', 'percent', 'greater', 'lesser']

// PRD 02 US-4 (B-079). Editing an org default and pushing it.

const SCOPES: OrgDefaultScope[] = ['fee_schedule', 'late_fee_ladder', 'delinquency_timeline']

function scopeOf(raw: FormDataEntryValue | null): OrgDefaultScope | null {
  const value = String(raw ?? '')
  return SCOPES.includes(value as OrgDefaultScope) ? (value as OrgDefaultScope) : null
}

/// The fee-schedule default, edited one fee type at a time so the form never
/// has to re-post the whole set — a fee somebody forgot to fill in would
/// otherwise silently drop out of the default.
export async function saveFeeDefaultAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await getAdminActor()
  const feeType = String(formData.get('feeType') ?? '').trim()
  if (!feeType) return fieldError({ feeType: 'Choose a fee type.' })

  const amount = parseScaled(formData.get('amount'), {
    scale: 100,
    min: 0,
    max: 100_000,
    unit: 'dollars',
  })
  if ('error' in amount) return fieldError({ amount: amount.error })

  const existing = await currentFees()
  const fees = [
    ...existing.filter((fee) => fee.feeType !== feeType),
    { feeType, amountCents: amount.value },
  ].sort((a, b) => a.feeType.localeCompare(b.feeType))

  try {
    await saveOrgDefault(actor, {
      scope: 'fee_schedule',
      label: String(formData.get('label') ?? '').trim() || 'Org fee schedule',
      payload: { fees },
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fieldError({ amount: 'Only an owner or a manager assigned to every facility can edit an org default.' })
    }
    throw error
  }

  revalidatePath('/admin/settings/org')
  return success(`Org default for the ${feeType.replace(/_/g, ' ')} fee set. Push it below to apply it anywhere.`)
}

export async function saveLadderDefaultAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await getAdminActor()

  const step = Number(formData.get('step'))
  if (!Number.isInteger(step) || step < 1) return fieldError({ step: 'Step must be 1 or higher.' })

  const days = Number(formData.get('daysPastDue'))
  if (!Number.isInteger(days) || days < 0) {
    return fieldError({ daysPastDue: 'Enter whole days past due, e.g. 10.' })
  }

  const amount = parseScaled(formData.get('amount'), { scale: 100, min: 0, max: 100_000, unit: 'dollars' })
  if ('error' in amount) return fieldError({ amount: amount.error })

  const percent = parseScaled(formData.get('percent'), { scale: 100, min: 0, max: 100, unit: 'percent' })
  if ('error' in percent) return fieldError({ percent: percent.error })

  const basis = String(formData.get('basis') ?? '')
  if (!LATE_FEE_BASES.includes(basis as LateFeeBasis)) {
    return fieldError({ basis: 'Choose how this step computes.' })
  }

  const capRaw = String(formData.get('cap') ?? '').trim()
  let capCents: number | null = null
  if (capRaw !== '') {
    const cap = parseScaled(capRaw, { scale: 100, min: 0, max: 100_000, unit: 'dollars' })
    if ('error' in cap) return fieldError({ cap: cap.error })
    capCents = cap.value
  }
  // A percentage with no ceiling charges without bound on a large balance —
  // the same guard the per-facility ladder carries.
  if (basis !== 'flat' && capCents === null) {
    return fieldError({ cap: 'A percentage step needs a cap. An uncapped percentage grows with the balance it is punishing.' })
  }

  // B-413. The state the whole ladder is written for, not this step alone: a
  // default is pushed as a unit, to facilities in one state.
  const jurisdiction = String(formData.get('jurisdiction') ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(jurisdiction)) {
    return fieldError({ jurisdiction: 'Enter the 2-letter state this ladder is written for, for example TX.' })
  }
  const before = await getOrgDefault('late_fee_ladder')

  const existing = await currentLadder()
  const ladder = [
    ...existing.filter((rule) => rule.step !== step),
    {
      step,
      daysPastDue: days,
      amountCents: amount.value,
      percentBasisPoints: percent.value,
      basis,
      capCents,
    },
  ].sort((a, b) => a.step - b.step)

  try {
    await saveOrgDefault(actor, {
      scope: 'late_fee_ladder',
      label: String(formData.get('label') ?? '').trim() || 'Org late-fee ladder',
      payload: { ladder },
      jurisdiction,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fieldError({ amount: 'Only an owner or a manager assigned to every facility can edit an org default.' })
    }
    throw error
  }

  revalidatePath('/admin/settings/org')
  // Said out loud when it changes, because it re-marks every step and not only
  // the one just saved.
  const remarked =
    before?.jurisdiction && before.jurisdiction !== jurisdiction
      ? ` The whole ladder is now marked as written for ${jurisdiction}; it was ${before.jurisdiction}.`
      : ''
  return success(
    `Step ${step} of the org ladder saved, written for ${jurisdiction}.${remarked} Push it below to apply it to facilities in ${jurisdiction}.`,
  )
}

/// Takes a facility's active timeline and makes it the org default.
///
/// There is no second timeline editor here on purpose. `/admin/settings/
/// delinquency` already builds one, validates every step against the notice
/// templates that exist, and refuses the configurations that would silently do
/// nothing — and it is also how this actually gets done: an operator perfects
/// one site's timeline with their attorney and then rolls it out. Rebuilding
/// that form here would be a second place for a lien timeline to be wrong.
export async function adoptTimelineDefaultAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await getAdminActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  if (!facilityId) return fieldError({ facilityId: 'Choose the facility to copy the timeline from.' })

  const timeline = await activeTimeline(facilityId)
  if (!timeline) {
    return fieldError({
      facilityId: 'That facility has no active timeline yet. Build one on its delinquency settings screen first.',
    })
  }

  try {
    await saveOrgDefault(actor, {
      scope: 'delinquency_timeline',
      label: timeline.label,
      payload: {
        timeline: { qualifyingAmount: timeline.qualifyingAmount, steps: timeline.steps },
      },
      // B-413. The default is for the state the adopted version was written
      // for, which is the choice the owner made by picking that facility.
      jurisdiction: timeline.jurisdiction,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fieldError({ facilityId: 'Only an owner or a manager assigned to every facility can edit an org default.' })
    }
    throw error
  }

  revalidatePath('/admin/settings/org')
  return success(
    `"${timeline.label}" is now the org default timeline, written for ${timeline.jurisdiction}. Nothing changed at any facility — push it below to roll it out to facilities in ${timeline.jurisdiction}.`,
  )
}

export async function pushOrgDefaultAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await getAdminActor()

  const scope = scopeOf(formData.get('scope'))
  if (!scope) return fieldError({ scope: 'Choose which default to push.' })

  const facilityIds = formData.getAll('facilityIds').map(String).filter(Boolean)
  if (facilityIds.length === 0) {
    return fieldError({ facilityIds: 'Tick at least one facility to push to.' })
  }

  const effectiveFrom = parseDate(formData.get('effectiveFrom'))
  if ('error' in effectiveFrom) return fieldError({ effectiveFrom: effectiveFrom.error })

  let results
  try {
    results = await pushOrgDefault(actor, { scope, facilityIds, effectiveFrom: effectiveFrom.value })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fieldError({ facilityIds: 'Only an owner or a manager assigned to every facility can push an org default.' })
    }
    throw error
  }

  revalidatePath('/admin/settings/org')

  const pushed = results.filter((r) => r.outcome === 'pushed')
  const skipped = results.filter((r) => r.outcome === 'already_matched')
  const refused = results.filter((r) => r.outcome === 'forbidden' || r.outcome === 'invalid')
  const elsewhere = results.filter((r) => r.outcome === 'wrong_state')

  // Every facility is named in the result, including the ones nothing happened
  // to. "Pushed to 9 of 12" without saying which three were skipped is how an
  // operator ends up believing a rate is live at a site where it is not.
  return success(
    `Pushed to ${pushed.length} ${pushed.length === 1 ? 'facility' : 'facilities'}.`,
    [
      ...pushed.map((r) => `${r.facilityName}: pushed`),
      ...skipped.map((r) => `${r.facilityName}: already matched the default, nothing written`),
      ...refused.map((r) =>
        r.outcome === 'forbidden'
          ? `${r.facilityName}: skipped — you cannot change settings at this facility`
          : `${r.facilityName}: refused — ${r.detail ?? 'the default is not valid here'}`,
      ),
      ...elsewhere.map((r) => `${r.facilityName}: not pushed — ${r.detail}`),
    ],
  )
}

async function currentFees(): Promise<{ feeType: string; amountCents: number }[]> {
  const record = await getOrgDefault('fee_schedule')
  const fees = (record?.payload as { fees?: unknown } | undefined)?.fees
  return Array.isArray(fees) ? (fees as { feeType: string; amountCents: number }[]) : []
}

type LadderRule = {
  step: number
  daysPastDue: number
  amountCents: number
  percentBasisPoints: number
  basis: string
  capCents: number | null
}

async function currentLadder(): Promise<LadderRule[]> {
  const record = await getOrgDefault('late_fee_ladder')
  const ladder = (record?.payload as { ladder?: unknown } | undefined)?.ladder
  return Array.isArray(ladder) ? (ladder as LadderRule[]) : []
}

/// B-433. The two limits past which `unrentable` needs a district manager.
export async function saveUnrentableLimitsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await getAdminActor()

  const maxUnits = Number(formData.get('maxUnits'))
  if (!Number.isInteger(maxUnits) || maxUnits < 0 || maxUnits > 10_000) {
    return fieldError({ maxUnits: 'Enter a whole number of units, e.g. 5.' })
  }
  const maxDays = Number(formData.get('maxDays'))
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 3650) {
    return fieldError({ maxDays: 'Enter a whole number of days, e.g. 30.' })
  }

  try {
    await saveUnrentableLimits(actor, { maxUnits, maxDays })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return fieldError({ maxUnits: 'Only an owner or a manager assigned to every facility can change an org limit.' })
    }
    throw error
  }

  revalidatePath('/admin/settings/org')
  return success(`Unrentable limits set: ${maxUnits} units at a facility, ${maxDays} days for one unit.`)
}
