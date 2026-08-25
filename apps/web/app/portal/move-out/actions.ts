'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import { checkFreshAuth } from '@/lib/auth/reauth'
import { cancelMoveOutRequest, requestMoveOut } from '@/lib/portal/move-out'
import { fieldError, stalePreview, success, type FormState } from '@/lib/admin/form-state'
import { formatDay } from '@/lib/format'

// PRD 01 US-707, gated by US-701's re-auth rule — US-701's own examples of a
// "sensitive action" name move-out explicitly. Split from
// lib/portal/move-out.ts for the reason established in B-036: anything
// touching `@/auth` (as `checkFreshAuth`/`requireTenantActor` both do)
// cannot be imported under Vitest, so the decision logic stays in the lib
// file and only this session-shaped wrapper is untestable there.

const REQUEST_PROBLEM_COPY: Record<string, string> = {
  not_found: 'We couldn’t find that unit on your account.',
  date_too_soon: 'That date is before the notice this unit requires. Pick a later date.',
  already_requested: 'A move-out is already scheduled for this unit.',
  // B-164 / D-85. The screen never renders the control, so reaching this means
  // a post that skipped it — and the answer is still the true one rather than
  // "that request could not be completed", which tells a tenant nothing and
  // sends them to the phone anyway, angrier.
  lien_pipeline:
    'This unit is in the lien process, so a move-out has to be arranged with the office rather than online. Please ring them.',
}

const CANCEL_PROBLEM_COPY: Record<string, string> = {
  not_found: 'We couldn’t find that unit on your account.',
  nothing_to_cancel: 'There’s no move-out scheduled to cancel.',
  too_late: 'That move-out date has already arrived — call us to change anything now.',
}

async function requireFresh(returnTo: string): Promise<void> {
  const fresh = await checkFreshAuth()
  if (fresh.fresh) return
  redirect(`/reauth?redirect=${encodeURIComponent(returnTo)}`)
}

export async function requestMoveOutAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const leaseId = String(formData.get('leaseId') ?? '')
  const moveOutDate = String(formData.get('date') ?? '')

  // B-173. Checked before the re-auth redirect, so a tenant is not sent through
  // a password prompt only to be told the date had moved. See `stalePreview`.
  const stale = stalePreview(
    formData,
    'date',
    (typed) => `You changed the date. Press Update to see what a ${formatDay(typed)} move-out settles to.`,
  )
  if (stale) return stale

  await requireFresh(`/portal/move-out?lease=${leaseId}`)

  const result = await requestMoveOut(actor.tenantId, leaseId, new Date(`${moveOutDate}T00:00:00.000Z`))
  if (!result.ok) {
    return fieldError({ date: REQUEST_PROBLEM_COPY[result.reason] ?? 'That request could not be completed.' })
  }

  revalidatePath('/portal/move-out')
  revalidatePath('/portal')
  return success('Move-out requested. We’ve emailed you a confirmation.')
}

export async function cancelMoveOutAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const leaseId = String(formData.get('leaseId') ?? '')

  await requireFresh(`/portal/move-out?lease=${leaseId}`)

  const result = await cancelMoveOutRequest(actor.tenantId, leaseId)
  if (!result.ok) {
    return fieldError({ leaseId: CANCEL_PROBLEM_COPY[result.reason] ?? 'That could not be cancelled.' })
  }

  revalidatePath('/portal/move-out')
  revalidatePath('/portal')
  return success('Move-out cancelled.')
}
