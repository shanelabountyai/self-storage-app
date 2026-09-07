'use server'

import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import {
  NOTIFICATION_CATEGORIES,
  revokeSmsFromPortal,
  setMarketingSmsConsent,
  setPreference,
  setWritingLocale,
} from '@/lib/portal/notifications'
import { MARKETING_SMS_CONSENT } from '@/lib/consent/disclosures'
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_DAYS, dictionaryFor, translate } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { cookies } from 'next/headers'
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

  // B-259. The language the disclosure was RENDERED in, from the form rather
  // than the cookie — a tenant who switches language between reading the page
  // and pressing the button would otherwise have a version recorded against
  // words that were never on screen. Untrusted input, so narrowed by
  // `isLocale` with the cookie as the fallback.
  const claimed = formData.get('disclosureLocale')
  const locale = isLocale(claimed) ? claimed : await getLocale()

  await setMarketingSmsConsent(
    actor.tenantId,
    granted,
    MARKETING_SMS_CONSENT[locale].version,
    locale,
  )

  revalidatePath('/portal/notifications')
  return {
    status: 'success',
    message: granted
      ? 'Marketing texts are on. Account and payment texts are unaffected either way.'
      : 'Marketing texts are off. You will still get account and payment texts.',
  }
}

/// B-261 (D-122). The tenant's control over the language we WRITE to them in.
///
/// It sets two things, and that is the point rather than an accident:
///
///   1. `Tenant.preferredLocale` — durable, read by `deliverForRule` for every
///      email and text from here on, including the dunning ladder.
///   2. The `st_locale` cookie — this browser's display language.
///
/// Setting only the first would leave a tenant who just asked for Spanish
/// looking at an English confirmation of it, which reads as the control having
/// failed. Setting only the second is what the header toggle already does, and
/// is exactly the gap this item exists to close: a cookie is one device and is
/// gone with the cache.
///
/// The success line is rendered in the language just chosen, not the one the
/// page was rendered in — it is the first sentence of the change taking
/// effect.
export async function setWritingLocaleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTenantActor()

  // Untrusted input from a select, narrowed the same way `shownLocale` does in
  // checkout. An unrecognised value is dropped rather than stored: a locale
  // column holding something `isLocale` refuses would silently fall back to
  // English on every send, which is the bug this item is fixing.
  const requested = formData.get('writingLocale')
  if (!isLocale(requested)) return { status: 'error', message: 'Unrecognised language.', fieldErrors: {} }

  await setWritingLocale(actor.tenantId, requested)
  ;(await cookies()).set(LOCALE_COOKIE, requested, {
    path: '/',
    maxAge: LOCALE_COOKIE_DAYS * 24 * 60 * 60,
    sameSite: 'lax',
    httpOnly: false,
  })

  // The whole layout tree carries the language, not just this route — the same
  // reason `setLocaleAction` revalidates the layout rather than the page.
  revalidatePath('/', 'layout')
  return success(translate(dictionaryFor(requested), 'notif.languageSaved'))
}
