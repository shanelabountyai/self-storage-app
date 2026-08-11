'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/rbac/session'
import { closeDrawer, openDrawer } from '@/lib/admin/drawer'
import { fieldError, success, type FormState } from '@/lib/admin/form-state'

// PRD 02 US-33 (B-078). Thin session wrapper; lib/admin/drawer.ts holds the
// rules and the arithmetic.

/// Dollars to cents without float error — the same parser the POS payment
/// form uses, for the same reason.
function parseDollars(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null
  const [whole, fraction = ''] = raw.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

export async function openDrawerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const facilityId = String(formData.get('facilityId') ?? '')

  const floatCents = parseDollars(formData.get('openingFloat'))
  if (floatCents === null) return fieldError({ openingFloat: 'Enter the float, like 200.00.' })

  const result = await openDrawer(actor, facilityId, floatCents)
  if (!result.ok) {
    return fieldError({
      openingFloat:
        result.problem === 'already_open'
          ? 'There is already an open drawer at this facility. Close it first.'
          : 'The float cannot be negative.',
    })
  }

  revalidatePath('/admin/pos')
  revalidatePath('/admin/pos/drawer')
  return success('Drawer open. Cash and cheques taken from now on post to this session.')
}

const CLOSE_PROBLEM_COPY: Record<string, string> = {
  not_open: 'That drawer is already closed.',
  count_negative: 'A counted amount cannot be negative.',
  note_required: 'The drawer is out by more than the threshold — say what happened before closing.',
}

export async function closeDrawerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireStaffActor()
  const sessionId = String(formData.get('sessionId') ?? '')

  const cash = parseDollars(formData.get('countedCash'))
  if (cash === null) return fieldError({ countedCash: 'Enter the counted cash, like 412.50.' })
  const checks = parseDollars(formData.get('countedChecks'))
  if (checks === null) return fieldError({ countedChecks: 'Enter the counted cheques, like 0.00.' })

  const result = await closeDrawer(actor, sessionId, {
    countedCashCents: cash,
    countedChecksCents: checks,
    note: String(formData.get('note') ?? ''),
  })

  if (!result.ok) {
    const field = result.problem === 'note_required' ? 'note' : 'countedCash'
    return fieldError({ [field]: CLOSE_PROBLEM_COPY[result.problem] })
  }

  revalidatePath('/admin/pos')
  revalidatePath('/admin/pos/drawer')

  const variance = result.varianceCents
  const settled = result.settledRefunds
      ? ` ${result.settledRefunds} cash refund${result.settledRefunds === 1 ? '' : 's'} marked paid.`
      : ''
  return success(
    variance === 0
      ? `Drawer closed and balanced exactly.${settled}`
      : `Drawer closed, ${variance > 0 ? 'over' : 'short'} by ${(Math.abs(variance) / 100).toFixed(2)}.${settled}`,
  )
}
