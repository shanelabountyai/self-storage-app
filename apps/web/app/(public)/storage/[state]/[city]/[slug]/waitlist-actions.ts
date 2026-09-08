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
//
// B-274 (D-122). Everything this action says back is translated. It was the
// last thing on the sold-out card that was not: B-090f translated the card
// above it, B-264 translated the lead form beside it, and B-265 translated the
// mail this action's success promises — so a Spanish visitor read Spanish down
// the page, opened this form, and was thanked in English for joining a list
// they would then be written to in Spanish.

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
    return success(t('wait.discarded'))
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

  if (!result.ok) {
    // B-263's shape for the KEY — `joinWaitlist` returns one and this layer,
    // the only one that knows whose request it is, resolves it — but NOT
    // `keyedFieldError`, and that is a deliberate difference from the lead form
    // beside it.
    //
    // `keyedFieldError` puts "There is a problem with one field." in the live
    // region and the actionable sentence only beside the input, which is right
    // for a form with nine of them. This form has ONE, and B-171 built its
    // announcement to carry the sentence a renter can act on. Swapping that for
    // a count is a worse announcement, and this item is about which language
    // the words are in rather than which words they are — so the shape is
    // unchanged and `smoke.spec.ts`'s English assertion still passes as written,
    // which is the evidence that it is unchanged.
    const problem = t(result.problem.key, result.problem.vars)
    return { status: 'error', message: problem, fieldErrors: { email: problem } }
  }

  // "Already on it" and "just joined" get the same words on purpose. The
  // distinction is ours, not the visitor's — they asked to be told when a unit
  // is free, and they will be. Saying "you were already on this list" invites
  // them to wonder whether the first one worked.
  return success(t(result.alreadyOn ? 'wait.alreadyOn' : 'wait.joined'))
}
