import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  localityFor,
  recordLeaseDeclarations,
  upsertTenantForCheckout,
  validateDeclarations,
  validateDetails,
} from '../apps/web/lib/checkout/details'

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

  it('gives every error a suggestion, not just an identification', () => {
    // 3.3.3. The renter reads these, so they have to say what to do.
    const errors = validateDetails({})
    expect(errors.email).toMatch(/send your lease/)
    expect(errors.phone).toMatch(/for example/)
    expect(errors.postalCode).toMatch(/for example 78704/)
    // State is only validated when the renter has opened the disclosure and
    // typed one — it is not a field on the step otherwise.
    expect(errors.state).toBeUndefined()
    expect(validateDetails({ ...VALID, state: 'Texas' }).state).toMatch(/for example TX/)
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
    expect(errors.postalCode).toMatch(/city and state myself/)
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
    expect(validateDeclarations({ altContactPhone: '555' }).altContactPhone).toBeDefined()
    expect(validateDeclarations({ altContactName: 'Pat Kin' }).altContactPhone).toBeDefined()
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
    const result = await upsertTenantForCheckout(VALID, AUSTIN)
    expect(result.created).toBe(true)

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: result.tenantId } })
    expect(tenant.passwordHash).toBeNull()
    expect(tenant.emailVerifiedAt).toBeNull()
    expect(tenant.state).toBe('TX')
  })

  it('reuses the account on a second move-in rather than making another', async () => {
    // FR-5.3: one account holds leases across facilities.
    const again = await upsertTenantForCheckout(
      { ...VALID, email: VALID.email.toUpperCase() },
      AUSTIN,
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
    )
    // B-112 moved the alternate contact to the lease step; it is additive
    // there for exactly the same reason.
    await recordLeaseDeclarations(
      (await prisma.tenant.findUniqueOrThrow({ where: { email } })).id,
      { altContactName: 'Impostor Alternate' },
    )

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { email } })
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

    await upsertTenantForCheckout({ ...VALID, email }, AUSTIN)

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { email } })
    expect(tenant.addressLine1).toBe(VALID.addressLine1)
    expect(tenant.postalCode).toBe('78704')
  })

  it('records a self-declared SCRA flag — now from the lease step (B-112)', async () => {
    const email = `scra-${suffix}@example.com`
    const result = await upsertTenantForCheckout({ ...VALID, email }, AUSTIN)
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
    const result = await upsertTenantForCheckout({ ...VALID, email }, AUSTIN)
    await recordLeaseDeclarations(result.tenantId, {})
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: result.tenantId } })
    expect(tenant.activeDutyMilitary).toBeNull()
  })
})
