'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { MoveOutReason } from '@storage/db'
import { requireStaffActor } from '@/lib/rbac/session'
import { completeMoveOut, recordNoticeGiven } from '@/lib/admin/move-out'
import { fieldError, parseScaled, stalePreview, type FormState } from '@/lib/admin/form-state'
import { formatCents, formatDay } from '@/lib/format'

// PRD 02 US-14. Thin session wrapper; lib/admin/move-out.ts holds the rules.

const PROBLEM_COPY: Record<string, string> = {
  not_occupying: 'That lease has already ended.',
  needs_manager: 'This lease owes more than the write-off threshold — a manager has to close it.',
  reason_code_required: 'Choose a reason for the write-off.',
  recapture_reason_required: 'Say why the promotional recapture is being reduced.',
}

export async function completeMoveOutAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')

  // B-173. Before anything else, and before any of it is charged: the date on
  // screen is the date that posts, or nothing posts. See `stalePreview`.
  const stale = stalePreview(
    formData,
    'date',
    (typed) =>
      `You changed the date. Press Recalculate to see what a ${formatDay(typed)} move-out settles to.`,
  )
  if (stale) return stale

  // B-168. Blank means "charge what the rule says" — an untouched field must
  // not read as a waiver down to zero.
  const rawRecapture = String(formData.get('recaptureChargeDollars') ?? '').trim()
  let recaptureChargeCents: number | undefined
  if (rawRecapture !== '') {
    const parsed = parseScaled(rawRecapture, { scale: 100, min: 0, max: 100_000, unit: 'dollars' })
    if ('error' in parsed) return fieldError({ recaptureChargeDollars: parsed.error })
    recaptureChargeCents = parsed.value
  }

  const result = await completeMoveOut(actor, {
    leaseId: String(formData.get('leaseId') ?? ''),
    recaptureChargeCents,
    recaptureReasonCode: String(formData.get('recaptureReason') ?? ''),
    // Parsed as a UTC calendar date, matching how `Lease.moveOutDate` is
    // stored (@db.Date) — a move-out is a day, not an instant.
    moveOutDate: new Date(`${String(formData.get('date') ?? '')}T00:00:00.000Z`),
    reason: String(formData.get('reason') ?? 'tenant_request') as MoveOutReason,
    writeOff: formData.get('writeOff') === 'yes',
    reasonCode: String(formData.get('reasonCode') ?? ''),
  })

  if (!result.ok) {
    // The recapture refusals belong on the recapture field, not on the reason
    // select at the top of the form: the control the reader has to change is
    // the figure they typed, and a message parked three fields away is a
    // message somebody re-submits without reading.
    if (result.problem === 'recapture_reason_required') {
      return fieldError({ recaptureReason: PROBLEM_COPY.recapture_reason_required! })
    }
    if (result.problem === 'recapture_forbidden') {
      return fieldError({
        recaptureChargeDollars: `Reducing it forgives ${formatCents(result.forgivenCents ?? 0)}, and you have no fee-waiver authority. Charge the full amount, or ask a manager.`,
      })
    }
    if (result.problem === 'recapture_over_limit') {
      return fieldError({
        recaptureChargeDollars: `Reducing it forgives ${formatCents(result.forgivenCents ?? 0)}, more than your ${formatCents(result.limitCents ?? 0)} limit.${result.escalateTo ? ` A ${result.escalateTo} can carry it.` : ''}`,
      })
    }
    return fieldError({ reason: PROBLEM_COPY[result.problem] ?? 'That move-out could not be completed.' })
  }

  revalidatePath(`/admin/tenants/${tenantId}`)
  revalidatePath('/admin/units')
  redirect(`/admin/tenants/${tenantId}?movedOut=1`)
}

// B-186. Off-platform notice, recorded right where the shortfall shows so
// staff don't have to leave this screen to fix a figure it just told them
// was wrong. Redirects back to the same preview so it recomputes.
export async function setNoticeGivenOnMoveOutAction(formData: FormData): Promise<void> {
  const actor = await requireStaffActor()
  const tenantId = String(formData.get('tenantId') ?? '')
  const leaseId = String(formData.get('leaseId') ?? '')
  const date = String(formData.get('date') ?? '')
  const raw = String(formData.get('noticeGivenAt') ?? '').trim()

  await recordNoticeGiven(actor, leaseId, raw ? new Date(`${raw}T00:00:00.000Z`) : null)

  const qs = new URLSearchParams({ lease: leaseId })
  if (date) qs.set('date', date)
  redirect(`/admin/tenants/${tenantId}/move-out?${qs.toString()}`)
}
