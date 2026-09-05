'use server'

import { revalidatePath } from 'next/cache'
import {
  addUnitToBasket,
  advance,
  extendLock,
  goBack,
  relock,
  relockAtSize,
  removeUnitFromBasket,
  sendCheckoutResumeLink,
  type Step,
} from '@/lib/checkout/session'
import {
  MARKETING_EMAIL_CHECKOUT_DISCLOSURE_VERSION,
  MARKETING_SMS_DISCLOSURE_VERSION,
  SMS_CONSENT_DISCLOSURE_VERSION,
  localityFor,
  recordLeaseDeclarations,
  upsertTenantForCheckout,
  validateDeclarations,
  validateDetails,
} from '@/lib/checkout/details'
import { prisma } from '@storage/db'
import { formatRate } from '@/lib/format'
import { labelForStep } from '@/components/checkout/stepper'
import {
  dictionaryFor,
  translate,
  type Dictionary,
  type MessageKey,
} from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
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
import { offerFor } from '@/lib/promotions/service'
import { isoDate, judgeStartDate, startDateWindow } from '@storage/core/checkout'
import { businessDateFor } from '@storage/core/jobs'
import { existingLeaseDocuments } from '@/lib/lease/build'
import { ELECTRONIC_RECORDS_CONSENT_VERSION, signDocument, validateSignature } from '@/lib/lease/sign'
import { requestMetadata } from '@/lib/http/request-metadata'

// B-020. The transitions a step's form can trigger. The individual steps'
// validation lands with B-021..B-025; this item owns the machine they run on.

/// US-501 step 1. Validates, creates or links the account, and moves on.
// B-090 part 6. Every message these actions return lands in a live region on
// the money path, so they are translated like the rest of the checkout.
//
// Resolved per call rather than once at module scope: a server action runs
// inside a request, and a module-level dictionary would be whichever language
// the first request after a cold start happened to use — served to everybody
// afterwards.
type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string

async function messages(): Promise<{ dict: Dictionary; t: Translator }> {
  const dict = dictionaryFor(await getLocale())
  return { dict, t: (key, vars) => translate(dict, key, vars) }
}

export async function submitDetailsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t } = await messages()
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
  }
  const smsConsentChecked = formData.get('smsConsent') === 'yes'
  const marketingConsentChecked = formData.get('marketingConsent') === 'yes'
  // D-51 (B-123). Its own box, never inferred from the two above.
  const marketingSmsChecked = formData.get('marketingSmsConsent') === 'yes'

  const errors = validateDetails(input)
  if (Object.keys(errors).length > 0) return fieldError(errors)

  // B-112: city and state come from the zip unless the renter opened the
  // disclosure and typed them. `validateDetails` has already refused the case
  // where neither is available, so this is present.
  const locality = localityFor(input)!

  const { tenantId } = await upsertTenantForCheckout(input, locality)

  const result = await advance(token, 'details', {
    ...input,
    ...locality,
    email: input.email.trim().toLowerCase(),
  })
  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'lock_lapsed'
          ? t('act.lockLapsed')
          : t('act.detailsFailed'),
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

  // PRD 04 US-13 AC1/AC3, D-51 (B-123). The marketing TEXT lane, recorded
  // separately from all three above and from `account_sms` in particular: a
  // tenant who agreed to gate codes by text has not agreed to be texted about
  // a sale, and TCPA express written consent has to be provably to the thing
  // it was given for. Recorded either way for the same reason as the others —
  // a declined box is evidence the disclosure was shown and answered.
  //
  // Nothing sends on this lane yet (D-51): the disclosure is draft pending
  // legal review and A2P 10DLC needs its own marketing campaign registered.
  // Capturing now is deliberate — it is the same reasoning PRD 05 CN-15
  // applied to `account_sms`, that consent should exist before the channel
  // does, and every row carries the version of the text actually shown.
  await recordConsent({
    tenantId,
    channel: 'marketing_sms',
    state: marketingSmsChecked ? 'granted' : 'revoked',
    source: 'checkout_step_1',
    disclosureVersion: MARKETING_SMS_DISCLOSURE_VERSION,
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
  return { status: 'success', message: t('act.detailsSaved') }
}

/// US-501 step 3 / US-44. Choose a plan, or waive with a real record.
export async function submitProtectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const session = await sessionByToken(token)
  if (!session) {
    return { status: 'error', message: t('act.checkoutNotFound'), fieldErrors: {} }
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
        ? t('act.protectionAddedNote', { amount: formatRate(premiumCents) })
        : t('act.ownCoverNote'),
  })
  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'lock_lapsed'
          ? t('act.lockLapsed')
          : t('act.protectionChoiceFailed'),
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
        ? t('act.protectionAdded', { amount: formatRate(premiumCents) })
        : t('act.ownCoverRecorded'),
  }
}

