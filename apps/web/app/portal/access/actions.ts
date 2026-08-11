'use server'

import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import {
  AuthorizedAccessCapError,
  createAuthorizedPerson,
  NotYourLeaseError,
  revokeAuthorizedPerson,
} from '@/lib/access/authorized-persons'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 03 US-9 AC4 (B-105). Tenant self-service for the authorized-access list.
//
// Both actions call the same functions the counter calls. The tenant actor is
// passed straight through — the ownership check lives in that module, once.

export async function addPersonAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const leaseId = String(formData.get('leaseId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()
  const relationship = String(formData.get('relationship') ?? '').trim()

  const errors: Record<string, string> = {}
  if (!name) errors.name = 'Enter their full name, as it appears on their ID.'
  if (!phone) errors.phone = 'Enter a phone number we can reach them on.'
  if (!relationship) {
    errors.relationship = 'Say who they are to you — for example "spouse" or "employee".'
  }
  if (Object.keys(errors).length > 0) return fieldError(errors)

  try {
    const created = await createAuthorizedPerson(
      { kind: 'tenant', tenantId: actor.tenantId },
      leaseId,
      { name, phone, relationship },
    )
    revalidatePath('/portal/access')
    return success(
      `${name} can now get in with their own code: ${created.code}. It is theirs alone — you can withdraw it at any time without changing yours.`,
    )
  } catch (error) {
    if (error instanceof AuthorizedAccessCapError) {
      return fieldError({
        name: `You can have ${error.cap} named people on this unit. Withdraw somebody first, or call the office if you need more.`,
      })
    }
    if (error instanceof NotYourLeaseError) {
      return fieldError({ name: 'We could not find that unit on your account.' })
    }
    throw error
  }
}

export async function revokePersonAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const personId = String(formData.get('personId') ?? '')
  const name = String(formData.get('name') ?? 'That person')

  try {
    const result = await revokeAuthorizedPerson(
      { kind: 'tenant', tenantId: actor.tenantId },
      personId,
      // US-38 requires a reason on `access.revoked`. The tenant withdrawing
      // their own authorisation IS the reason, so it is stated rather than
      // asked for — a free-text box here would collect "because" and mean less.
      'tenant_request',
    )
    if (!result.ok) {
      return fieldError({ personId: 'That person has already been taken off the list.' })
    }
  } catch (error) {
    if (error instanceof NotYourLeaseError) {
      return fieldError({ personId: 'We could not find that person on your account.' })
    }
    throw error
  }

  revalidatePath('/portal/access')
  return success(`${name}'s code has stopped working. Your own code is unchanged.`)
}
