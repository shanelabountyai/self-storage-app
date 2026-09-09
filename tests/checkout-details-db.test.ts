import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  localityFor,
  recordLeaseDeclarations,
  upsertTenantForCheckout,
  validateDeclarations,
  validateDetails,
  emailOptionalFor,
} from '../apps/web/lib/checkout/details'
import { LOCALES, dictionaryFor, translate } from '../apps/web/lib/i18n'

// B-021 / PRD 01 US-501 step 1, FR-5.1.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

// B-112: no city, no state. They come from the zip now, and a fixture that
// still supplied them would test a path the form no longer offers.
const VALID = {
  firstName: 'Ada',
  lastName: 'Renter',
  email: `details-${suffix}@example.com`,
  phone: '512-555-0100',
  addressLine1: '2400 South Congress Ave',
  postalCode: '78704',
}

const AUSTIN = { city: 'Austin', state: 'TX' }

describe('validateDetails', () => {
  it('accepts a complete, ordinary set of details', () => {
    expect(validateDetails(VALID)).toEqual({})
  })

  // ── D-111 / B-238: the counter's optional address ──────────────────────────
  //
  // The public site keeps email REQUIRED (FR-5.1 — it is how a self-serve
  // renter receives the lease, the gate code and the receipt). It becomes
  // optional only on a counter-started session, where staff hand those over in
  // person and the renter in front of them may genuinely have no address. The
  // first assertion is the one that matters most: if it ever goes green
  // unconditionally, every online renter has been invited to skip the field.
  it('still refuses a blank address on the public checkout', () => {
    expect(validateDetails({ ...VALID, email: '' }).email).toEqual({ key: 'err.email' })
  })

  it('accepts a blank address at the counter, which is what stops nobody@example.com', () => {
    expect(validateDetails({ ...VALID, email: '' }, { emailOptional: true })).toEqual({})
  })

  // Optional means "may be absent", never "may be nonsense" — a typo'd address
  // at the counter is still a typo, and accepting it would put the receipt and
  // the dunning ladder into the same hole the placeholder did.
  it('still format-checks an address that was typed at the counter', () => {
    expect(validateDetails({ ...VALID, email: 'not-an-address' }, { emailOptional: true }).email)
      .toEqual({ key: 'err.email' })
  })

  it('reads the counter from the session, not from the form', () => {
    expect(emailOptionalFor({ acquisitionSource: 'walk_in' })).toBe(true)
    expect(emailOptionalFor({ acquisitionSource: 'web' })).toBe(false)
    expect(emailOptionalFor({})).toBe(false)
    expect(emailOptionalFor(null)).toBe(false)
    expect(emailOptionalFor(undefined)).toBe(false)
  })

  it('names a message key rather than building a sentence (B-263)', () => {
    // 3.3.3. The renter reads these, so they have to say what to do — and the
    // renter may be reading Spanish, which is why the sentence is built by the
    // caller that knows the language rather than here.
    const errors = validateDetails({})
    expect(errors.email).toEqual({ key: 'err.email' })
    expect(errors.phone).toEqual({ key: 'err.phone' })
    expect(errors.postalCode).toEqual({ key: 'err.postalCode' })
    // State is only validated when the renter has opened the disclosure and
    // typed one — it is not a field on the step otherwise.
    expect(errors.state).toBeUndefined()
    expect(validateDetails({ ...VALID, state: 'Texas' }).state).toEqual({ key: 'err.state' })
  })

  it('resolves to a suggestion in whichever language the renter is reading', () => {
    // The defect B-263 exists for: a Spanish form corrected in English at the
    // one moment 3.3.3 wants an instruction the renter can act on.
    const errors = validateDetails({})
    for (const locale of LOCALES) {
      const dict = dictionaryFor(locale)
      for (const [field, message] of Object.entries(errors)) {
        expect(translate(dict, message.key, message.vars), `${locale} ${field}`).not.toMatch(
          /[{}]/,
        )
      }
    }
    expect(translate(dictionaryFor('en'), errors.postalCode!.key)).toMatch(/for example 78704/)
    expect(translate(dictionaryFor('es'), errors.postalCode!.key)).toMatch(/por ejemplo 78704/)
  })

  it('accepts a phone number however the renter chooses to punctuate it', () => {
    // A trust boundary rejects nonsense, not unusual formatting.
    for (const phone of ['5125550100', '512-555-0100', '(512) 555-0100', '+1 512 555 0100']) {
      expect(validateDetails({ ...VALID, phone }).phone, phone).toBeUndefined()
    }
    expect(validateDetails({ ...VALID, phone: '555' }).phone).toBeDefined()
  })

  it('rejects a typed state that is not a two-letter code', () => {
    // The reason the input went away: a renter typing "Texas" beside the zip
    // that already says TX was rejected after submitting, by a rule the form
    // invented for itself.
    expect(validateDetails({ ...VALID, city: 'Austin', state: 'Texas' }).state).toBeDefined()
    expect(validateDetails({ ...VALID, city: 'Austin', state: 'T1' }).state).toBeDefined()
    expect(validateDetails({ ...VALID, city: 'Austin', state: 'tx' }).state).toBeUndefined()
  })

  it('needs no city or state at all, because the zip carries both', () => {
    expect(validateDetails(VALID)).toEqual({})
    expect(localityFor(VALID)).toEqual(AUSTIN)
  })

  it('refuses a zip the dataset does not know, and says how to get past it', () => {
    // 00000 is syntactically a zip and is not a place. The renter may still be
    // right — new zips, retired zips, PO-box ranges — so the message is a way
    // through rather than a flat refusal (3.3.3).
    const errors = validateDetails({ ...VALID, postalCode: '00000' })
    expect(errors.postalCode).toEqual({ key: 'err.postalCodeUnknown' })
  })

  it('lets a typed city and state override the zip', () => {
    const typed = { ...VALID, postalCode: '00000', city: 'Bagby', state: 'tx' }
    expect(validateDetails(typed)).toEqual({})
    // Upper-cased on the way out, so "tx" and "TX" store identically.
    expect(localityFor(typed)).toEqual({ city: 'Bagby', state: 'TX' })
  })

  it('asks for the other half when only one of the pair is typed', () => {
    expect(validateDetails({ ...VALID, city: 'Austin' }).state).toBeDefined()
    expect(validateDetails({ ...VALID, state: 'TX' }).city).toBeDefined()
  })
})

