'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, parseDate, parseScaled, success, type FormState } from '@/lib/admin/form-state'
import { addPromoCode, createPromotion, setPromotionStatus } from '@/lib/admin/promotions'

// PRD 02 US-10 / PRD 04 FR-PROMO-1/2 (B-070). Every gate lives in
// lib/admin/promotions.ts; these turn a refusal into a sentence.

function optionalDate(raw: FormDataEntryValue | null): Date | null | { error: string } {
  if (!raw || !String(raw).trim()) return null
  const parsed = parseDate(raw)
  return 'error' in parsed ? parsed : parsed.value
}

export async function createPromotionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const type = String(formData.get('type') ?? 'percent_off') as 'percent_off' | 'amount_off' | 'free_months'

  const startsAt = optionalDate(formData.get('startsAt'))
  if (startsAt && 'error' in startsAt) return fieldError({ startsAt: startsAt.error })
  const endsAt = optionalDate(formData.get('endsAt'))
  if (endsAt && 'error' in endsAt) return fieldError({ endsAt: endsAt.error })

  // Percent and months are plain integers; an amount is dollars on the form and
  // cents in the database — the same scaling every money field here uses, so a
  // "$50 off" promo cannot become a 50-cent one.
  const raw = formData.get('value')
  const value =
    type === 'amount_off'
      ? parseScaled(raw, { scale: 100, min: 1, max: 100_000, unit: 'dollars' })
      : parseScaled(raw, { scale: 1, min: type === 'free_months' ? 0 : 1, max: 100, unit: '' })
  if ('error' in value) return fieldError({ value: value.error })

  const months = parseScaled(formData.get('durationPeriods'), { scale: 1, min: 1, max: 24, unit: 'months' })
  if ('error' in months) return fieldError({ durationPeriods: months.error })

  const cap = String(formData.get('maxRedemptions') ?? '').trim()
  const maxRedemptions = cap ? Number(cap) : null
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    return fieldError({ maxRedemptions: 'A whole number of redemptions, or leave it empty for no cap.' })
  }

  const result = await createPromotion(actor, facilityId, {
    name: String(formData.get('name') ?? ''),
    type,
    value: value.value,
    durationPeriods: months.value,
    displayMode: formData.get('displayMode') === 'code' ? 'code' : 'auto',
    // Scoped to the facility being edited. A promo for every site is a
    // deliberate act, not the default an operator gets by not noticing a field.
    facilityIds: [facilityId],
    newTenantOnly: formData.get('newTenantOnly') === 'on',
    startsAt: (startsAt as Date | null) ?? null,
    endsAt: (endsAt as Date | null) ?? null,
    maxRedemptions,
    termsText: String(formData.get('termsText') ?? ''),
  })
  if (!result.ok) return fieldError({ [result.field]: result.problem })

  revalidatePath('/admin/settings/promotions')
  return success('Created as a draft. Nothing is live until you activate it.')
}

export async function setStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const status = String(formData.get('status') ?? '') as 'draft' | 'active' | 'paused' | 'ended'

  const result = await setPromotionStatus(actor, facilityId, String(formData.get('promotionId') ?? ''), status)
  if (!result.ok) return fieldError({ status: result.problem })

  revalidatePath('/admin/settings/promotions')
  // Every facility page shows badges, and a promo going live that nobody can
  // see for five minutes is a campaign that starts late.
  revalidatePath('/storage', 'layout')
  return success(status === 'active' ? 'Live. It is on the facility pages now.' : 'Saved.')
}

export async function addCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const expiresAt = optionalDate(formData.get('expiresAt'))
  if (expiresAt && 'error' in expiresAt) return fieldError({ expiresAt: expiresAt.error })

  const uses = String(formData.get('maxUses') ?? '').trim()
  const maxUses = uses ? Number(uses) : null
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
    return fieldError({ maxUses: 'A whole number of uses, or leave it empty for unlimited.' })
  }

  const result = await addPromoCode(actor, facilityId, {
    promotionId: String(formData.get('promotionId') ?? ''),
    code: String(formData.get('code') ?? ''),
    maxUses,
    expiresAt: (expiresAt as Date | null) ?? null,
  })
  if (!result.ok) return fieldError({ [result.field]: result.problem })

  revalidatePath('/admin/settings/promotions')
  return success('Code added.')
}
