'use server'

import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import {
  AuthorizedAccessCapError,
  createAuthorizedPerson,
  ExpiryInThePastError,
  NotYourLeaseError,
  revokeAuthorizedPerson,
} from '@/lib/access/authorized-persons'
import { isSharedAccessPreset, SHARED_ACCESS_PRESETS } from '@storage/core/access'
import {
  enrollMobileKey,
  NoGrantError,
  revokeMobileKey,
  unlockWithMobileKey,
} from '@/lib/access/mobile-key'
import { currentImpersonation } from '@/lib/impersonation/context'
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
  // US-8 AC1's scope. Both optional: the common case is still "my brother, no
  // limits", and requiring an answer to two questions nobody asked is how a
  // tenant goes back to texting their own code instead.
  const preset = String(formData.get('accessHours') ?? 'anytime')
  const expiresOn = String(formData.get('expiresOn') ?? '').trim() || null

  const errors: Record<string, string> = {}
  if (!name) errors.name = 'Enter their full name, as it appears on their ID.'
  if (!phone) errors.phone = 'Enter a phone number we can reach them on.'
  if (!relationship) {
    errors.relationship = 'Say who they are to you — for example "spouse" or "employee".'
  }
  if (!isSharedAccessPreset(preset)) errors.accessHours = 'Choose when they can get in.'
  if (Object.keys(errors).length > 0) return fieldError(errors)

  try {
    const created = await createAuthorizedPerson(
      { kind: 'tenant', tenantId: actor.tenantId },
      leaseId,
      {
        name,
        phone,
        relationship,
        accessHours: isSharedAccessPreset(preset) ? SHARED_ACCESS_PRESETS[preset].schedule : null,
        expiresOn,
      },
    )
    revalidatePath('/portal/access')
    return success(
      `${name} can now get in with their own code: ${created.code}. It is theirs alone — you can withdraw it at any time without changing yours.`,
    )
  } catch (error) {
    if (error instanceof ExpiryInThePastError) {
      return fieldError({ expiresOn: error.message })
    }
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

// PRD 03 US-8 AC1/AC4 (B-086 part 2). Phone unlock.

/// PRD 09 FR-12. A support session may not open a gate.
///
/// The portal already withholds the gate CODE during impersonation, and an
/// unlock button is the same permission with the physical step removed — a
/// staff member who cannot be told the code must not be handed the door. The
/// three actions below are refused rather than hidden, because a hidden
/// control is still a reachable server action.
async function refuseDuringImpersonation(): Promise<FormState | null> {
  if (!(await currentImpersonation())) return null
  return refusal(
    'The gate cannot be opened from a support session. The tenant can do it here themselves.',
  )
}

/// A refusal with no field to hang it on — the B-233 shape. Every field on
/// these three forms is a hidden `facilityId`, so a `fieldError` would point
/// `aria-describedby` at a control nobody can focus or correct, and the
/// summary would read "There is a problem with one field" above a sentence
/// about a gate. The message carries the whole meaning; `AdminForm` renders it
/// in the `role="alert"` box and moves focus there.
function refusal(message: string): FormState {
  return { status: 'error', message, fieldErrors: {} }
}

export async function unlockGateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const blocked = await refuseDuringImpersonation()
  if (blocked) return blocked

  const facilityId = String(formData.get('facilityId') ?? '')
  const outcome = await unlockWithMobileKey(actor.tenantId, facilityId)

  // A refusal is a `fieldError` rather than a thrown error on purpose: "the
  // gate is closed right now" is an answer, not a fault, and the tenant needs
  // to READ it — `AdminForm` renders an error into the same pre-existing live
  // region it renders a success into, and focuses it.
  return outcome.opened ? success(outcome.message) : refusal(outcome.message)
}

export async function enrollMobileKeyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const blocked = await refuseDuringImpersonation()
  if (blocked) return blocked

  const facilityId = String(formData.get('facilityId') ?? '')
  try {
    const result = await enrollMobileKey(actor, facilityId)
    if (!result.ok) return refusal(result.reason)
  } catch (error) {
    if (error instanceof NoGrantError) return refusal(error.message)
    throw error
  }

  revalidatePath('/portal/access')
  return success(
    'Phone unlock is on for this gate. Your gate code still works at the keypad — you have not lost it, and you will want it if your phone has no signal.',
  )
}

export async function revokeMobileKeyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const blocked = await refuseDuringImpersonation()
  if (blocked) return blocked

  const facilityId = String(formData.get('facilityId') ?? '')
  try {
    const result = await revokeMobileKey(actor, facilityId)
    if (!result.ok) return refusal('Phone unlock is already switched off for this gate.')
  } catch (error) {
    if (error instanceof NoGrantError) return refusal(error.message)
    throw error
  }

  revalidatePath('/portal/access')
  return success('This phone can no longer open the gate. Your gate code is unchanged and still works at the keypad.')
}
