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
import { messages } from '@/lib/i18n/server'
import type { MessageKey } from '@/lib/i18n'

// PRD 01 US-704, gated by US-701's re-auth rule.
//
// Split from lib/portal/payment-methods.ts on purpose, and for the reason
// B-033 wrote down: anything importing `@/auth` — as `checkFreshAuth` and
// `requireTenantActor` both transitively do — cannot be imported under Vitest
// at all. Keeping every decision that can be tested in the lib file and only
// the session-shaped wrapper here is what leaves the logic covered.

// B-310 (D-122): keys, resolved per request against the tenant's dictionary.
const PROBLEM_KEYS: Record<Exclude<MethodChange, { ok: true }>['reason'], MessageKey> = {
  unavailable: 'meth.problem.unavailable',
  not_yours: 'meth.problem.notYours',
  no_method: 'meth.problem.noMethod',
  last_method_on_autopay: 'meth.problem.lastMethodOnAutopay',
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

async function toFormState(result: MethodChange, successKey: MessageKey): Promise<FormState> {
  const { t } = await messages()
  if (result.ok) {
    revalidatePath('/portal/methods')
    revalidatePath('/portal')
    return success(t(successKey))
  }
  return fieldError({ method: t(PROBLEM_KEYS[result.reason]) })
}

export async function setDefaultMethodAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTenantActor()
  await requireFresh('/portal/methods')

  const methodId = String(formData.get('methodId') ?? '')
  if (!methodId) {
    const { t } = await messages()
    return fieldError({ method: t('meth.problem.chooseCard') })
  }

  return toFormState(await setDefaultMethod(actor.tenantId, methodId), 'meth.setDefault')
}

export async function removeMethodAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireTenantActor()
  await requireFresh('/portal/methods')

  const methodId = String(formData.get('methodId') ?? '')
  if (!methodId) {
    const { t } = await messages()
    return fieldError({ method: t('meth.problem.chooseCard') })
  }

  return toFormState(await removeMethod(actor.tenantId, methodId), 'meth.removed')
}

export async function setAutopayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireTenantActor()
  const leaseId = String(formData.get('leaseId') ?? '')
  const enabled = formData.get('enabled') === 'yes'

  // Only the enabling direction is gated — see requireFresh's own note.
  if (enabled) await requireFresh('/portal/methods')

  return toFormState(
    await setLeaseAutopay(actor.tenantId, leaseId, enabled),
    enabled ? 'meth.autopayOnConfirm' : 'meth.autopayOffConfirm',
  )
}
