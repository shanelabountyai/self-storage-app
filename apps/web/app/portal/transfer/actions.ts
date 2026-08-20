'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import { checkFreshAuth } from '@/lib/auth/reauth'
import { cancelTransferRequest, requestTransfer } from '@/lib/portal/transfer'
import { TRANSFER_PROBLEM_COPY } from '@/lib/admin/transfer'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 01 §9 (B-090 part 2), gated by US-701's re-auth rule. A transfer request
// does not move money on its own, but it changes which unit a lease is for and
// takes a unit off the board — the same class of thing as the move-out request
// US-701 names explicitly.
//
// Split from lib/portal/transfer.ts for the reason B-036 established: anything
// touching `@/auth` (as `checkFreshAuth`/`requireTenantActor` both do) cannot
// be imported under Vitest, so the decision logic stays in the lib file and
// only this session-shaped wrapper is untestable there.

const REQUEST_PROBLEM_COPY: Record<string, string> = {
  ...TRANSFER_PROBLEM_COPY,
  not_found: 'We couldn’t find that unit on your account.',
  date_in_past: 'Pick today or a later date.',
  already_requested: 'You’ve already asked to move to another unit at this site. Cancel that first.',
}

async function requireFresh(returnTo: string): Promise<void> {
  const fresh = await checkFreshAuth()
  if (fresh.fresh) return
  redirect(`/reauth?redirect=${encodeURIComponent(returnTo)}`)
}

export async function requestTransferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const leaseId = String(formData.get('leaseId') ?? '')
  const toUnitId = String(formData.get('toUnitId') ?? '')
  const transferDate = String(formData.get('transferDate') ?? '')

  await requireFresh(`/portal/transfer?lease=${leaseId}&unit=${toUnitId}&date=${transferDate}`)

  const result = await requestTransfer(
    actor.tenantId,
    leaseId,
    toUnitId,
    new Date(`${transferDate}T00:00:00.000Z`),
  )
  if (!result.ok) {
    return fieldError({
      toUnitId: REQUEST_PROBLEM_COPY[result.problem] ?? 'That request could not be completed.',
    })
  }

  revalidatePath('/portal/transfer')
  revalidatePath('/portal')
  return success('Transfer requested. We’ve held that unit and the team will call you to arrange it.')
}

export async function cancelTransferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const leaseId = String(formData.get('leaseId') ?? '')

  await requireFresh(`/portal/transfer?lease=${leaseId}`)

  const result = await cancelTransferRequest(actor.tenantId, leaseId)
  if (!result.ok) {
    return fieldError({
      leaseId:
        result.reason === 'nothing_to_cancel'
          ? 'There’s no transfer request to cancel.'
          : 'We couldn’t find that unit on your account.',
    })
  }

  revalidatePath('/portal/transfer')
  revalidatePath('/portal')
  return success('Transfer request cancelled. That unit is back on the board.')
}
