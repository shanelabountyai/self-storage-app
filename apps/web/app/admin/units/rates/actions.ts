'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { parseScaled } from '@/lib/admin/form-state'
import { publishUnitTypeRate } from '@/lib/pricing/unit-type-rates'

// PRD 02 US-12's "one-click apply" (B-088 part 1).
//
// A thin wrapper over `publishUnitTypeRate` and deliberately nothing more: the
// permission (`rates:street:change`), the audit entry, the effective-dating and
// the guarantee that no existing lease is touched all live there already, and a
// second write path would be a second place for those to be got wrong.
export async function applySuggestedRateAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()

  const facilityId = String(formData.get('facilityId') ?? '')
  const unitTypeId = String(formData.get('unitTypeId') ?? '')
  const unitTypeName = String(formData.get('unitTypeName') ?? 'this type')

  // Pre-filled with the suggestion but EDITABLE, which is what keeps "one
  // click" honest: the operator is applying a price, not accepting a machine's
  // arithmetic they cannot alter. Same parser every other money field uses, so
  // a fat-fingered "825" is refused here rather than becoming an $825 rate.
  const street = parseScaled(formData.get('streetRateDollars'), {
    scale: 100,
    min: 1,
    max: 10_000,
    unit: 'dollars',
  })
  if ('error' in street) return fieldError({ streetRateDollars: street.error })

  const web = parseScaled(formData.get('webRateDollars'), {
    scale: 100,
    min: 1,
    max: 10_000,
    unit: 'dollars',
  })
  if ('error' in web) return fieldError({ webRateDollars: web.error })

  await publishUnitTypeRate(actor, facilityId, unitTypeId, {
    streetRateCents: street.value,
    webRateCents: web.value,
    // Effective now. A street rate is what the next quote uses, so there is
    // nothing to give notice of — unlike a TENANT increase, which has a
    // statutory notice period and its own screen (US-11, /admin/rate-increases).
    effectiveFrom: new Date(),
  })

  revalidatePath('/admin/units/rates')
  revalidatePath('/admin/units/types')
  return success(`${unitTypeName} street rate is now $${(street.value / 100).toFixed(2)}.`)
}
