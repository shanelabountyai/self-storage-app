'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import { checkFreshAuth } from '@/lib/auth/reauth'
import {
  cancelMoveOutRequest,
  PORTAL_MOVE_OUT_PROBLEM_KEYS,
  requestMoveOut,
} from '@/lib/portal/move-out'
import { fieldError, stalePreview, success, type FormState } from '@/lib/admin/form-state'
import { formatDay } from '@/lib/format'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { MAX_MOVE_OUT_DAYS_AHEAD } from '@/lib/portal/move-out'

// PRD 01 US-707, gated by US-701's re-auth rule — US-701's own examples of a
// "sensitive action" name move-out explicitly. Split from
// lib/portal/move-out.ts for the reason established in B-036: anything
// touching `@/auth` (as `checkFreshAuth`/`requireTenantActor` both do)
// cannot be imported under Vitest, so the decision logic stays in the lib
// file and only this session-shaped wrapper is untestable there.

// B-174. One copy map for this screen, shared with the preview that renders it
// beside the picker. The four refusals here were a near-duplicate of the ones
// the lib now owns — and a refusal worded one way when the preview says it and
// another when the submit does is two answers to one question.
//
// B-164 / D-85 (`lien_pipeline`): the screen never renders the control, so
// reaching this means a post that skipped it — and the answer is still the true
// one rather than "that request could not be completed", which tells a tenant
// nothing and sends them to the phone anyway, angrier.
// B-260 (D-122): keys, resolved per request against the tenant's dictionary.
const REQUEST_PROBLEM_KEYS: Record<string, MessageKey> = {
  ...PORTAL_MOVE_OUT_PROBLEM_KEYS,
  already_requested: 'mo.problem.already_requested',
}

const CANCEL_PROBLEM_KEYS: Record<string, MessageKey> = {
  not_found: 'mo.problem.not_found',
  nothing_to_cancel: 'mo.problem.nothing_to_cancel',
  too_late: 'mo.problem.too_late',
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
    const dict = dictionaryFor(await getLocale())
    return fieldError({
      date: translate(dict, REQUEST_PROBLEM_KEYS[result.reason] ?? 'mo.problem.generic', {
        days: MAX_MOVE_OUT_DAYS_AHEAD,
      }),
    })
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
    const dict = dictionaryFor(await getLocale())
    return fieldError({
      leaseId: translate(dict, CANCEL_PROBLEM_KEYS[result.reason] ?? 'mo.problem.generic'),
    })
  }

  revalidatePath('/portal/move-out')
  revalidatePath('/portal')
  return success('Move-out cancelled.')
}
