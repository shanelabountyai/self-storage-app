import { prisma } from '@storage/db'
import type { KeyedFieldErrors } from '@/lib/admin/form-state'
import { localityForZip } from '@/lib/geo/geocode'
import type { Locale } from '@/lib/i18n'

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

// B-259 (D-125). The three consent disclosures that used to live here moved
// to `lib/consent/disclosures.ts`, where each one's text and its version are a
// single object per language. They were split across two files and six flat
// constants, which is what let B-090f's Spanish checkout reach step 1 with
// English disclosures on it and no way to record which words were shown.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/// Deliberately loose. This is a trust boundary, so the job is to reject
/// obvious nonsense and typos, not to enforce a format that turns away a real
/// person with an unusual number. Anything with ten or more digits is dialable.
const PHONE_DIGITS = /\d/g

/// **Whether this checkout may omit an email address — D-111 / B-238.**
///
/// True for a counter-started session and nothing else. `startWalkInMoveInAction`
/// stamps `acquisitionSource: 'walk_in'` on the session and hands staff into
/// this same public checkout (deliberately — one set of move-in rules), so that
/// stamp is the only fact distinguishing the two, and it is already trusted for
/// how the lease reports its channel.
///
/// **The public site keeps email required, and that is the point of scoping it.**
/// Online, the address is how the renter receives the lease they just signed,
/// the gate code they need to get in, and the receipt — FR-5.1 makes it the
/// identifier for exactly that reason, and an optional field there would invite
/// every self-serve renter to skip it. At the counter none of that holds: staff
/// hand over the gate code and print the receipt, and the renter standing there
/// may genuinely not have an address. That renter is who B-238 is about.
///
/// One definition, read by the step that renders the field and the action that
/// validates it, so the form and the rule cannot disagree about which it is.
export function emailOptionalFor(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { acquisitionSource?: unknown }).acquisitionSource === 'walk_in'
  )
}

