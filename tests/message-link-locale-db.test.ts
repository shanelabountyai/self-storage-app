import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@storage/db'
import { mintCheckoutResumeToken } from '../apps/web/lib/checkout/resume-token'
import { mintUnsubscribeToken } from '../apps/web/lib/comms/unsubscribe-token'
import { messageLinkLocale } from '../apps/web/lib/i18n/link-locale'

// B-321. The three pages a message links to speak the language that message was
// written in, read from the record its token names — never the cookie's, and
// English (the no-request fallback) when the token names nothing.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let unitTypeId = ''
let tenantId = ''
let sessionId = ''
const cancelToken = `wl-${suffix}`
let originalSecret: string | undefined

describeDb('message link locale', () => {
  beforeAll(async () => {
    originalSecret = process.env.AUTH_SECRET
    process.env.AUTH_SECRET ??= 'test-secret-for-message-link-locale'

    const facility = await prisma.facility.create({
      data: {
        name: 'Link Locale Test',
        slug: `link-locale-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id
    unitTypeId = (
      await prisma.unitType.create({ data: { facilityId, name: `5x5 ${suffix}`, widthFt: 5, lengthFt: 5 } })
    ).id
    tenantId = (
      await prisma.tenant.create({
        data: { email: `link-locale-${suffix}@example.com`, firstName: 'Ana', lastName: 'Inquilina', preferredLocale: 'es' },
      })
    ).id
    sessionId = (
      await prisma.checkoutSession.create({
        data: {
          facilityId,
          unitTypeId,
          tenantId,
          quotedRateCents: 4_900,
          tokenHash: `link-locale-${suffix}`,
          lockExpiresAt: new Date(Date.now() + 60_000),
        },
      })
    ).id
    await prisma.waitlistEntry.create({
      data: { facilityId, unitTypeId, email: `wl-${suffix}@example.com`, preferredLocale: 'es', cancelToken },
    })
  })

  afterAll(async () => {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = originalSecret
    if (!hasDatabase) return
    await prisma.checkoutSession.deleteMany({ where: { facilityId } })
    await prisma.waitlistEntry.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.facility.deleteMany({ where: { id: facilityId } })
  })

  it("resolves /checkout/resume from the session's tenant", async () => {
    expect(await messageLinkLocale(`/checkout/resume/${mintCheckoutResumeToken(sessionId)}`)).toBe('es')
  })

  it("resolves /waitlist/cancel from the entry's own language", async () => {
    expect(await messageLinkLocale(`/waitlist/cancel/${cancelToken}`)).toBe('es')
  })

  it('resolves /unsubscribe from the language signed into the token', async () => {
    expect(await messageLinkLocale(`/unsubscribe/${mintUnsubscribeToken('a@example.com', 'es')}`)).toBe('es')
    expect(await messageLinkLocale(`/unsubscribe/${mintUnsubscribeToken('a@example.com', 'en')}`)).toBe('en')
  })

  it('falls back when the token names nothing, and ignores every other path', async () => {
    expect(await messageLinkLocale('/checkout/resume/not.real')).toBe('en')
    expect(await messageLinkLocale('/waitlist/cancel/no-such-token')).toBe('en')
    expect(await messageLinkLocale('/unsubscribe/not.real')).toBe('en')
    expect(await messageLinkLocale('/faq')).toBe('en')
  })
})
