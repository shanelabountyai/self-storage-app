'use server'

import { success, type FormState } from '@/lib/admin/form-state'
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
  // NOT `keyedFieldError`, which the lead form beside this one uses. That helper
  // puts a generic summary ("There is a problem with one field.") in
  // `message` and the real sentence only in `fieldErrors` — right for a form
  // with twelve fields, where the summary counts them and each field carries
  // its own suggestion. This form has ONE field and its `role="status"` region
  // announces `message`, so the helper would replace "Enter an email address we
  // can reach you at" with a sentence that identifies a problem and suggests
  // nothing (3.3.3 lost, 3.3.1 kept). Both halves get the same resolved
  // sentence instead, which is exactly what this action did before it was
  // translated.
  if (!result.ok) {
    const message = t(result.problem.key)
    return { status: 'error', message, fieldErrors: { email: message } }
  }

  // "Already on it" and "just joined" get the same words on purpose. The
  // distinction is ours, not the visitor's — they asked to be told when a unit
  // is free, and they will be. Saying "you were already on this list" invites
  // them to wonder whether the first one worked. One dictionary key rather than
  // a branch, so the two halves cannot drift apart in either language.
  return success(t('waitlist.joined'))
}