/// Validation with a *suggestion* per error, not just an identification
/// (3.3.3). The messages are the ones the renter reads, so they say what to do
/// rather than what went wrong.
///
/// B-263: message KEYS, not messages. This runs on the Spanish checkout as
/// well as the English one, and it is pure — it has no request and no
/// dictionary, so the caller resolves them.
export function validateDetails(
  input: Partial<DetailsInput>,
  /// D-111 / B-238. True only for a counter-started session (see
  /// `emailOptionalFor`). A blank address is then accepted as a fact — this
  /// renter has no email — instead of being refused into
  /// `nobody@example.com`. A typed one is still format-checked: optional
  /// means "may be absent", never "may be nonsense".
  options: { emailOptional?: boolean } = {},
): KeyedFieldErrors {
  const errors: KeyedFieldErrors = {}

  if (!input.firstName?.trim()) errors.firstName = { key: 'err.firstName' }
  if (!input.lastName?.trim()) errors.lastName = { key: 'err.lastName' }

  const email = input.email?.trim() ?? ''
  if (!(options.emailOptional && email === '') && !EMAIL.test(email)) {
    errors.email = { key: 'err.email' }
  }

  const digits = (input.phone ?? '').match(PHONE_DIGITS)?.length ?? 0
  if (digits < 10) {
    errors.phone = { key: 'err.phone' }
  }

  if (!input.addressLine1?.trim()) errors.addressLine1 = { key: 'err.addressLine1' }

  // B-112. City and state come from the zip. They are only validated when the
  // renter has opened the disclosure and typed them, which is the escape hatch
  // for a zip the dataset does not carry.
  const typedCity = input.city?.trim() ?? ''
  const typedState = input.state?.trim() ?? ''
  const typedEither = typedCity !== '' || typedState !== ''

  if (!/^\d{5}(-\d{4})?$/.test(input.postalCode?.trim() ?? '')) {
    errors.postalCode = { key: 'err.postalCode' }
  } else if (!typedEither && !localityForZip(input.postalCode!)) {
    // Not "invalid zip" — the zip may be perfectly real and simply newer than
    // the dataset. 3.3.3 wants the way out, not just the refusal. The message
    // quotes the disclosure's own label, in whichever language it was rendered.
    errors.postalCode = { key: 'err.postalCodeUnknown' }
  }

  if (typedEither) {
    if (!typedCity) errors.city = { key: 'err.city' }
    if (!/^[A-Za-z]{2}$/.test(typedState)) {
      errors.state = { key: 'err.state' }
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

/// **B-271 / D-111. The tenant an address already belongs to, when that tenant
/// is somebody ELSE.**
///
/// D-111 dropped the unique constraint so "a husband and wife may each hold an
/// account on one household inbox", and said the counter "says so at the moment
/// it creates the second account". B-238 built the schema half and left this
/// one, so the sentence was unkeepable in both directions: staff could not
/// create the second account at all, and the form put the walk-in's lease onto
/// the spouse's account without saying a word.
///
/// **The name is what separates the two cases, and it is the only fact on the
/// form that can.** A returning renter types the address AND the name that
/// already sit on the record, and linking them is FR-5.3 working — interrupting
/// that with a confirm on every repeat move-in is how a warning gets clicked
/// through. A DIFFERENT name on a known address is the one D-111 is about, and
/// it is the one that silently attached a lease, a ledger and a gate code to
/// the wrong person.
///
/// Two people of the same name on one inbox link, as they did before. That is
/// the status quo, not a regression, and no field on this form distinguishes
/// them.
///
/// `orderBy` matches `upsertTenantForCheckout`'s, so the record named here is
/// the record that would be linked to. Anything else would echo one tenant and
/// attach to another.
export async function otherTenantOnEmail(
  rawEmail: string,
  name: { firstName: string; lastName: string },
): Promise<{ id: string; firstName: string; lastName: string } | null> {
  const email = rawEmail.trim().toLowerCase()
  if (email === '') return null

  const existing = await prisma.tenant.findFirst({
    where: { email },
    orderBy: { createdAt: 'asc' },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!existing) return null

  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  if (same(existing.firstName, name.firstName) && same(existing.lastName, name.lastName)) {
    return null
  }
  return existing
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
  /// B-261. The language step 1 was RENDERED in — the same value B-259 stamps
  /// on the consent rows, from the FORM rather than the cookie, so a renter
  /// who used the header toggle between the render and the submit is recorded
  /// against the language they actually read.
  locale: Locale,
  /// B-271 / D-111. Staff have looked at `otherTenantOnEmail`'s answer and said
  /// this is a DIFFERENT person on the same household inbox — so create rather
  /// than link, which is the case D-111 dropped the unique constraint for.
  ///
  /// Only ever true on a counter session that came back through the confirm
  /// step; the public form has no way to set it (see `submitDetailsAction`),
  /// because linking a returning renter to their own account is FR-5.3 and the
  /// public form is unauthenticated.
  options: { separateAccount?: boolean } = {},
): Promise<{
  tenantId: string
  created: boolean
}> {
  const email = input.email.trim().toLowerCase()

  // **A blank address links to nobody and always creates — D-111 / B-238.**
  //
  // `email` is optional only on a counter-started session (`emailOptionalFor`),
  // and there it is a fact rather than a gap: this renter has no address. There
  // is consequently nothing to match on, and matching on "no address" would be
  // the worst possible identifier — every no-email renter at every facility
  // would collapse into one tenant holding all of their leases. The renter in
  // front of staff gets their own record; if they are a returning tenant, the
  // tenant screen's merge is the deliberate way to say so.
  //
  // `findFirst`, not `findUnique`: the column is no longer unique, so two
  // tenants may share a household inbox. The oldest match is the one an
  // unauthenticated form may add to, which is the conservative half — this
  // function is additive-only (see below), so linking to the earlier record can
  // fill blanks on it and can overwrite nothing.
  const existing = email === '' || options.separateAccount
    ? null
    : await prisma.tenant.findFirst({ where: { email }, orderBy: { createdAt: 'asc' } })

  if (!existing) {
    const tenant = await prisma.tenant.create({
      data: {
        email: email === '' ? null : email,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        phone: input.phone.trim(),
        addressLine1: input.addressLine1.trim(),
        addressLine2: input.addressLine2?.trim() || null,
        city: locality.city,
        state: locality.state,
        postalCode: input.postalCode.trim(),
        preferredLocale: locale,
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
    // B-261, and additive for exactly the reason the rest of this object is:
    // this form is unauthenticated, so anyone who knows an email address must
    // not be able to switch the language every future email and text to that
    // account goes out in — including the dunning ladder, which is the one
    // where being unreadable matters most.
    //
    // Null is what makes that possible: it means "never told us" rather than
    // "chose English" (see `Tenant.preferredLocale`), so a returning renter
    // who has never expressed a preference gets one filled in from the
    // language they just rented in, and one who HAS keeps theirs. The portal
    // control is the authenticated way to change it.
    preferredLocale: existing.preferredLocale ?? locale,
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
export function validateDeclarations(input: LeaseDeclarations): KeyedFieldErrors {
  const errors: KeyedFieldErrors = {}
  const phone = input.altContactPhone?.trim() ?? ''
  if (phone !== '' && (phone.match(PHONE_DIGITS)?.length ?? 0) < 10) {
    errors.altContactPhone = { key: 'err.altContactPhone' }
  }
  if (input.altContactName?.trim() && phone === '') {
    errors.altContactPhone = { key: 'err.altContactPhoneMissing' }
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
