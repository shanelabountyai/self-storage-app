'use server'

import { keyedFieldError, success, type FormState } from '@/lib/admin/form-state'
import { joinWaitlist } from '@/lib/waitlist/service'
import { getLocale, messages } from '@/lib/i18n/server'

// PRD 01 §9 Phase 3 (B-090 part 1). "Waitlists for sold-out unit types with
// notify-me."
//
// Colocated with the facility page for the same reason `lead-actions.ts` is:
// this is the one page that submits it, and an action in a shared directory is
// an action whose call sites you have to go and find.

export async function joinWaitlistAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await messages()
  const facilityId = String(formData.get('facilityId') ?? '')
  const unitTypeId = String(formData.get('unitTypeId') ?? '')
  const email = String(formData.get('email') ?? '')

  // The same honeypot the lead form carries (US-8 AC4). A waitlist entry costs
  // us an email send, so it is worth the four lines — and it is discarded
  // silently rather than refused, because telling a bot which check it failed
  // is how the next attempt passes.
  if (String(formData.get('company') ?? '').trim()) {
    return success(t('waitlist.joined'))
  }

  const result = await joinWaitlist({
    facilityId,
    unitTypeId,
    email,
    phone: formData.get('phone') ? String(formData.get('phone')) : null,
    firstName: formData.get('firstName') ? String(formData.get('firstName')) : null,
    // B-265 (D-130). Captured now because the mail is sent by the sweep, with
    // no request to read this from — see the column's own note.
    locale: await getLocale(),
  })

  // B-263's shape: the service returns a key and this is the only layer that
  // knows whose request it is.
  //
  // B-273. This spelled the helper out by hand until the helper stopped
  // counting: with one field `keyedFieldError` now puts the refusal itself in
  // `message`, which is what this form's `role="status"` region announces and
  // the only place a screen-reader user hears it.
  if (!result.ok) return keyedFieldError({ email: result.problem }, t)

  // "Already on it" and "just joined" get the same words on purpose. The
  // distinction is ours, not the visitor's — they asked to be told when a unit
  // is free, and they will be. Saying "you were already on this list" invites
  // them to wonder whether the first one worked. One dictionary key rather than
  // a branch, so the two halves cannot drift apart in either language.
  return success(t('waitlist.joined'))
}
