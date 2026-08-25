'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import { checkFreshAuth } from '@/lib/auth/reauth'
import { cancelTransferRequest, requestTransfer, PORTAL_TRANSFER_PROBLEM_COPY } from '@/lib/portal/transfer'
import { fieldError, stalePreview, success, type FormState } from '@/lib/admin/form-state'
import { formatDay } from '@/lib/format'

// PRD 01 §9 (B-090 part 2), gated by US-701's re-auth rule. A transfer request
// does not move money on its own, but it changes which unit a lease is for and
// takes a unit off the board — the same class of thing as the move-out request
// US-701 names explicitly.
//
// Split from lib/portal/transfer.ts for the reason B-036 established: anything
// touching `@/auth` (as `checkFreshAuth`/`requireTenantActor` both do) cannot
// be imported under Vitest, so the decision logic stays in the lib file and
// only this session-shaped wrapper is untestable there.

async function requireFresh(returnTo: string): Promise<void> {
  const fresh = await checkFreshAuth()
  if (fresh.fresh) return
  redirect(`/reauth?redirect=${encodeURIComponent(returnTo)}`)
}

export async function requestTransferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const leaseId = String(formData.get('leaseId') ?? '')
  const toUnitId = String(formData.get('unit') ?? '')
  const transferDate = String(formData.get('date') ?? '')

  // B-173. Both controls, and before the re-auth redirect — a tenant sent
  // through a password prompt only to be told the unit had moved has been made
  // to pay for the refusal twice. See `stalePreview`.
  const stale =
    stalePreview(
      formData,
      'unit',
      () => 'You changed which unit you want. Press "Show me what it costs" to price that one.',
    ) ??
    stalePreview(
      formData,
      'date',
      (typed) =>
        `You changed the date. Press "Show me what it costs" to see what a ${formatDay(typed)} move costs.`,
    )
  if (stale) return stale

  await requireFresh(`/portal/transfer?lease=${leaseId}&unit=${toUnitId}&date=${transferDate}`)

  const result = await requestTransfer(
    actor.tenantId,
    leaseId,
    toUnitId,
    new Date(`${transferDate}T00:00:00.000Z`),
  )
  if (!result.ok) {
    return fieldError({
      unit: PORTAL_TRANSFER_PROBLEM_COPY[result.problem] ?? 'That request could not be completed.',
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
