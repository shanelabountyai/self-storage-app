import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { upsertTenantForCheckout, validateDetails } from '../apps/web/lib/checkout/details'

// B-021 / PRD 01 US-501 step 1, FR-5.1.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

const VALID = {
  firstName: 'Ada',
  lastName: 'Renter',
  email: `details-${suffix}@example.com`,
  phone: '512-555-0100',
  addressLine1: '2400 South Congress Ave',
  city: 'Austin',
  state: 'TX',
  postalCode: '78704',
}

describe('validateDetails', () => {
  it('accepts a complete, ordinary set of details', () => {
    expect(validateDetails(VALID)).toEqual({})
  })

  it('gives every error a suggestion, not just an identification', () => {
    // 3.3.3. The renter reads these, so they have to say what to do.
    const errors = validateDetails({})
    expect(errors.email).toMatch(/send your lease/)
    expect(errors.phone).toMatch(/for example/)
    expect(errors.state).toMatch(/for example TX/)
    expect(errors.postalCode).toMatch(/for example 78704/)
  })

  it('accepts a phone number however the renter chooses to punctuate it', () => {
    // A trust boundary rejects nonsense, not unusual formatting.
    for (const phone of ['5125550100', '512-555-0100', '(512) 555-0100', '+1 512 555 0100']) {
      expect(validateDetails({ ...VALID, phone }).phone, phone).toBeUndefined()
    }
    expect(validateDetails({ ...VALID, phone: '555' }).phone).toBeDefined()
  })

  it('rejects a state that is not a two-letter code', () => {
    expect(validateDetails({ ...VALID, state: 'Texas' }).state).toBeDefined()
    expect(validateDetails({ ...VALID, state: 'T1' }).state).toBeDefined()
    expect(validateDetails({ ...VALID, state: 'tx' }).state).toBeUndefined()
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
    const result = await upsertTenantForCheckout(VALID)
    expect(result.created).toBe(true)

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: result.tenantId } })
    expect(tenant.passwordHash).toBeNull()
    expect(tenant.emailVerifiedAt).toBeNull()
    expect(tenant.state).toBe('TX')
  })

  it('reuses the account on a second move-in rather than making another', async () => {
    // FR-5.3: one account holds leases across facilities.
    const again = await upsertTenantForCheckout({ ...VALID, email: VALID.email.toUpperCase() })
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

    await upsertTenantForCheckout({
      ...VALID,
      email,
      firstName: 'Impostor',
      addressLine1: '99 Attacker Way',
      city: 'Nowhere',
      state: 'CA',
      postalCode: '90210',
      phone: '555-555-5555',
      altContactName: 'Impostor Alternate',
    })

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

    await upsertTenantForCheckout({ ...VALID, email })

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { email } })
    expect(tenant.addressLine1).toBe(VALID.addressLine1)
    expect(tenant.postalCode).toBe('78704')
  })

  it('records a self-declared SCRA flag', async () => {
    const email = `scra-${suffix}@example.com`
    const result = await upsertTenantForCheckout({ ...VALID, email, activeDutyMilitary: true })
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: result.tenantId } })
    // Self-declared, not verification. B-096's LeaseHold is what acts on it.
    expect(tenant.activeDutyMilitary).toBe(true)
  })

  it('leaves the flag null when never asked', async () => {
    const email = `noscra-${suffix}@example.com`
    const result = await upsertTenantForCheckout({ ...VALID, email })
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: result.tenantId } })
    expect(tenant.activeDutyMilitary).toBeNull()
  })
})
