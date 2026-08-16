import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { addUnitToBasket, startCheckout, sessionByToken } from '../apps/web/lib/checkout/session'
import { buildLeaseDocuments, existingLeaseDocuments } from '../apps/web/lib/lease/build'
import { SMS_CONSENT_DISCLOSURE_VERSION } from '../apps/web/lib/checkout/details'
import { ELECTRONIC_RECORDS_CONSENT_VERSION } from '../apps/web/lib/lease/sign'
import { submitDetailsAction, signLeaseAction } from '../apps/web/app/(public)/checkout/actions'

// B-032 / PRD 05 CN-15, PRD 02 US-13. The consent records step 1 (SMS) and
// step 4 (notice-by-email) actually write, end to end through the real
// server actions — not just the shared `recordConsent` primitive.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)
const slug = `consent-${suffix}`

let facilityId = ''
let unitTypeId = ''

// Both actions end with `revalidatePath`, which — like `headers()` before the
// B-032 fix — only works inside a real Next.js request. In production a
// Server Action is always invoked with one; a direct call from a test harness
// is not, and that is specific to the harness, not something worth silencing
// in the action itself. The consent write these tests care about has already
// committed by the time that call runs, so this swallows exactly that one
// expected, harmless throw rather than changing the action.
async function callAction<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof Error && error.message.includes('static generation store')) return undefined
    throw error
  }
}

function detailsForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.set('firstName', 'Ada')
  form.set('lastName', 'Renter')
  form.set('email', `consent-${randomUUID()}@example.com`)
  form.set('phone', '512-555-0100')
  form.set('addressLine1', '2400 South Congress Ave')
  form.set('city', 'Austin')
  form.set('state', 'TX')
  form.set('postalCode', '78704')
  for (const [key, value] of Object.entries(overrides)) form.set(key, value)
  return form
}

describeDb('SMS consent at checkout step 1', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Consent Test',
        slug,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    for (let i = 0; i < 5; i++) {
      await prisma.unit.create({ data: { facilityId, unitTypeId, number: `S-${i}-${suffix}` } })
    }
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.consent.deleteMany({ where: { tenant: { email: { contains: 'consent-' } } } })
    await prisma.tenant.deleteMany({ where: { email: { contains: 'consent-' } } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  async function start() {
    const started = await startCheckout({ facilityId, unitTypeId, quotedRateCents: 12_900 })
    if (!started.ok) throw new Error('unreachable')
    return started
  }

  it('records granted when the box is checked, with the disclosure version', async () => {
    const started = await start()
    const email = `consent-checked-${randomUUID()}@example.com`
    await callAction(() => submitDetailsAction({} as never, detailsForm({ token: started.token, email, smsConsent: 'yes' })))

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { email } })
    const consent = await prisma.consent.findFirstOrThrow({
      where: { tenantId: tenant.id, channel: 'account_sms' },
    })
    expect(consent.state).toBe('granted')
    expect(consent.source).toBe('checkout_step_1')
    expect(consent.disclosureVersion).toBe(SMS_CONSENT_DISCLOSURE_VERSION)
  })

  it('records revoked, not silence, when the box is left unchecked', async () => {
    // CN-15's "Stored: ... checkbox state" — a decline is still evidence the
    // disclosure was shown, not the absence of a row.
    const started = await start()
    const email = `consent-unchecked-${randomUUID()}@example.com`
    await callAction(() => submitDetailsAction({} as never, detailsForm({ token: started.token, email })))

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { email } })
    const consent = await prisma.consent.findFirstOrThrow({
      where: { tenantId: tenant.id, channel: 'account_sms' },
    })
    expect(consent.state).toBe('revoked')
  })

  it('never sends SMS on this record alone — account_sms is distinct from notice_email', async () => {
    const started = await start()
    const email = `consent-scope-${randomUUID()}@example.com`
    await callAction(() => submitDetailsAction({} as never, detailsForm({ token: started.token, email, smsConsent: 'yes' })))

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { email } })
    expect(await prisma.consent.count({ where: { tenantId: tenant.id, channel: 'notice_email' } })).toBe(0)
  })
})

