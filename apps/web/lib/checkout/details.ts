import { prisma } from '@storage/db'
import type { FieldErrors } from '@/lib/admin/form-state'
import { localityForZip } from '@/lib/geo/geocode'

// PRD 01 US-501 step 1 / FR-5.1. "Your details", and the implicit account.

export type DetailsInput = {
  firstName: string
  lastName: string
  email: string
  phone: string
  addressLine1: string
  addressLine2?: string
  /// B-112: normally DERIVED from `postalCode` rather than typed. Still on the
  /// type, and still accepted, because the dataset does not know every zip and
  /// a PO box is not where anybody lives — the step keeps a way to enter them
  /// by hand, behind a disclosure, for exactly those cases.
  city?: string
  state?: string
  postalCode: string
}

/// B-112. What moved off step 1 and onto the lease step.
///
/// Both belong with the agreement rather than with "who are you": the
/// alternate contact is who we write to when a notice bounces (lease clause 9,
/// "Your address"), and the active-duty declaration is a legal statement that
/// earns SCRA protections. Step 1 was fourteen fields on a phone immediately
/// after "Rent now", against §6.4's cap of seven.
export type LeaseDeclarations = {
  altContactName?: string
  altContactPhone?: string
  activeDutyMilitary?: boolean
}

/// PRD 05 CN-15 / §6.2. Unchecked by default (D-10: draft copy, attorney
/// review pending — PRD 05 Q2). Covers every element CN-15's AC lists: who is
/// texting, purpose, frequency, rates, opt-out, and that consent is not a
/// condition of rental — the last one matters most, since the checkbox sits
/// right next to fields that are required.
export const SMS_CONSENT_DISCLOSURE =
  'I agree to receive account and payment text messages (like payment reminders and gate codes) from this facility. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. This is not required to rent a unit.'

/// Bumped when the disclosure text above changes; recorded on every consent
/// row so a later dispute reads exactly what the renter was shown, not
/// whatever the copy currently says.
export const SMS_CONSENT_DISCLOSURE_VERSION = 'v1'

/// PRD 04 US-13 AC1 / US-9 AC3 (B-073). Unchecked by default, same as SMS
/// above. This is the ONLY thing that makes the abandonment follow-up (US-9)
/// legal to send at all — "no consent, no sequence" — since a checkout
/// session has no other consent-capture point before it might be abandoned.
export const MARKETING_EMAIL_CHECKOUT_DISCLOSURE =
  'Send me occasional emails about pricing and promotions. You can unsubscribe any time. This is not required to rent a unit.'

export const MARKETING_EMAIL_CHECKOUT_DISCLOSURE_VERSION = 'v1'

/// PRD 04 US-13 AC1/AC3, D-51 (B-123). The MARKETING text lane, and the reason
/// it is a fourth checkbox rather than a clause bolted onto the SMS one above.
///
/// TCPA treats promotional texts differently from transactional ones: they need
/// express WRITTEN consent, and that consent must be to receive marketing
/// specifically — a tenant agreeing to gate codes by text has not agreed to be
/// texted about a sale, and merging the two would make it impossible to show
/// which they actually said yes to. The two lanes stay separate all the way
/// down: separate consent channel, separate disclosure, separate version,
/// separate opt-out, separate check at send time (`smsConsentGranted`).
///
/// The FCC's own conditions are the reason each clause is here: it names the
/// sender, says what will be sent, states that consent is not a condition of
/// purchase, gives the opt-out, and warns about rates.
///
/// **DRAFT COPY, and this one is not merely the usual D-10 caveat.** PRD 04's
/// own AC3 defers the final wording to legal review (Open Questions Q5), and
/// nothing may send on this lane until that lands AND a separate A2P 10DLC
/// MARKETING campaign is registered (PRD 05 §6.3) — a transactional
/// registration does not cover promotional traffic. D-51 records both, and
/// records that the lane ships dark because of them.
export const MARKETING_SMS_DISCLOSURE =
  'I agree to receive marketing text messages about promotions and pricing from this facility at the number above. Consent is not a condition of renting. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help.'

