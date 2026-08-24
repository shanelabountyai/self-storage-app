'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import {
  approveBatch,
  approveRateIncrease,
  cancelBatch,
  cancelRateIncrease,
  renoticeHeldIncreases,
  renoticeRateIncrease,
  scheduleEligibleBatch,
  scheduleRateDecrease,
  scheduleRateIncrease,
} from '@/lib/pricing/tenant-rate-increases'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 02 US-11 (B-076). Thin session wrapper; every rule lives in
// `lib/pricing/tenant-rate-increases.ts`.

function revalidate(): void {
  revalidatePath('/admin/rate-increases')
}

/// Date-only input, read as UTC midnight — an effective date is "the 1st",
/// and parsing it in the server's local zone would shift it a day for half
/// the world. Same treatment the auction schedule form uses.
function dateFrom(value: FormDataEntryValue | null): Date | null {
  const raw = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const parsed = new Date(`${raw}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function dollarsToCents(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null
  return Math.round(Number(raw) * 100)
}

export async function scheduleOneOffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '').trim()

  const newRateCents = dollarsToCents(formData.get('newRateDollars'))
  if (newRateCents === null) return fieldError({ newRateDollars: 'Enter the new monthly rate, like 149.00.' })

  const effectiveDate = dateFrom(formData.get('effectiveDate'))
  if (!effectiveDate) return fieldError({ effectiveDate: 'Pick the date the new rate starts.' })

  if (!leaseId) return fieldError({ leaseId: 'Enter the lease this increase is for.' })

  const result = await scheduleRateIncrease(actor, facilityId, { leaseId, newRateCents, effectiveDate })
  if (!result.ok) return fieldError({ effectiveDate: result.reason })

  revalidate()
  return success('Scheduled. It needs a regional or owner approval before the notice goes out.')
}

export async function scheduleBatchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const effectiveDate = dateFrom(formData.get('effectiveDate'))
  if (!effectiveDate) return fieldError({ effectiveDate: 'Pick the date the new rates start.' })

  const result = await scheduleEligibleBatch(actor, facilityId, effectiveDate)
  if (!result.ok) return fieldError({ effectiveDate: result.reason })

  revalidate()
  return success(
    `Scheduled ${result.scheduled} increase${result.scheduled === 1 ? '' : 's'}. They need approval before any notice goes out.`,
  )
}

export async function approveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const reason = String(formData.get('reason') ?? '')
  const batchId = String(formData.get('batchId') ?? '').trim()

  if (batchId) {
    if (!reason.trim()) return fieldError({ reason: 'An approval has to record why.' })
    const { approved } = await approveBatch(actor, batchId, reason)
    revalidate()
    return success(`Approved ${approved} increase${approved === 1 ? '' : 's'}.`)
  }

  const result = await approveRateIncrease(actor, String(formData.get('id') ?? ''), reason)
  if (!result.ok) return fieldError({ reason: result.reason })
  revalidate()
  return success('Approved. The notice goes out on its notice date.')
}

export async function cancelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const reason = String(formData.get('reason') ?? '')
  const batchId = String(formData.get('batchId') ?? '').trim()

  if (batchId) {
    if (!reason.trim()) return fieldError({ reason: 'A cancellation has to record why.' })
    const { cancelled } = await cancelBatch(actor, batchId, reason)
    revalidate()
    return success(`Cancelled ${cancelled} increase${cancelled === 1 ? '' : 's'}.`)
  }

  const result = await cancelRateIncrease(actor, String(formData.get('id') ?? ''), reason)
  if (!result.ok) return fieldError({ reason: result.reason })
  revalidate()
  return success('Cancelled. Nothing will change on this lease.')
}

/// PRD 02 §4.3 US-11, D-88 (B-166). The way back from a held increase — one
/// row, or every held row at the facility.
///
/// One action for both, like `approveAction` and `cancelAction`: the batch is
/// the same operation repeated, and splitting it would give the two paths two
/// places to drift on what a refusal reads like.
export async function renoticeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const reason = String(formData.get('reason') ?? '')
  const facilityId = String(formData.get('facilityId') ?? '').trim()

  if (facilityId) {
    if (!reason.trim()) return fieldError({ reason: 'A re-notice has to record why.' })
    const { renoticed, refused } = await renoticeHeldIncreases(actor, facilityId, reason)
    revalidate()
    if (refused.length === 0) {
      return success(
        `Re-noticed ${renoticed} increase${renoticed === 1 ? '' : 's'}. Each notice goes out on its new notice date.`,
      )
    }
    // The refusals are the point of the batch reporting at all: they are the
    // rows whose address is still the one that bounced, and a bare count would
    // leave them looking done.
    return success(
      `Re-noticed ${renoticed} of ${renoticed + refused.length}. ${refused.length} still need${refused.length === 1 ? 's' : ''} attention.`,
      refused.map((row) => `${row.tenantName} (unit ${row.unitNumber}) — ${row.reason}`),
    )
  }

  const result = await renoticeRateIncrease(actor, String(formData.get('id') ?? ''), reason)
  if (!result.ok) return fieldError({ reason: result.reason })
  revalidate()
  return success('Re-noticed. The notice goes out on its new notice date, and the increase applies after it.')
}

/// PRD 02 §4.3 US-11 (B-153). The retention save. Separate from
/// `scheduleOneOffAction` rather than a direction flag on it: the two take
/// different fields (this one requires a reason, that one requires a notice
/// period), refuse for different reasons, and succeed with different next
/// steps — one waits for a regional approval, this one is already approved.
export async function scheduleDecreaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '').trim()

  const newRateCents = dollarsToCents(formData.get('newRateDollars'))
  if (newRateCents === null) return fieldError({ newRateDollars: 'Enter the new monthly rate, like 119.00.' })

  const effectiveDate = dateFrom(formData.get('effectiveDate'))
  if (!effectiveDate) return fieldError({ effectiveDate: 'Pick the date the lower rate starts.' })

  if (!leaseId) return fieldError({ leaseId: 'Enter the lease this is for.' })

  const reasonCode = String(formData.get('reason') ?? '')
  if (!reasonCode.trim()) return fieldError({ reason: 'Record why the rate is coming down.' })

  const result = await scheduleRateDecrease(actor, facilityId, {
    leaseId,
    newRateCents,
    effectiveDate,
    reasonCode,
  })
  // An over-limit refusal is about the AMOUNT, so it belongs on the rate
  // field — putting every refusal on the date would hide the one message
  // that tells the manager what to change.
  if (!result.ok) {
    return 'overLimit' in result
      ? fieldError({ newRateDollars: result.reason })
      : fieldError({ effectiveDate: result.reason })
  }

  revalidate()
  return success('Done. The lower rate applies on its effective date — no notice period, no further approval.')
}
