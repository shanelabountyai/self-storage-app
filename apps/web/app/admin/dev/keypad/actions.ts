'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { assertFacilityAccess } from '@/lib/rbac/authorize'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'
import { evaluateKeypadEntry, replayVendorEventBacklog, setSimulatorConfig } from '@/lib/access/simulator'

// PRD 03 US-7. Server actions for the virtual keypad dev page. Staff auth
// only — this is developer/demo tooling (US-7's own framing is "as the
// developer/learner"), not a feature an operator configures, so it is
// reachable by URL rather than added to the nav catalog and gated behind a
// dedicated permission that would only exist for its sake.

export async function enterKeypadCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  assertFacilityAccess(actor, facilityId)

  const code = String(formData.get('code') ?? '').trim()
  if (!/^\d{4,8}$/.test(code)) {
    return fieldError({ code: 'Enter the digits of a code, 4 to 8 of them.' })
  }

  const outcome = await evaluateKeypadEntry(facilityId, code)
  revalidatePath('/admin/dev/keypad')

  const reasonText =
    outcome.reason === 'ok'
      ? ''
      : outcome.reason === 'unknown_code'
        ? ' — no credential on file matches that code'
        : ' — that code exists but is not active right now'
  const deliveryText = outcome.delivered
    ? ''
    : ' (event queued — the simulated webhook did not deliver it; see the fault settings below)'

  return success(
    `${outcome.result === 'granted' ? 'Access granted' : 'Access denied'}${reasonText}.${deliveryText}`,
  )
}

export async function updateSimulatorConfigAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  assertFacilityAccess(actor, facilityId)

  const latencyMs = Number(formData.get('latencyMs') ?? 0)
  if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 30_000) {
    return fieldError({ latencyMs: 'Enter a delay between 0 and 30,000 ms.' })
  }

  await setSimulatorConfig(facilityId, {
    offline: formData.get('offline') === 'yes',
    webhookFailing: formData.get('webhookFailing') === 'yes',
    latencyMs,
  })

  revalidatePath('/admin/dev/keypad')
  return success('Fault settings saved.')
}

export async function replayBacklogAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')
  assertFacilityAccess(actor, facilityId)

  const { delivered } = await replayVendorEventBacklog(facilityId)
  revalidatePath('/admin/dev/keypad')

  return success(
    delivered === 0
      ? 'Nothing was waiting to be delivered.'
      : `Delivered ${delivered} queued event${delivered === 1 ? '' : 's'}.`,
  )
}