/// Bumped when the text above changes — and it WILL change, because it is
/// awaiting the legal review AC3 names. Recorded on every consent row so a
/// dispute reads what the renter was actually shown; a version that never moved
/// while the copy did would make every row before the change unprovable.
export const MARKETING_SMS_DISCLOSURE_VERSION = 'v1-draft'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/// Deliberately loose. This is a trust boundary, so the job is to reject
/// obvious nonsense and typos, not to enforce a format that turns away a real
/// person with an unusual number. Anything with ten or more digits is dialable.
const PHONE_DIGITS = /\d/g

/// Validation with a *suggestion* per error, not just an identification
/// (3.3.3). The messages are the ones the renter reads, so they say what to do
/// rather than what went wrong.
export function validateDetails(input: Partial<DetailsInput>): FieldErrors {
  const errors: FieldErrors = {}

  if (!input.firstName?.trim()) errors.firstName = 'Enter your first name.'
  if (!input.lastName?.trim()) errors.lastName = 'Enter your last name.'

  const email = input.email?.trim() ?? ''
  if (!EMAIL.test(email)) {
    errors.email = 'Enter an email address we can send your lease and receipt to.'
  }

  const digits = (input.phone ?? '').match(PHONE_DIGITS)?.length ?? 0
  if (digits < 10) {
    errors.phone = 'Enter a mobile number with area code, for example 512-555-0100.'
  }

  if (!input.addressLine1?.trim()) errors.addressLine1 = 'Enter your street address.'

  // B-112. City and state come from the zip. They are only validated when the
  // renter has opened the disclosure and typed them, which is the escape hatch
  // for a zip the dataset does not carry.
  const typedCity = input.city?.trim() ?? ''
  const typedState = input.state?.trim() ?? ''
  const typedEither = typedCity !== '' || typedState !== ''

  if (!/^\d{5}(-\d{4})?$/.test(input.postalCode?.trim() ?? '')) {
    errors.postalCode = 'Enter a 5-digit zip code, for example 78704.'
  } else if (!typedEither && !localityForZip(input.postalCode!)) {
    // Not "invalid zip" — the zip may be perfectly real and simply newer than
    // the dataset. 3.3.3 wants the way out, not just the refusal.
    errors.postalCode =
      "We don't recognise that zip code. Open \u201cEnter my city and state myself\u201d below and fill them in."
  }

  if (typedEither) {
    if (!typedCity) errors.city = 'Enter your city.'
    if (!/^[A-Za-z]{2}$/.test(typedState)) {
      errors.state = 'State must be a 2-letter code, for example TX.'
    }
  }

  return errors
}

/// The city and state for a submission: whatever the renter typed if they used
/// the disclosure, and otherwise the zip's own. Returns null only when the zip
/// is unknown AND nothing was typed, which `validateDetails` has already
/// refused — so callers past validation can treat it as present.
export function localityFor(
  input: Partial<DetailsInput>,
): { city: string; state: string } | null {
  const city = input.city?.trim()
  const state = input.state?.trim().toUpperCase()
  if (city && state && /^[A-Z]{2}$/.test(state)) return { city, state }
  return localityForZip(input.postalCode ?? '')
}

