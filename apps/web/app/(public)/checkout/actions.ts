'use server'

import { revalidatePath } from 'next/cache'
import { advance, extendLock, relock, type Step } from '@/lib/checkout/session'
import type { FormState } from '@/lib/admin/form-state'

// B-020. The transitions a step's form can trigger. The individual steps'
// validation lands with B-021..B-025; this item owns the machine they run on.

export async function advanceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get('token') ?? '')
  const from = String(formData.get('from') ?? '') as Step

  const result = await advance(token, from, {})
  if (!result.ok) {
    if (result.reason === 'lock_lapsed') {
      return {
        status: 'error',
        message:
          'The 30 minutes we were holding your unit ran out. Nothing has been charged — see below for what we can do.',
        fieldErrors: {},
      }
    }
    return {
      status: 'error',
      message: 'We could not continue from this step. Reload the page and try again.',
      fieldErrors: {},
    }
  }

  revalidatePath('/checkout')
  return { status: 'success', message: `Moved on to ${result.session.step.replace('_', ' ')}.` }
}

/// 2.2.1's extension. Deliberately a control the renter can activate, not just
/// a background timer: a screen-reader user reading a long lease generates no
/// interaction events, and an idle-based heartbeat would drop exactly them.
export async function extendLockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get('token') ?? '')
  const result = await extendLock(token)

  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'lock_lapsed'
          ? 'That hold had already run out. Nothing has been charged.'
          : 'We could not extend the hold.',
      fieldErrors: {},
    }
  }

  revalidatePath('/checkout')
  return { status: 'success', message: 'Held for another 30 minutes.' }
}

/// FR-4.1's unit-lost fallback: put the renter back on another unit of the same
/// type, keeping everything they have already entered.
export async function relockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const sessionId = String(formData.get('sessionId') ?? '')
  const result = await relock(sessionId)

  if (!result.ok) {
    return {
      status: 'error',
      message:
        'That size has sold out while you were deciding. Nothing has been charged — call us and we will find you something.',
      fieldErrors: {},
    }
  }

  revalidatePath('/checkout')
  return {
    status: 'success',
    message: 'We found you another unit the same size and kept everything you had entered.',
  }
}
