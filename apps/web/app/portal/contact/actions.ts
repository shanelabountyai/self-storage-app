'use server'

import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import { requestEmailChange } from '@/lib/auth/email-change'
import { recordAddressChange, updateContactDetails, validateAddress } from '@/lib/portal/contact'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 01 US-706. Thin session wrapper; every decision lives in
// lib/portal/contact.ts and lib/auth/email-change.ts, which import nothing
// from `@/auth` and are therefore testable (the B-033 boundary).

export async function saveContactDetailsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTenantActor()
  const problems = await updateContactDetails(actor.tenantId, {
    phone: String(formData.get('phone') ?? ''),
    altContactName: String(formData.get('altContactName') ?? ''),
    altContactPhone: String(formData.get('altContactPhone') ?? ''),
    altContactEmail: String(formData.get('altContactEmail') ?? ''),
  })
  if (Object.keys(problems).length > 0) return fieldError(problems)
  // Without this the form reports success while the page around it still
  // renders what was there before the save.
  revalidatePath('/portal/contact')
  return success('Your contact details are saved.')
}

export async function saveAddressAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const input = {
    addressLine1: String(formData.get('addressLine1') ?? ''),
    addressLine2: String(formData.get('addressLine2') ?? ''),
    city: String(formData.get('city') ?? ''),
    state: String(formData.get('state') ?? ''),
    postalCode: String(formData.get('postalCode') ?? ''),
  }

  const problems = validateAddress(input)
  if (Object.keys(problems).length > 0) return fieldError(problems)

  const { changed } = await recordAddressChange(actor.tenantId, input, 'portal', {
    kind: 'tenant',
    tenantId: actor.tenantId,
  })
  // The previous-addresses list is rendered from the server, so it has to be
  // re-read or the history the tenant just added does not appear.
  revalidatePath('/portal/contact')
  return success(
    changed
      ? 'Your address is updated. We’ll use it for anything we post to you.'
      : 'That’s already your address on file.',
  )
}

export async function requestEmailChangeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTenantActor()
  const result = await requestEmailChange(actor.tenantId, String(formData.get('email') ?? ''))

  if (!result.ok) {
    return fieldError({
      email:
        result.reason === 'invalid'
          ? 'Enter an email address.'
          : result.reason === 'unchanged'
            ? 'That’s already your email address.'
            : 'That email address is already in use on another account.',
    })
  }

  return success(
    'Check your new inbox — we’ve sent a link to confirm it. Nothing changes until you open it. We’ve also let your current address know.',
  )
}
