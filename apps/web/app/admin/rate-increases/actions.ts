'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import {
  approveBatch,
  approveRateIncrease,
  cancelBatch,
  cancelRateIncrease,
  scheduleEligibleBatch,
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
