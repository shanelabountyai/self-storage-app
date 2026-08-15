'use server'

import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import {
  NOTIFICATION_CATEGORIES,
  revokeSmsFromPortal,
  setMarketingSmsConsent,
  setPreference,
} from '@/lib/portal/notifications'
import { MARKETING_SMS_DISCLOSURE_VERSION } from '@/lib/checkout/details'
import { success, type FormState } from '@/lib/admin/form-state'

// PRD 05 CN-13 (B-074). Thin session wrapper, same shape as
// `portal/contact/actions.ts` — every decision lives in
// `lib/portal/notifications.ts`.

/// One save for the whole grid, same pattern the admin settings forms use
/// (billing policy, operations policy) — six independent checkboxes saved
/// together rather than six separate round trips.
export async function setPreferencesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()

  for (const { key: category } of NOTIFICATION_CATEGORIES) {
    for (const channel of ['email', 'sms'] as const) {
      const enabled = formData.get(`${category}:${channel}`) === 'yes'
      await setPreference(actor.tenantId, category, channel, enabled)
    }
  }

  revalidatePath('/portal/notifications')
  return success('Saved.')
}

export async function revokeSmsAction(_prev: FormState, _formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const result = await revokeSmsFromPortal(actor.tenantId)

  revalidatePath('/portal/notifications')
  return success(
    result.revoked
      ? 'Texts are off. This has the same effect as replying STOP — you will not get any more SMS from us at this number.'
      : 'There is no phone number on file to turn texts off for.',
  )
}

/// D-51 (B-123). The tenant's own switch for MARKETING texts.
///
/// Its own action, not a branch of `revokeSmsAction`: that one is CN-13's
/// "same effect as STOP" and suppresses every SMS to the number, gate codes
/// included. Turning promotions off must not cost somebody their payment
/// reminders, so this writes consent and touches the suppression list not at
/// all.
export async function setMarketingSmsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTenantActor()
  const granted = formData.get('marketingSms') === 'yes'

  await setMarketingSmsConsent(actor.tenantId, granted, MARKETING_SMS_DISCLOSURE_VERSION)

  revalidatePath('/portal/notifications')
  return {
    status: 'success',
    message: granted
      ? 'Marketing texts are on. Account and payment texts are unaffected either way.'
      : 'Marketing texts are off. You will still get account and payment texts.',
  }
}
