'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { completeTransfer, TRANSFER_PROBLEM_COPY, type TransferProblem } from '@/lib/admin/transfer'
import { fieldError, stalePreview, type FormState } from '@/lib/admin/form-state'
import { formatDay } from '@/lib/format'

// PRD 02 US-14 (B-077). Thin session wrapper; lib/admin/transfer.ts holds
// every rule and re-runs the preview so the confirmed figure is the posted one.

export async function completeTransferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')

  // B-173. The three controls that price this settlement are fields of this
  // form now, so what posts is what is on screen — and while any of them has
  // moved since the figures above were worked out, nothing posts at all. All
  // three, not just the date: switching the unit or retyping the rent after a
  // preview committed the previewed one just as silently. See `stalePreview`.
  const stale =
    stalePreview(formData, 'unit', () => 'You changed the unit. Press Recalculate to see what that swap settles to.') ??
    stalePreview(
      formData,
      'date',
      (typed) =>
        `You changed the date. Press Recalculate to see what a ${formatDay(typed)} transfer settles to.`,
    ) ??
    stalePreview(formData, 'rate', () => 'You changed the rent. Press Recalculate to see what it settles to.')
  if (stale) return stale

  const result = await completeTransfer(actor, {
    leaseId: String(formData.get('leaseId') ?? ''),
    toUnitId: String(formData.get('unit') ?? ''),
    // A UTC calendar date, matching how the lease's own dates are stored —
    // a transfer happens on a day, not at an instant.
    transferDate: new Date(`${String(formData.get('date') ?? '')}T00:00:00.000Z`),
    // Only read when the lease is in the lien pipeline (B-157/D-85); an
    // ordinary transfer never renders these and stays reason-free.
    reasonCode: String(formData.get('reasonCode') ?? ''),
    reasonNote: String(formData.get('reasonNote') ?? ''),
    // B-162 / D-93. Present only when staff moved off the policy figure on the
    // preview; the commit re-runs the preview with it, so what was confirmed is
    // what posts.
    rateOverrideCents: formData.has('rateOverrideCents')
      ? Number(formData.get('rateOverrideCents'))
      : null,
  })

  if (!result.ok) {
    // The lien-pipeline refusals are about the reason field, not the unit —
    // pointing them at `toUnitId` would put the error message above a control
    // that is already correct.
    const field =
      result.problem === 'lien_transfer_needs_reason' || result.problem === 'lien_transfer_needs_manager'
        ? 'reasonCode'
        : 'unit'
    return fieldError({ [field]: TRANSFER_PROBLEM_COPY[result.problem as TransferProblem] })
  }

  revalidatePath(`/admin/tenants/${tenantId}`)
  revalidatePath('/admin/units')
  redirect(`/admin/tenants/${tenantId}?transferred=1`)
}
