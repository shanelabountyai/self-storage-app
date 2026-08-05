import { prisma, type AddressSource, type Prisma } from '@storage/db'

// PRD 01 US-706 / PRD 02 US-13. Contact details a tenant can change about
// themselves, and the address of record that has to survive them changing it.
//
// Despite the directory, this is not portal-only: `lib/admin/tenants.ts`
// (B-038, the counter's side of US-13) imports it wholesale rather than
// duplicating it — D-21 is explicit that every writer of an address goes
// through `recordAddressChange` here, portal or counter alike. Left in
// `lib/portal/` rather than moved, to avoid rewriting B-037's already-shipped
// import paths for a rename with no functional effect.

export type AddressInput = {
  addressLine1: string
  addressLine2?: string | null
  city: string
  state: string
  postalCode: string
  country?: string
}

export type AddressActor =
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'staff'; staffUserId: string }
  | { kind: 'system' }

export type FieldProblems = Record<string, string>

/// Validates an address hard enough to be worth mailing a legal notice to.
///
/// Deliberately not a format/deliverability check — no vendor does that here
/// (D-14 ships no geocoding provider) and a rejected-but-real address is
/// worse than an odd-looking one. This only refuses what cannot be posted at
/// all: a missing line, city, state or postcode.
export function validateAddress(input: AddressInput): FieldProblems {
  const problems: FieldProblems = {}
  if (!input.addressLine1?.trim()) problems.addressLine1 = 'Enter a street address.'
  if (!input.city?.trim()) problems.city = 'Enter a city.'
  if (!/^[A-Za-z]{2}$/.test(input.state?.trim() ?? '')) problems.state = 'Enter a 2-letter state code.'
  if (!/^\d{5}(-\d{4})?$/.test(input.postalCode?.trim() ?? '')) {
    problems.postalCode = 'Enter a ZIP code like 78704.'
  }
  return problems
}

export async function currentAddress(tenantId: string) {
  return prisma.tenantAddress.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function addressHistory(tenantId: string) {
  return prisma.tenantAddress.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })
}

function sameAddress(a: AddressInput, b: AddressInput | null): boolean {
  if (!b) return false
  return (
    a.addressLine1.trim() === b.addressLine1.trim() &&
    (a.addressLine2?.trim() ?? '') === (b.addressLine2?.trim() ?? '') &&
    a.city.trim() === b.city.trim() &&
    a.state.trim().toUpperCase() === b.state.trim().toUpperCase() &&
    a.postalCode.trim() === b.postalCode.trim()
  )
}

/// Appends an address of record.
///
/// THE way an address changes anywhere in this codebase — portal today,
/// counter at B-038, returned mail after that. A path that writes
/// `Tenant.addressLine1` directly instead leaves the history with a gap
/// exactly where a dispute would look (D-21).
///
/// The `Tenant.*` columns are updated in the same transaction as a cache of
/// the newest row, because the lease template, the comms context and the
/// admin screens all read them today. The history is what is authoritative.
///
/// A no-op change writes nothing: re-saving the same address should not add a
/// row that looks like the tenant moved.
export async function recordAddressChange(
  tenantId: string,
  input: AddressInput,
  source: AddressSource,
  actor: AddressActor,
): Promise<{ changed: boolean }> {
  const existing = await currentAddress(tenantId)
  if (sameAddress(input, existing)) return { changed: false }

  const data: Prisma.TenantAddressUncheckedCreateInput = {
    tenantId,
    addressLine1: input.addressLine1.trim(),
    addressLine2: input.addressLine2?.trim() || null,
    city: input.city.trim(),
    state: input.state.trim().toUpperCase(),
    postalCode: input.postalCode.trim(),
    country: input.country?.trim() || 'US',
    source,
    actorTenantId: actor.kind === 'tenant' ? actor.tenantId : null,
    actorStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
  }

  await prisma.$transaction(async (tx) => {
    await tx.tenantAddress.create({ data })
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        country: data.country,
      },
    })
  })
  return { changed: true }
}

/// Flags an address as undeliverable. Append-only like everything else here:
/// the flag goes on the row that came back, and the address itself is not
/// cleared — "we know this one is bad" is different from "we have none".
export async function flagReturnedMail(addressId: string): Promise<void> {
  await prisma.tenantAddress.update({
    where: { id: addressId },
    data: { returnedMailAt: new Date() },
  })
}

export type ContactDetails = {
  phone: string | null
  altContactName: string | null
  altContactPhone: string | null
  altContactEmail: string | null
}

/// Everything on the contact form that is not the email address and not the
/// address of record. Email has its own confirmed flow (lib/auth/email-change)
/// and the address has its own history above.
export async function updateContactDetails(
  tenantId: string,
  details: ContactDetails,
): Promise<FieldProblems> {
  const problems: FieldProblems = {}
  const phone = details.phone?.trim() || null
  const altPhone = details.altContactPhone?.trim() || null
  const altEmail = details.altContactEmail?.trim() || null

  // Loose on purpose: a phone number is a way to reach someone, not a
  // structured field, and international and extension formats are both real.
  if (phone && phone.replace(/\D/g, '').length < 10) {
    problems.phone = 'Enter a phone number with at least 10 digits.'
  }
  if (altPhone && altPhone.replace(/\D/g, '').length < 10) {
    problems.altContactPhone = 'Enter a phone number with at least 10 digits.'
  }
  if (altEmail && !altEmail.includes('@')) {
    problems.altContactEmail = 'Enter an email address.'
  }
  if (Object.keys(problems).length > 0) return problems

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      phone,
      altContactName: details.altContactName?.trim() || null,
      altContactPhone: altPhone,
      altContactEmail: altEmail,
    },
  })
  return {}
}
