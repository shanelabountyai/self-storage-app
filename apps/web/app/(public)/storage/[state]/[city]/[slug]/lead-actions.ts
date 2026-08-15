'use server'

import { cookies, headers } from 'next/headers'
import {
  decodeTouch,
  FIRST_TOUCH_COOKIE,
  REFERRAL_COOKIE,
  LAST_TOUCH_COOKIE,
} from '@storage/core/marketing'
import { captureLead } from '@/lib/marketing/lead-capture'
import { fieldError, parseDate, success, type FormState } from '@/lib/admin/form-state'
import { track } from '@/lib/analytics/track'
import { trackingContext } from '@/lib/analytics/request'

// PRD 04 US-8 (B-068). The quote/callback form's server action.
//
// US-8 AC3's hidden fields are read from the REQUEST, never from the form:
// facility id is the only one the client supplies, and everything else —
// referrer, UTMs, gclid, first/last touch — comes from headers and cookies. A
// hidden input carrying its own attribution is one a bot can set to anything,
// and the whole point of these numbers is deciding where to spend money.

export async function submitLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
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
    // A bot gets the same answer a person does. Telling it the honeypot fired
    // is how it learns to try again without filling that field.
    if (result.field === 'silent') return success(THANKS)
    return fieldError({ [result.field]: result.problem })
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

  return success(THANKS)
}

const THANKS =
  'Got it — somebody from this facility will be in touch. If it is urgent, calling is faster.'

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