describe('validateDeclarations (B-112)', () => {
  it('accepts nothing at all — both are optional', () => {
    expect(validateDeclarations({})).toEqual({})
  })

  it('refuses an alternate contact we could not actually call', () => {
    // A number we cannot dial is worse than none: it looks like a fallback and
    // is not one, and this is the contact a bounced lien notice falls back to.
    expect(validateDeclarations({ altContactPhone: '555' }).altContactPhone).toEqual({
      key: 'err.altContactPhone',
    })
    expect(validateDeclarations({ altContactName: 'Pat Kin' }).altContactPhone).toEqual({
      key: 'err.altContactPhoneMissing',
    })
    expect(
      validateDeclarations({ altContactName: 'Pat Kin', altContactPhone: '512-555-0199' }),
    ).toEqual({})
  })

  it('accepts both zip forms', () => {
    expect(validateDetails({ ...VALID, postalCode: '78704-1234' }).postalCode).toBeUndefined()
    expect(validateDetails({ ...VALID, postalCode: '787' }).postalCode).toBeDefined()
  })
})

describeDb('implicit account creation', () => {
  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.tenant.deleteMany({ where: { email: { contains: suffix } } })
    await prisma.$disconnect()
  })

  it('creates an account with no password and no verification wall', async () => {
    // FR-5.1: email is the identifier, the account is implicit, and nothing
    // blocks a move-in on verifying it.
    const result = await upsertTenantForCheckout(VALID, AUSTIN, 'en')
    expect(result.created).toBe(true)

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: result.tenantId } })
    expect(tenant.passwordHash).toBeNull()
    expect(tenant.emailVerifiedAt).toBeNull()
    expect(tenant.state).toBe('TX')
  })

  // ── D-111 / B-238: the blank address, and the trap under it ────────────────
  //
  // This is the assertion the whole row turns on. A blank address is a FACT
  // (this renter has no email), and the reflex fix — reuse the "existing"
  // tenant whose email matches — matches every other no-email renter at every
  // facility, because they all match each other. That would collapse the
  // contractor, the elderly tenant and the next twenty walk-ins into ONE tenant
  // record holding all of their leases, all of their ledgers and all of their
  // gate codes. It would also pass a test that only counted rows.
  it('gives every renter with no address their own record, never a shared one', async () => {
    const first = await upsertTenantForCheckout({ ...VALID, email: '' }, AUSTIN, 'en')
    const second = await upsertTenantForCheckout(
      { ...VALID, email: '', firstName: 'Bruno' },
      AUSTIN,
      'en',
    )

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.tenantId).not.toBe(first.tenantId)

    // Null, not '' — an empty string is an address, and it would make every
    // one of these renters share one again through the ordinary lookup.
    const rows = await prisma.tenant.findMany({
      where: { id: { in: [first.tenantId, second.tenantId] } },
      select: { email: true },
    })
    expect(rows.map((row) => row.email)).toEqual([null, null])

    await prisma.tenant.deleteMany({
      where: { id: { in: [first.tenantId, second.tenantId] } },
    })
  })

  it('reuses the account on a second move-in rather than making another', async () => {
    // FR-5.3: one account holds leases across facilities.
    const again = await upsertTenantForCheckout(
      { ...VALID, email: VALID.email.toUpperCase() },
      AUSTIN,
      'en',
    )
    expect(again.created).toBe(false)
    expect(await prisma.tenant.count({ where: { email: VALID.email } })).toBe(1)
  })

  it('never overwrites details an existing account already has', async () => {
    // The security property. This form is unauthenticated: without this rule
    // anyone who knows an email address could rewrite that person's address and
    // alternate contact by starting a checkout.
    const email = `overwrite-${suffix}@example.com`
    await prisma.tenant.create({
      data: {
        email,
        firstName: 'Real',
        lastName: 'Tenant',
        addressLine1: '1 Real Street',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        phone: '512-555-0111',
        altContactName: 'Real Alternate',
      },
    })

    await upsertTenantForCheckout(
      {
        ...VALID,
        email,
        firstName: 'Impostor',
        addressLine1: '99 Attacker Way',
        postalCode: '90210',
        phone: '555-555-5555',
      },
      { city: 'Nowhere', state: 'CA' },
      'en',
    )
    // B-112 moved the alternate contact to the lease step; it is additive
    // there for exactly the same reason.
    await recordLeaseDeclarations(
      (await prisma.tenant.findFirstOrThrow({ where: { email } })).id,
      { altContactName: 'Impostor Alternate' },
    )

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { email } })
    expect(tenant.addressLine1).toBe('1 Real Street')
    expect(tenant.city).toBe('Austin')
    expect(tenant.state).toBe('TX')
    expect(tenant.postalCode).toBe('78704')
    expect(tenant.phone).toBe('512-555-0111')
    expect(tenant.altContactName).toBe('Real Alternate')
  })

  it('fills in blanks, because that is strictly additive', async () => {
    const email = `blanks-${suffix}@example.com`
    await prisma.tenant.create({ data: { email, firstName: 'Sparse', lastName: 'Record' } })

    await upsertTenantForCheckout({ ...VALID, email }, AUSTIN, 'en')

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { email } })
    expect(tenant.addressLine1).toBe(VALID.addressLine1)
    expect(tenant.postalCode).toBe('78704')
  })

  it('records a self-declared SCRA flag — now from the lease step (B-112)', async () => {
    const email = `scra-${suffix}@example.com`
    const result = await upsertTenantForCheckout({ ...VALID, email }, AUSTIN, 'en')
    // Step 1 no longer asks, so it is still null at this point.
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: result.tenantId } }))
        .activeDutyMilitary,
    ).toBeNull()

    await recordLeaseDeclarations(result.tenantId, { activeDutyMilitary: true })
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: result.tenantId } })
    // Self-declared, not verification. B-096's LeaseHold is what acts on it.
    expect(tenant.activeDutyMilitary).toBe(true)
  })

  it('leaves the flag null when never asked', async () => {
    const email = `noscra-${suffix}@example.com`
    const result = await upsertTenantForCheckout({ ...VALID, email }, AUSTIN, 'en')
    await recordLeaseDeclarations(result.tenantId, {})
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: result.tenantId } })
    expect(tenant.activeDutyMilitary).toBeNull()
  })

  // ── B-261. The language every future email and text goes out in. ──────────

  it('stores the language the renter checked out in', async () => {
    const email = `locale-new-${suffix}@example.com`
    const result = await upsertTenantForCheckout({ ...VALID, email }, AUSTIN, 'es')
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: result.tenantId } })
    expect(tenant.preferredLocale).toBe('es')
  })

  it('never switches an existing tenant’s language from this unauthenticated form', async () => {
    // The same security property the address rule above has, and it matters
    // for the same reason: anyone who knows an email address could otherwise
    // start a checkout and change the language every future message to that
    // account is written in — including the dunning ladder, where being
    // unreadable is the whole harm.
    const email = `locale-existing-${suffix}@example.com`
    await prisma.tenant.create({
      data: { email, firstName: 'Real', lastName: 'Tenant', preferredLocale: 'es' },
    })

    await upsertTenantForCheckout({ ...VALID, email }, AUSTIN, 'en')

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { email } })
    expect(tenant.preferredLocale).toBe('es')
  })

  it('fills in the language for a returning tenant who has never stated one', async () => {
    // Additive, exactly like the blank address fields beside it — null means
    // "never told us", so there is nothing to overwrite.
    const email = `locale-blank-${suffix}@example.com`
    await prisma.tenant.create({
      data: { email, firstName: 'Real', lastName: 'Tenant' },
    })
    expect(
      (await prisma.tenant.findFirstOrThrow({ where: { email } })).preferredLocale,
    ).toBeNull()

    await upsertTenantForCheckout({ ...VALID, email }, AUSTIN, 'es')

    expect((await prisma.tenant.findFirstOrThrow({ where: { email } })).preferredLocale).toBe('es')
  })
})
