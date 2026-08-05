import { prisma } from '@storage/db'
import type { FieldErrors } from '@/lib/admin/form-state'

// PRD 01 US-501 step 1 / FR-5.1. "Your details", and the implicit account.

export type DetailsInput = {
  firstName: string
  lastName: string
  email: string
  phone: string
  addressLine1: string
  addressLine2?: string
  city: string
  state: string
  postalCode: string
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
  if (!input.city?.trim()) errors.city = 'Enter your city.'
  if (!/^[A-Za-z]{2}$/.test(input.state?.trim() ?? '')) {
    errors.state = 'State must be a 2-letter code, for example TX.'
  }
  if (!/^\d{5}(-\d{4})?$/.test(input.postalCode?.trim() ?? '')) {
    errors.postalCode = 'Enter a 5-digit zip code, for example 78704.'
  }

  return errors
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
export async function upsertTenantForCheckout(input: DetailsInput): Promise<{
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
        city: input.city.trim(),
        state: input.state.trim().toUpperCase(),
        postalCode: input.postalCode.trim(),
        altContactName: input.altContactName?.trim() || null,
        altContactPhone: input.altContactPhone?.trim() || null,
        activeDutyMilitary: input.activeDutyMilitary ?? null,
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
    city: existing.city ?? input.city.trim(),
    state: existing.state ?? input.state.trim().toUpperCase(),
    postalCode: existing.postalCode ?? input.postalCode.trim(),
    altContactName: existing.altContactName ?? (input.altContactName?.trim() || null),
    altContactPhone: existing.altContactPhone ?? (input.altContactPhone?.trim() || null),
    activeDutyMilitary: existing.activeDutyMilitary ?? (input.activeDutyMilitary ?? null),
  }

  await prisma.tenant.update({ where: { id: existing.id }, data: fillBlanks })
  return { tenantId: existing.id, created: false }
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