/// Creates or links the tenant this checkout belongs to.
///
/// FR-5.1: email is the identifier and the account is created implicitly — no
/// password, no verification wall in front of a move-in. FR-5.3: one account
/// holds leases across facilities, so a returning renter is the same tenant.
///
/// **An existing tenant's stored details are never overwritten from here.**
/// This form is unauthenticated: anyone who knows an email address could
/// otherwise rewrite that person's address and alternate contact by starting a
/// checkout. Blank fields are filled in, because that is strictly additive;
/// anything already stored is left alone and the values entered here stay on
/// the checkout session, where staff can reconcile them at move-in.
export async function upsertTenantForCheckout(
  input: DetailsInput,
  locality: { city: string; state: string },
): Promise<{
  tenantId: string
  created: boolean
}> {
  const email = input.email.trim().toLowerCase()
  const existing = await prisma.tenant.findUnique({ where: { email } })

  if (!existing) {
    const tenant = await prisma.tenant.create({
      data: {
        email,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        phone: input.phone.trim(),
        addressLine1: input.addressLine1.trim(),
        addressLine2: input.addressLine2?.trim() || null,
        city: locality.city,
        state: locality.state,
        postalCode: input.postalCode.trim(),
      },
    })
    return { tenantId: tenant.id, created: true }
  }

  // Additive only. `??=` semantics, expressed as an explicit object so the
  // rule is visible rather than implied.
  const fillBlanks = {
    phone: existing.phone ?? input.phone.trim(),
    addressLine1: existing.addressLine1 ?? input.addressLine1.trim(),
    addressLine2: existing.addressLine2 ?? (input.addressLine2?.trim() || null),
    city: existing.city ?? locality.city,
    state: existing.state ?? locality.state,
    postalCode: existing.postalCode ?? input.postalCode.trim(),
  }

  await prisma.tenant.update({ where: { id: existing.id }, data: fillBlanks })
  return { tenantId: existing.id, created: false }
}

/// B-112. The two declarations that now arrive with the signature rather than
/// with the name.
///
/// Additive for the same reason `upsertTenantForCheckout` is: the checkout is
/// unauthenticated, so nothing here may overwrite what an existing tenant
/// already has on file. An alternate contact silently replaced by a stranger
/// mid-checkout is how a notice reaches the wrong person.
export async function recordLeaseDeclarations(
  tenantId: string,
  input: LeaseDeclarations,
): Promise<void> {
  const existing = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { altContactName: true, altContactPhone: true, activeDutyMilitary: true },
  })
  if (!existing) return

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      altContactName: existing.altContactName ?? (input.altContactName?.trim() || null),
      altContactPhone: existing.altContactPhone ?? (input.altContactPhone?.trim() || null),
      // B-121: additive here means "only ever towards protection", which is NOT
      // what `existing ?? input` did. A returning tenant who rented once
      // without ticking the box has `false` on file, not null — and `false ??
      // true` is `false`, so the declaration of somebody who had since deployed
      // was read, validated, written to the checkout session and then silently
      // dropped on the floor. The exact renter this whole item exists for.
      //
      // true wins whichever side it is on; a checkout can never take the
      // protection away, because an unauthenticated form must not be able to
      // clear a servicemember's flag by leaving a box unticked. Only the staff
      // path can go back the other way, and even that does not lift the hold.
      activeDutyMilitary:
        existing.activeDutyMilitary === true || input.activeDutyMilitary === true
          ? true
          : (existing.activeDutyMilitary ?? input.activeDutyMilitary ?? null),
    },
  })
}

/// The alternate contact is optional, but a number we cannot dial is worse than
/// none — it looks like a fallback and is not one.
export function validateDeclarations(input: LeaseDeclarations): FieldErrors {
  const errors: FieldErrors = {}
  const phone = input.altContactPhone?.trim() ?? ''
  if (phone !== '' && (phone.match(PHONE_DIGITS)?.length ?? 0) < 10) {
    errors.altContactPhone = 'Enter a number with area code, for example 512-555-0100, or leave it blank.'
  }
  if (input.altContactName?.trim() && phone === '') {
    errors.altContactPhone = 'Add a number for your alternate contact, or clear their name.'
  }
  return errors
}

/// Everything step 1 knows before the renter types, when they arrived from a
/// reservation. US-501: "If arriving from a reservation link, all known fields
/// are pre-filled."
export async function prefillFromReservation(reservationId: string | null): Promise<
  Partial<DetailsInput>
> {
  if (!reservationId) return {}
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { firstName: true, lastName: true, email: true, phone: true },
  })
  if (!reservation) return {}
  return {
    firstName: reservation.firstName,
    lastName: reservation.lastName,
    email: reservation.email,
    phone: reservation.phone ?? '',
  }
}
