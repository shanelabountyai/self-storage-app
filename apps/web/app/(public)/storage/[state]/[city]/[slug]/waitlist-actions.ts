'use server'

import type { FormState } from '@/lib/admin/form-state'
import { joinWaitlist } from '@/lib/waitlist/service'

// PRD 01 §9 Phase 3 (B-090 part 1). "Waitlists for sold-out unit types with
// notify-me."
//
// Colocated with the facility page for the same reason `lead-actions.ts` is:
// this is the one page that submits it, and an action in a shared directory is
// an action whose call sites you have to go and find.

export async function joinWaitlistAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const facilityId = String(formData.get('facilityId') ?? '')
  const unitTypeId = String(formData.get('unitTypeId') ?? '')
  const email = String(formData.get('email') ?? '')

  // The same honeypot the lead form carries (US-8 AC4). A waitlist entry costs
  // us an email send, so it is worth the four lines — and it is discarded
  // silently rather than refused, because telling a bot which check it failed
  // is how the next attempt passes.
  if (String(formData.get('company') ?? '').trim()) {
    return { status: 'success', message: "You're on the list." }
  }

  const result = await joinWaitlist({
    facilityId,
    unitTypeId,
    email,
    phone: formData.get('phone') ? String(formData.get('phone')) : null,
    firstName: formData.get('firstName') ? String(formData.get('firstName')) : null,
  })

  if (!result.ok) {
    return { status: 'error', message: result.problem, fieldErrors: { email: result.problem } }
  }

  // "Already on it" and "just joined" get the same words on purpose. The
  // distinction is ours, not the visitor's — they asked to be told when a unit
  // is free, and they will be. Saying "you were already on this list" invites
  // them to wonder whether the first one worked.
  return {
    status: 'success',
    message: result.alreadyOn
      ? "You're on the list — we'll email you as soon as one is free."
      : "You're on the list. We'll email you as soon as one is free.",
  }
}
