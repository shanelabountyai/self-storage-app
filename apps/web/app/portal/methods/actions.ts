'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireTenantActor } from '@/lib/rbac/session'
import { checkFreshAuth } from '@/lib/auth/reauth'
import {
  removeMethod,
  setDefaultMethod,
  setLeaseAutopay,
  type MethodChange,
} from '@/lib/portal/payment-methods'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 01 US-704, gated by US-701's re-auth rule.
//
// Split from lib/portal/payment-methods.ts on purpose, and for the reason
// B-033 wrote down: anything importing `@/auth` — as `checkFreshAuth` and
// `requireTenantActor` both transitively do — cannot be imported under Vitest
// at all. Keeping every decision that can be tested in the lib file and only
// the session-shaped wrapper here is what leaves the logic covered.

const PROBLEM_COPY: Record<Exclude<MethodChange, { ok: true }>['reason'], string> = {
  unavailable: 'We can’t change cards just now. Please try again shortly.',
  not_yours: 'We couldn’t find that on your account.',
  no_method: 'Add a card first — automatic payments need one to charge.',
  last_method_on_autopay:
    'That’s the only card on file and at least one unit pays automatically. Add another card first, or turn automatic payments off.',
}

/// US-701: "sensitive actions re-verify by fresh login or emailed code."
///
/// Applied to anything that starts or redirects money — adding a card,
/// changing which one is charged, removing one, switching autopay ON — and
/// deliberately NOT to switching autopay OFF. Making someone re-authenticate
/// to STOP a recurring charge is the one direction where a gate does harm: a
/// tenant locked out of their own account would keep being billed.
async function requireFresh(returnTo: string): Promise<void> {
  const fresh = await checkFreshAuth()
  if (fresh.fresh) return
  redirect(`/reauth?redirect=${encodeURIComponent(returnTo)}`)
}

function toFormState(result: MethodChange, message: string): FormState {
  if (result.ok) {
    revalidatePath('/portal/methods')
    revalidatePath('/portal')
    return success(message)
  }
  return fieldError({ method: PROBLEM_COPY[result.reason] })
}

export async function setDefaultMethodAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTenantActor()
  await requireFresh('/portal/methods')

  const methodId = String(formData.get('methodId') ?? '')
  if (!methodId) return fieldError({ method: 'Choose a card first.' })

  return toFormState(
    await setDefaultMethod(actor.tenantId, methodId),
    'That card is now the one we charge.',
  )
}

export async function removeMethodAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTenantActor()
  await requireFresh('/portal/methods')

  const methodId = String(formData.get('methodId') ?? '')
  if (!methodId) return fieldError({ method: 'Choose a card first.' })

  return toFormState(await removeMethod(actor.tenantId, methodId), 'That card has been removed.')
}

export async function setAutopayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const leaseId = String(formData.get('leaseId') ?? '')
  const enabled = formData.get('enabled') === 'yes'

  // Only the enabling direction is gated — see requireFresh's own note.
  if (enabled) await requireFresh('/portal/methods')

  return toFormState(
    await setLeaseAutopay(actor.tenantId, leaseId, enabled),
    enabled
      ? 'Automatic payments are on. We’ll email you two days before every charge.'
      : 'Automatic payments are off. You’ll get a reminder when each payment is due.',
  )
}
