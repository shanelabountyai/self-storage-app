'use server'

import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import { mintInvite } from '@/lib/referrals/service'
import { success, type FormState } from '@/lib/admin/form-state'

// PRD 10 §5.1 (B-100). Minting IS the act of sharing.
//
// "The friction cost is nil, because the code is minted by the act of sharing"
// — there is no separate "generate a code" step, because a single-use code with
// a generate button is a two-step flow wearing one button, and the whole reason
// single-use is affordable is that it costs the tenant nothing.

export async function mintInviteAction(_prev: FormState, _formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const result = await mintInvite(actor.tenantId)

  revalidatePath('/portal/refer')

  if (result.ok) return success(`New invite ready: ${result.code}. Share it with one friend.`)

  // §5.1's AC: "a tenant with no active lease sees why they cannot refer, not a
  // broken link." Each reason says what it is and, where there is one, what to
  // do about it — the same standard the referral refusals are held to.
  const reasons = {
    no_active_lease:
      'Referrals are for current tenants, and there is no active lease on your account right now.',
    program_disabled: 'The referral program is not running at your location at the moment.',
    open_invite_cap:
      'You have reached the number of unused invites you can hold at once. One of them being used, or expiring, frees up another.',
  } as const

  return { status: 'error', message: reasons[result.reason], fieldErrors: {} }
}
