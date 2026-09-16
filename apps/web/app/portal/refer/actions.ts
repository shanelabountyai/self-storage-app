'use server'

import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import { mintInvite } from '@/lib/referrals/service'
import { success, type FormState } from '@/lib/admin/form-state'
import { messages } from '@/lib/i18n/server'

// PRD 10 §5.1 (B-100). Minting IS the act of sharing.
//
// "The friction cost is nil, because the code is minted by the act of sharing"
// — there is no separate "generate a code" step, because a single-use code with
// a generate button is a two-step flow wearing one button, and the whole reason
// single-use is affordable is that it costs the tenant nothing.

export async function mintInviteAction(_prev: FormState, _formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const result = await mintInvite(actor.tenantId)
  const { t } = await messages()

  revalidatePath('/portal/refer')

  if (result.ok) return success(t('refer.inviteReady', { code: result.code }))

  // §5.1's AC: "a tenant with no active lease sees why they cannot refer, not a
  // broken link." Each reason says what it is and, where there is one, what to
  // do about it — the same standard the referral refusals are held to.
  //
  // `no_active_lease` reuses `refer.noLease` rather than minting a second key
  // for the identical sentence the page itself renders in that state.
  const reasons = {
    no_active_lease: t('refer.noLease'),
    program_disabled: t('refer.problem.programDisabled'),
    open_invite_cap: t('refer.problem.openInviteCap'),
  } as const

  return { status: 'error', message: reasons[result.reason], fieldErrors: {} }
}
