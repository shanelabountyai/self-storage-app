'use server'

import { revalidatePath } from 'next/cache'
import {
  advance,
  extendLock,
  goBack,
  relock,
  sendCheckoutResumeLink,
  type Step,
} from '@/lib/checkout/session'
import {
  MARKETING_EMAIL_CHECKOUT_DISCLOSURE_VERSION,
  SMS_CONSENT_DISCLOSURE_VERSION,
  upsertTenantForCheckout,
  validateDetails,
} from '@/lib/checkout/details'
import { prisma } from '@storage/db'
import { recordConsent } from '@storage/core/consent'
import { fieldError, type FormState } from '@/lib/admin/form-state'
import {
  currentPlans,
  premiumFor,
  recordWaiver,
  validateChoice,
  type ProtectionChoice,
} from '@/lib/protection/plans'
import { sessionByToken } from '@/lib/checkout/session'
import { existingLeaseDocument } from '@/lib/lease/build'
import { ELECTRONIC_RECORDS_CONSENT_VERSION, signDocument, validateSignature } from '@/lib/lease/sign'
import { requestMetadata } from '@/lib/http/request-metadata'

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
  const smsConsentChecked = formData.get('smsConsent') === 'yes'
  const marketingConsentChecked = formData.get('marketingConsent') === 'yes'

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

  // PRD 05 CN-15: a record either way, not only when granted — "Stored: ...
  // checkbox state" is the AC, and a declined checkbox is still evidence that
  // the disclosure was shown and answered, not silence.
  await recordConsent({
    tenantId,
    channel: 'account_sms',
    state: smsConsentChecked ? 'granted' : 'revoked',
    source: 'checkout_step_1',
    disclosureVersion: SMS_CONSENT_DISCLOSURE_VERSION,
    ipAddress: (await requestMetadata()).ipAddress,
  })

  // PRD 04 US-13 AC1 / US-9 AC3 (B-073). "No consent, no sequence" — the
  // abandonment follow-up reads this back at raise time. Recorded either way,
  // same reasoning as the SMS consent above: a declined box is evidence the
  // disclosure was shown and answered, not silence.
  await recordConsent({
    tenantId,
    channel: 'marketing_email',
    state: marketingConsentChecked ? 'granted' : 'revoked',
    source: 'checkout_step_1',
    disclosureVersion: MARKETING_EMAIL_CHECKOUT_DISCLOSURE_VERSION,
    ipAddress: (await requestMetadata()).ipAddress,
  })

  // CN-22: exactly the moment PRD 05 specifies — email just captured, session
  // still open. A comms failure must never fail step 1, which has already
  // succeeded and committed.
  try {
    await sendCheckoutResumeLink(result.session.id, token)
  } catch {
    // sendDirectEmail records its own failure in the Message log; this only
    // guards against something throwing before it gets that far.
  }

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
    // §6.4: this is the one step that moves both totals, and until B-111 the
    // cause was returned as a form message into a component `revalidatePath`
    // unmounts — so a renter chose a $12/mo tier, watched two numbers change,
    // and was given no reason, one screen before the card form. Carried on the
    // session instead, where the price summary can render it and `advance`
    // clears it on the next step.
    changeNote:
      premiumCents > 0
        ? `Protection plan added — ${(premiumCents / 100).toFixed(2)} dollars a month.`
        : 'Your own cover recorded — no protection charge added.',
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