describeDb('notice-email consent at lease signing', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Notice Consent Test',
        slug: `notice-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10n ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    // B-106 part 5. `addUnitToBasket` prices a new line from the PUBLISHED
    // rate rather than from its caller — every other path in this file hands
    // `startCheckout` a `quotedRateCents` directly, which is why no rate
    // existed here before.
    await prisma.unitTypeRate.create({
      data: {
        facilityId,
        unitTypeId,
        streetRateCents: 14_900,
        webRateCents: 12_900,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      },
    })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.documentSignature.deleteMany({ where: { document: { facilityId } } })
    await prisma.document.deleteMany({ where: { facilityId } })
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.consent.deleteMany({ where: { tenant: { email: { contains: 'notice-sign-' } } } })
    await prisma.tenant.deleteMany({ where: { email: { contains: 'notice-sign-' } } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitTypeRate.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
    await prisma.$disconnect()
  })

  async function sessionAtLeaseStep() {
    // A unit for `startCheckout` to claim. The session then KEEPS whatever it
    // claimed rather than being repointed at this row: `CheckoutSession.unitId`
    // is unique, and repointing left the claimed unit held by the basket line
    // while its session pointed elsewhere — so the next `claimUnit` picked a
    // unit an older session's column still named, and the create collided.
    await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `L-${randomUUID().slice(0, 6)}` },
    })
    const email = `notice-sign-${randomUUID()}@example.com`
    const tenant = await prisma.tenant.create({
      data: { email, firstName: 'Ada', lastName: 'Renter' },
    })
    const started = await startCheckout({ facilityId, unitTypeId, quotedRateCents: 12_900 })
    if (!started.ok) throw new Error('unreachable')
    await prisma.checkoutSession.update({
      where: { id: started.sessionId },
      data: {
        step: 'lease',
        tenantId: tenant.id,
        data: {
          firstName: 'Ada',
          lastName: 'Renter',
          addressLine1: '2400 South Congress Ave',
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
        },
      },
    })
    const view = await sessionByToken(started.token)
    if (!view) throw new Error('unreachable')
    await buildLeaseDocuments(view)
    return { token: started.token, tenantId: tenant.id }
  }


  // D-53 (B-106 part 5). N agreements, ONE signature.
  it('signs every agreement in a multi-unit basket from a single signing action', async () => {
    const { token } = await sessionAtLeaseStep()

    // A second unit, added the way the step's own control adds one.
    await prisma.unit.create({
      data: { facilityId, unitTypeId, number: `L2-${randomUUID().slice(0, 6)}` },
    })
    const added = await addUnitToBasket(token, unitTypeId)
    if (!added.ok) throw new Error(`expected the add to succeed: ${JSON.stringify(added)}`)

    // Rebuilt because the basket grew — a line added after reaching this step
    // has no agreement yet, and the renter must not sign a set missing one.
    const view = await sessionByToken(token)
    if (!view) throw new Error('unreachable')
    await buildLeaseDocuments(view)

    const before = await existingLeaseDocuments(view)
    expect(before).toHaveLength(2)
    // Each agreement covers ONE unit, which is the whole point of D-53: an
    // auction of one unit must not cite a document covering the other.
    const numbers = view.units.map((line) => line.unitId)
    expect(new Set(numbers).size).toBe(2)

    const form = new FormData()
    form.set('token', token)
    form.set('typedName', 'Ada Renter')
    form.set('consented', 'yes')
    // Through `callAction` for the same reason every other action call here is:
    // `revalidatePath` throws outside a real Next request, and the signatures
    // this test cares about have already committed by the time it runs.
    await callAction(() => signLeaseAction({ status: 'idle' }, form))

    const after = await existingLeaseDocuments(view)
    expect(after).toHaveLength(2)
    // Both signed, by one action — not one signed and one left behind, which
    // is the partial state D-53 rejected N separate ceremonies to avoid.
    expect(after.every((entry) => entry.document.signature !== null)).toBe(true)
    // One signing moment for the set, so a receipt can state a single date.
    const [first, second] = after.map((entry) => entry.document.signature!.signedAt.getTime())
    expect(Math.abs(first - second)).toBeLessThan(5_000)
  })

  it('records notice_email consent, granted, when the lease is signed', async () => {
    const { token, tenantId } = await sessionAtLeaseStep()

    const form = new FormData()
    form.set('token', token)
    form.set('typedName', 'Ada Renter')
    form.set('consented', 'yes')
    await callAction(() => signLeaseAction({} as never, form))

    const consent = await prisma.consent.findFirstOrThrow({
      where: { tenantId, channel: 'notice_email' },
    })
    expect(consent.state).toBe('granted')
    expect(consent.source).toBe('checkout_lease_signing')
    expect(consent.disclosureVersion).toBe(ELECTRONIC_RECORDS_CONSENT_VERSION)
  })

  it('never reaches the consent write when the signature itself is refused', async () => {
    const { token, tenantId } = await sessionAtLeaseStep()

    const form = new FormData()
    form.set('token', token)
    form.set('typedName', 'Someone Else')
    form.set('consented', 'yes')
    const result = await signLeaseAction({} as never, form)
    expect(result.status).toBe('error')

    expect(await prisma.consent.count({ where: { tenantId, channel: 'notice_email' } })).toBe(0)
  })
})
