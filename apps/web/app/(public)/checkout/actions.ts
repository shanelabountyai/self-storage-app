'use server'

import { revalidatePath } from 'next/cache'
import { advance, extendLock, relock, type Step } from '@/lib/checkout/session'
import { upsertTenantForCheckout, validateDetails } from '@/lib/checkout/details'
import { prisma } from '@storage/db'
import { fieldError, type FormState } from '@/lib/admin/form-state'
import {
  currentPlans,
  premiumFor,
  recordWaiver,
  validateChoice,
  type ProtectionChoice,
} from '@/lib/protection/plans'
import { sessionByToken } from '@/lib/checkout/session'

// B-020. The transitions a step's form can trigger. The individual steps'
// validation lands with B-021..B-025; this item owns the machine they run on.

/// US-501 step 1. Validates, creates or links the account, and moves on.
export async function submitDetailsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get('token') ?? '')
  const input = {
    firstName: String(formData.get('firstName') ?? ''),
    lastName: String(formData.get('lastName') ?? ''),
    email: String(formData.get('email') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    addressLine1: String(formData.get('addressLine1') ?? ''),
    addressLine2: String(formData.get('addressLine2') ?? ''),
    city: String(formData.get('city') ?? ''),
    state: String(formData.get('state') ?? ''),
    postalCode: String(formData.get('postalCode') ?? ''),
    altContactName: String(formData.get('altContactName') ?? ''),
    altContactPhone: String(formData.get('altContactPhone') ?? ''),
    activeDutyMilitary: formData.get('activeDutyMilitary') === 'yes',
  }

  const errors = validateDetails(input)
  if (Object.keys(errors).length > 0) return fieldError(errors)

  const { tenantId } = await upsertTenantForCheckout(input)

  const result = await advance(token, 'details', {
    ...input,
    email: input.email.trim().toLowerCase(),
  })
  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'lock_lapsed'
          ? 'The 30 minutes we were holding your unit ran out. Nothing has been charged — see below for what we can do.'
          : 'We could not save those details. Reload the page and try again.',
      fieldErrors: {},
    }
  }

  // Linked after the transition so a validation failure never leaves a session
  // pointing at an account for a step the renter did not complete.
  await prisma.checkoutSession.update({ where: { id: result.session.id }, data: { tenantId } })

  revalidatePath('/checkout')
  return { status: 'success', message: 'Details saved. Next: confirm your unit.' }
}

/// US-501 step 3 / US-44. Choose a plan, or waive with a real record.
export async function submitProtectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get('token') ?? '')
  const session = await sessionByToken(token)
  if (!session) {
    return { status: 'error', message: 'We could not find that checkout.', fieldErrors: {} }
  }

  const plans = await currentPlans(session.facilityId)
  const tier = String(formData.get('tier') ?? '')

  const choice = (
    tier === '__waiver__'
      ? {
          kind: 'waiver',
          carrier: String(formData.get('carrier') ?? ''),
          policyNumber: String(formData.get('policyNumber') ?? ''),
          expiresAt: String(formData.get('expiresAt') ?? ''),
          attested: formData.get('attested') === 'yes',
        }
      : { kind: 'plan', tier }
  ) as ProtectionChoice

  const errors = validateChoice(choice, plans)
  if (Object.keys(errors).length > 0) return fieldError(errors)

  if (choice.kind === 'waiver') {
    await recordWaiver({
      facilityId: session.facilityId,
      checkoutSessionId: session.id,
      tenantId: null,
      carrier: choice.carrier,
      policyNumber: choice.policyNumber,
      expiresAt: new Date(`${choice.expiresAt}T12:00:00`),
    })
  }

  const premiumCents = premiumFor(choice, plans)
  const result = await advance(token, 'insurance', {
    protection: choice.kind === 'waiver' ? 'waiver' : choice.tier,
    protectionPremiumCents: premiumCents,
  })
  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'lock_lapsed'
          ? 'The 30 minutes we were holding your unit ran out. Nothing has been charged — see below for what we can do.'
          : 'We could not save that choice. Reload the page and try again.',
      fieldErrors: {},
    }
  }

  revalidatePath('/checkout')
  // §6.4: a total that moves has to say why. This is the message the summary's
  // live region announces.
  return {
    status: 'success',
    message:
      premiumCents > 0
        ? `Protection added — your monthly total went up by ${(premiumCents / 100).toFixed(2)} dollars.`
        : 'Your own cover recorded. No protection charge added.',
  }
}

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
