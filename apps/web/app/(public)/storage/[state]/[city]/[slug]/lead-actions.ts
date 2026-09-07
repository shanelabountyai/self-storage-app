'use server'

import { cookies, headers } from 'next/headers'
import {
  decodeTouch,
  FIRST_TOUCH_COOKIE,
  REFERRAL_COOKIE,
  LAST_TOUCH_COOKIE,
} from '@storage/core/marketing'
import { captureLead } from '@/lib/marketing/lead-capture'
import { keyedFieldError, parseDate, success, type FormState } from '@/lib/admin/form-state'
import { isLocale, type Locale } from '@/lib/i18n'
import { getLocale, messages } from '@/lib/i18n/server'
import { track } from '@/lib/analytics/track'
import { trackingContext } from '@/lib/analytics/request'

// PRD 04 US-8 (B-068). The quote/callback form's server action.
//
// US-8 AC3's hidden fields are read from the REQUEST, never from the form:
// facility id is the only one the client supplies, and everything else —
// referrer, UTMs, gclid, first/last touch — comes from headers and cookies. A
// hidden input carrying its own attribution is one a bot can set to anything,
// and the whole point of these numbers is deciding where to spend money.
//
// B-264 (D-122, D-125). Everything this action says back is translated, and
// the consent it records is stamped with the language whose words were on
// screen. The one exception is the attribution above, which is not copy.

/// B-259's rule, on this form's disclosure. The page is a server render and
/// the cookie is read again at submit time, so a visitor who used the header
/// language toggle in between would otherwise have `es` recorded against the
/// English sentence they actually ticked. Untrusted input, narrowed by
/// `isLocale`, with the cookie as the fallback.
async function shownLocale(formData: FormData): Promise<Locale> {
  const claimed = formData.get('disclosureLocale')
  return isLocale(claimed) ? claimed : await getLocale()
}

export async function submitLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await messages()
  const headerList = await headers()
  const cookieStore = await cookies()

  const rawDate = formData.get('moveInDate')
  let moveInDate: Date | null = null
  if (rawDate && String(rawDate).trim()) {
    const parsed = parseDate(rawDate)
    // Not a hard refusal: a date somebody mistyped should not lose the lead.
    if (!('error' in parsed)) moveInDate = parsed.value
  }

  const result = await captureLead(
    {
      facilityId: String(formData.get('facilityId') ?? ''),
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      unitTypeId: String(formData.get('unitTypeId') ?? '') || null,
      moveInDate,
      note: String(formData.get('note') ?? ''),
      kind: formData.get('kind') === 'callback' ? 'callback' : 'quote',
      honeypot: String(formData.get('company') ?? ''),
      marketingConsent: formData.get('marketingConsent') === 'yes',
      consentLocale: await shownLocale(formData),
    },
    {
      firstTouch: decodeTouch(cookieStore.get(FIRST_TOUCH_COOKIE)?.value),
      lastTouch: decodeTouch(cookieStore.get(LAST_TOUCH_COOKIE)?.value),
      // PRD 10 FR-REF-3 (B-100). Its own cookie, so a later ad click cannot
      // overwrite the tenant's claim.
      referralInviteId: cookieStore.get(REFERRAL_COOKIE)?.value ?? null,
      landingPage: headerList.get('referer'),
      referrer: headerList.get('referer'),
      gclid: null,
      selfHost: headerList.get('host'),
      // Vercel and most proxies put the client address first in this list.
      // `x-real-ip` is the fallback; neither is trustworthy against a
      // determined attacker, which is why the limit is a brake and not a gate.
      ip:
        headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        headerList.get('x-real-ip'),
    },
  )

  if (!result.ok) {
    // A bot gets the same answer a person does — `field: 'silent'`, and no
    // message, which is what the null is. Telling it the honeypot fired is how
    // it learns to try again without filling that field.
    if (!result.problem) return success(t('lead.thanks'))
    // B-263's shape: the keys came back from `captureLead`, and this is the
    // only layer that knows whose request it is. The summary heading above the
    // field list is translated with them — that sentence is what B-263 found
    // still English after every validator had been fixed.
    return keyedFieldError({ [result.field]: result.problem }, t)
  }

  // US-15 AC2's `quote_form_submit` / `callback_request`. Fired on success
  // only: a rejected submission is not a lead, and counting it would make the
  // funnel's second step wider than the number of leads that exist.
  const context = await trackingContext()
  if (context.sessionId) {
    await track({
      event: formData.get('kind') === 'callback' ? 'callback_request' : 'quote_form_submit',
      facilityId: String(formData.get('facilityId') ?? ''),
      ...context,
      sessionId: context.sessionId,
      properties: { deduplicated: result.deduplicated },
    })
  }

  return success(t('lead.thanks'))
}

/// PRD 04 US-15 AC2's `page_view`, fired from the server.
///
/// A server action rather than a client effect, because FR-AN-2 makes the
/// server log the source of truth and a client-side page view is the single
/// event an ad blocker is most certain to remove.
export async function trackPageView(facilityId: string): Promise<void> {
  const context = await trackingContext()
  if (!context.sessionId) return
  await track({ event: 'page_view', facilityId, ...context, sessionId: context.sessionId })
}