/// US-501 step 4 / FR-4.2. Signs the lease that was rendered for this session.
export async function signLeaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const session = await sessionByToken(token)
  if (!session) {
    return { status: 'error', message: t('act.checkoutNotFound'), fieldErrors: {} }
  }

  // D-53. Every agreement in the basket, signed by this one action.
  const documents = await existingLeaseDocuments(session)
  if (documents.length !== session.units.length) {
    return {
      status: 'error',
      message: t('act.leaseNotFound'),
      fieldErrors: {},
    }
  }

  const data = session.data as Record<string, string | undefined>
  const legalName = `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim()

  // B-112: these moved here from step 1, so they are validated here too — and
  // BEFORE the signature is recorded, or a bad alternate phone would refuse a
  // lease that had already been signed.
  const declarations = {
    altContactName: String(formData.get('altContactName') ?? ''),
    altContactPhone: String(formData.get('altContactPhone') ?? ''),
    activeDutyMilitary: formData.get('activeDutyMilitary') === 'yes',
  }

  const errors = {
    ...validateDeclarations(declarations),
    ...validateSignature({
      typedName: String(formData.get('typedName') ?? ''),
      legalName,
      consented: formData.get('consented') === 'yes',
    }),
  }
  if (Object.keys(errors).length > 0) return fieldError(errors)

  const { ipAddress, userAgent } = await requestMetadata()
  // D-53: one signing action, N agreements. Sequential rather than parallel so
  // a refusal names the agreement that refused, and `already_signed` is treated
  // as success for the SET — a renter who signed two of three and hit a
  // transport error must be able to press the button again rather than be told
  // the lease is already signed and left with one unsigned unit.
  const signatures = []
  for (const entry of documents) {
    const signed = await signDocument({
      documentId: entry.document.id,
      typedName: String(formData.get('typedName') ?? ''),
      legalName,
      consented: true,
      ipAddress,
      userAgent,
    })
    if (!signed.ok && signed.reason !== 'already_signed') {
      return {
        status: 'error',
        message: t('act.signatureFailed'),
        fieldErrors: {},
      }
    }
    if (signed.ok) signatures.push(signed)
  }

  // Every document already carried a signature, and none was written now. That
  // is the genuine "you have already signed" case.
  if (signatures.length === 0) {
    return { status: 'error', message: t('act.alreadySigned'), fieldErrors: {} }
  }
  const signed = signatures[0]

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

  if (session.tenantId) await recordLeaseDeclarations(session.tenantId, declarations)

  const result = await advance(token, 'lease', {
    // The primary unit's agreement. Every document in the set is signed and
    // stored; this names the one the confirmation and the receipt link to,
    // matching `leaseId` alongside `leaseIds` on the provisioning side.
    leaseDocumentId: documents[0].document.id,
    signedAt: signed.signedAt.toISOString(),
    ...declarations,
  })
  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'lock_lapsed'
          ? t('act.lockLapsed')
          : t('act.continueFailed'),
      fieldErrors: {},
    }
  }

  revalidatePath('/checkout')
  return { status: 'success', message: t('act.leaseSigned') }
}

/// §6.9 / D-11a. Records the autopay choice on the session; B-026 carries it
/// onto the lease. Default-on is only defensible because the disclosure sits
/// beside the control and turning it off is one activation.
export async function setAutopayAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const session = await sessionByToken(token)
  if (!session) {
    return { status: 'error', message: t('act.checkoutNotFound'), fieldErrors: {} }
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
      ? t('act.autopayOn')
      : t('act.autopayOff'),
  }
}

/// PRD 04 US-11 AC3 (B-122). A promo code entered during checkout.
///
/// Re-evaluated server-side from the session's OWN facility, unit type and
/// locked rate — the form transmits the typed string and nothing else, so a
/// hand-crafted post can name a code but never name a discount. The offer that
/// comes back is written to the session snapshot exactly as `startCheckout`
/// writes the one from "Rent now", which is what makes the summary, the amount
/// due today and the eventual redemption row agree; they all read that snapshot.
///
/// Refused after the payment step. A promotion applied to a charge already
/// authorised would change a total the renter has approved — §6.4's own rule —
/// and `provisionMoveIn` redeems the schedule the session locked, so a late
/// change would write a redemption for money nobody was charged.
export async function applyPromoCodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const session = await sessionByToken(token)
  if (!session) {
    return { status: 'error', message: t('act.checkoutNotFound'), fieldErrors: {} }
  }
  if (session.step === 'provisioned' || session.status === 'completed') {
    return {
      status: 'error',
      message: t('act.checkoutFinishedNoCode'),
      fieldErrors: {},
    }
  }

  const code = String(formData.get('promo') ?? '').trim()
  if (!code) {
    return { status: 'error', message: t('act.enterACode'), fieldErrors: { promo: t('act.enterACode') } }
  }

  const lookup = await offerFor({
    facilityId: session.facilityId,
    unitTypeId: session.unitTypeId,
    // The LOCKED rate, never a fresh one. The renter is entitled to the price
    // they were shown, and evaluating a percentage promo against a rate that
    // had since moved would compute a discount off a number nobody quoted.
    monthlyRateCents: session.quotedRateCents,
    // Matches what "Rent now" assumed. The real person is not known until step
    // 1 and `provisionMoveIn` re-checks eligibility before redeeming anything.
    isNewTenant: true,
    code,
  })

  // Nothing is written on a refusal — the offer already on the session stands.
  // A rejected code that cleared an automatic promotion would make typing a
  // wrong code cost the renter money.
  if (lookup.codeOutcome?.kind === 'rejected') {
    return {
      status: 'error',
      message: lookup.problem ?? t('act.codeDidNotWork'),
      fieldErrors: { promo: lookup.problem ?? t('act.codeDidNotWork') },
    }
  }

  await prisma.checkoutSession.update({
    where: { id: session.id },
    data: {
      promotionId: lookup.offer?.promotionId ?? null,
      promoCodeId: lookup.offer?.promoCodeId ?? null,
      data: {
        ...session.data,
        promoTerms: lookup.offer?.terms ?? null,
        promoFirstPeriodCents: lookup.offer?.firstPeriodCents ?? null,
        promoSchedule: lookup.offer?.schedule ?? null,
        // Deliberately CLEARED, not written.
        //
        // Every other step writes `changeNote` because the control that moved
        // the total is on a different part of the page from the total. This one
        // is not: the code box sits directly under the summary, and its own
        // `role="status"` says the whole sentence. Writing the same words into
        // the summary's live region as well made a screen reader announce
        // "Code applied — half off your first month" twice, from two regions,
        // which is how a helpful announcement becomes noise people turn off.
        //
        // §6.4's "a total that moves must state its cause" is still satisfied
        // and more durably than a note would: the discount is now a named line
        // in the summary's own itemisation, which survives a reload.
        changeNote: null,
      } as never,
    },
  })

  revalidatePath('/checkout')
  return { status: 'success', message: lookup.problem ?? t('act.codeApplied') }
}

/// US-501 step 2, extended by B-106. Confirm the unit, and pick when.
///
/// Its own action rather than a branch of `advanceAction`, because this step
/// now has a field to validate and `advanceAction` is the generic "no input,
/// just move on" transition every other step uses.
export async function confirmUnitAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const session = await sessionByToken(token)
  if (!session) {
    return { status: 'error', message: t('act.checkoutNotFound'), fieldErrors: {} }
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: session.facilityId },
    select: { timezone: true, maxCheckoutStartDaysAhead: true },
  })
  // The facility's own calendar day, not the server's — at 10pm in Texas the
  // UTC date is already tomorrow, and a renter refused "today" would be
  // reading a timezone bug rather than a rule.
  // `businessDateFor` returns the local calendar day as a UTC-midnight Date,
  // which is exactly what the window wants — converted at the boundary rather
  // than making the pure module take a Date, so the string form stays the one
  // thing the picker, the message and the tests all speak.
  const window = startDateWindow(
    isoDate(businessDateFor(new Date(), facility.timezone)),
    facility.maxCheckoutStartDaysAhead,
  )
  const verdict = judgeStartDate(String(formData.get('startDate') ?? ''), window)

  // 3.3.3: the message names the date to use, and the field keeps what was
  // typed (B-124's `AdminForm` echo), so the correction is one edit rather
  // than a retype.
  if (!verdict.ok) return fieldError({ startDate: verdict.message })

  await prisma.checkoutSession.update({
    where: { id: session.id },
    // Stored even when it IS today, so "the renter confirmed a date" and
    // "nobody asked" stay distinguishable — the second is what every session
    // before B-106 means, and provisioning still treats null as today.
    data: { requestedStartDate: verdict.startDate },
  })

  const result = await advance(token, 'unit_assign', {})
  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'lock_lapsed'
          ? t('act.lockLapsed')
          : t('act.stepContinueFailed'),
      fieldErrors: {},
    }
  }

  revalidatePath('/checkout')
  return { status: 'success', message: t('act.unitConfirmed') }
}

// B-106 part 5. Adding and removing units in one checkout.
//
// Both mutate the basket and then re-render the same step rather than
// advancing: the renter is still deciding what they are renting, and a change
// that moved them forward would make "add another" a one-way door.
//
// The success message is the same string the summary's change note carries, so
// what a screen-reader user hears and what a sighted user reads under the
// total are one sentence rather than two that can drift apart.

/// Shared refusal wording. The reasons are the same on both paths and each one
/// says what the renter can do next, never just what failed.
function basketRefusal(reason: string, t: Translator): FormState {
  if (reason === 'lock_lapsed') {
    return {
      status: 'error',
      message:
        t('act.lockLapsedUnits'),
      fieldErrors: {},
    }
  }
  if (reason === 'sold_out') {
    return {
      status: 'error',
      message:
        t('act.sizeJustWent'),
      fieldErrors: {},
    }
  }
  if (reason === 'last_unit') {
    return {
      status: 'error',
      message:
        t('act.lastUnit'),
      fieldErrors: {},
    }
  }
  return { status: 'error', message: t('act.basketFailed'), fieldErrors: {} }
}

export async function addUnitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const { dict } = await messages()
  const result = await addUnitToBasket(token, String(formData.get('unitTypeId') ?? ''), dict)
  if (!result.ok) return basketRefusal(result.reason, t)

  revalidatePath('/checkout')
  return { status: 'success', message: result.changeNote }
}

export async function removeUnitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const { dict } = await messages()
  const result = await removeUnitFromBasket(token, String(formData.get('lineId') ?? ''), dict)
  if (!result.ok) return basketRefusal(result.reason, t)

  revalidatePath('/checkout')
  return { status: 'success', message: result.changeNote }
}

export async function advanceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { dict, t } = await messages()
  const token = String(formData.get('token') ?? '')
  const from = String(formData.get('from') ?? '') as Step

  const result = await advance(token, from, {})
  if (!result.ok) {
    if (result.reason === 'lock_lapsed') {
      return {
        status: 'error',
        message:
          t('act.lockLapsed'),
        fieldErrors: {},
      }
    }
    return {
      status: 'error',
      message: t('act.stepContinueFailed'),
      fieldErrors: {},
    }
  }

  revalidatePath('/checkout')
  return {
    status: 'success',
    message: t('act.movedOnTo', { step: labelForStep(result.session.step, dict).toLowerCase() }),
  }
}

/// §6.4's back navigation. One action for both the Back control beside Continue
/// and the completed steps in the progress indicator, so there is one set of
/// rules about what may be gone back to rather than two that can disagree.
export async function goBackAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const to = String(formData.get('to') ?? '') as Step

  const result = await goBack(token, to)
  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'paid'
          ? t('act.alreadyPaid')
          : result.reason === 'lock_lapsed'
            ? t('act.lockLapsed')
            : result.reason === 'not_yet_reached'
              ? t('act.notThatFarYet')
              : t('act.goBackFailed'),
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
  const { t } = await messages()
  const token = String(formData.get('token') ?? '')
  const result = await extendLock(token)

  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.reason === 'lock_lapsed'
          ? t('act.holdAlreadyRanOut')
          : t('act.extendFailed'),
      fieldErrors: {},
    }
  }

  revalidatePath('/checkout')
  return { status: 'success', message: t('act.heldAnother30') }
}

/// FR-4.1's unit-lost fallback: put the renter back on another unit of the same
/// type, keeping everything they have already entered.
export async function relockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await messages()
  const sessionId = String(formData.get('sessionId') ?? '')
  const result = await relock(sessionId)

  if (!result.ok) {
    // B-149. Revalidate on the FAILURE path too: the panel below decides what
    // it offers from `availableCount`, and this is the moment that number went
    // to zero. Without it the renter is told the size sold out and left looking
    // at the button that just failed, which is the dead end this row is about.
    revalidatePath('/checkout')
    return {
      status: 'error',
      message:
        t('act.soldOutWhileDeciding'),
      fieldErrors: {},
    }
  }

  revalidatePath('/checkout')
  return {
    status: 'success',
    message: t('act.foundAnother'),
  }
}

/// B-172. "Move me to this size" — the branch's only way forward when the size
/// the renter had is genuinely gone.
///
/// The rate and the promotion are re-derived inside `relockAtSize` from the
/// facility's current view, never carried from the lost size and never taken
/// from this form: the browser names a unit TYPE and nothing else, so the worst
/// a hand-crafted post can do is ask for a size at this facility, which is what
/// the buttons offer anyway.
export async function relockAtSizeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { t } = await messages()
  const sessionId = String(formData.get('sessionId') ?? '')
  const unitTypeId = String(formData.get('unitTypeId') ?? '')
  const result = await relockAtSize(sessionId, unitTypeId)

  // Revalidate on every path, success or not: the panel decides what it offers
  // from `availableCount`, and a refusal is usually the moment that number
  // moved. Leaving the renter looking at a button that has just failed is the
  // dead end this whole branch exists to end.
  revalidatePath('/checkout')

  if (!result.ok) {
    const message =
      result.reason === 'too_late'
        ? t('act.pastPaymentNoSizeChange')
        : result.reason === 'sold_out'
          ? t('act.thatSizeGoneToo')
          : t('act.sizeMoveFailed')
    return { status: 'error', message, fieldErrors: {} }
  }

  return {
    status: 'success',
    message: t('act.sizeMoved', { note: result.changeNote }),
  }
}