/// US-501 step 4 / FR-4.2. Signs the lease that was rendered for this session.
export async function signLeaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get('token') ?? '')
  const session = await sessionByToken(token)
  if (!session) {
    return { status: 'error', message: 'We could not find that checkout.', fieldErrors: {} }
  }

  const document = await existingLeaseDocument(session.id)
  if (!document) {
    return {
      status: 'error',
      message: 'We could not find your lease. Reload the page and it will be rebuilt.',
      fieldErrors: {},
    }
  }

  const data = session.data as Record<string, string | undefined>
  const legalName = `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim()

  const errors = validateSignature({
    typedName: String(formData.get('typedName') ?? ''),
    legalName,
    consented: formData.get('consented') === 'yes',
  })
  if (Object.keys(errors).length > 0) return fieldError(errors)

  const { ipAddress, userAgent } = await requestMetadata()
  const signed = await signDocument({
    documentId: document.id,
    typedName: String(formData.get('typedName') ?? ''),
    legalName,
    consented: true,
    ipAddress,
    userAgent,
  })

  if (!signed.ok) {
    return {
      status: 'error',
      message:
        signed.reason === 'already_signed'
          ? 'This lease has already been signed.'
          : 'We could not record your signature. Reload the page and try again.',
      fieldErrors: {},
    }
  }

  // PRD 02 US-13: distinct from the E-SIGN consent `signDocument` just
  // recorded on the document itself — this is the specifically-typed record
  // that proves *this* tenant agreed to receive legal notices electronically,
  // which `account_email`/`marketing_email` cannot stand in for. Reaching
  // here means `consented: true` (validateSignature refuses the sign
  // otherwise), so this is always `granted`.
  if (session.tenantId) {
    await recordConsent({
      tenantId: session.tenantId,
      channel: 'notice_email',
      state: 'granted',
      source: 'checkout_lease_signing',
      disclosureVersion: ELECTRONIC_RECORDS_CONSENT_VERSION,
      ipAddress,
    })
  }

  const result = await advance(token, 'lease', {
    leaseDocumentId: document.id,
    signedAt: signed.signedAt.toISOString(),
  })
  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'lock_lapsed'
          ? 'The 30 minutes we were holding your unit ran out. Nothing has been charged — see below for what we can do.'
          : 'We could not continue. Reload the page and try again.',
      fieldErrors: {},
    }
  }

  revalidatePath('/checkout')
  return { status: 'success', message: 'Lease signed. Next: payment.' }
}

/// §6.9 / D-11a. Records the autopay choice on the session; B-026 carries it
/// onto the lease. Default-on is only defensible because the disclosure sits
/// beside the control and turning it off is one activation.
export async function setAutopayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get('token') ?? '')
  const session = await sessionByToken(token)
  if (!session) {
    return { status: 'error', message: 'We could not find that checkout.', fieldErrors: {} }
  }

  const autopay = formData.get('autopay') === 'yes'
  await prisma.checkoutSession.update({
    where: { id: session.id },
    data: { data: { ...session.data, autopay } as never },
  })

  revalidatePath('/checkout')
  return {
    status: 'success',
    message: autopay
      ? 'Automatic payments are on. We will email you before every charge.'
      : 'Automatic payments are off. We will email you when each payment is due.',
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

/// §6.4's back navigation. One action for both the Back control beside Continue
/// and the completed steps in the progress indicator, so there is one set of
/// rules about what may be gone back to rather than two that can disagree.
export async function goBackAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get('token') ?? '')
  const to = String(formData.get('to') ?? '') as Step

  const result = await goBack(token, to)
  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'paid'
          ? 'Your payment has gone through and your unit is yours, so there is nothing to go back to. Reload the page to see your gate code.'
          : result.reason === 'lock_lapsed'
            ? 'The 30 minutes we were holding your unit ran out. Nothing has been charged — see below for what we can do.'
            : result.reason === 'not_yet_reached'
              ? 'You have not got that far yet. Carry on from where you are.'
              : 'We could not go back to that step. Reload the page and try again.',
      fieldErrors: {},
    }
  }

  revalidatePath('/checkout')
  // Deliberately empty. This is the one transition whose form SURVIVES it — the
  // progress indicator does not unmount when the step below it changes — so a
  // message here would be a second live region announcing the same move as
  // `CheckoutAnnouncer`, half a second apart. The announcer owns it; the empty
  // string keeps `AdminForm`'s region present and silent.
  return { status: 'success', message: '' }
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
