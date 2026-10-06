import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import { requestMagicLink, requestPasswordReset } from '../apps/web/lib/auth/flows'
import {
  PUBLIC_LIMITS,
  mayCheckPromo,
  mayRequestAuthLink,
  mayStartCheckout,
  pruneRateLimitEvents,
} from '../apps/web/lib/http/rate-limit'

// SEC-04. The public "Rent now" POST holds a unit for 30 minutes with no
// account, and the promo box judges any string it is handed. Keys are unique
// per run: `rate_limit_event` is shared and nothing here cleans up after itself.
const ip = () => `test-${randomUUID()}`
const unitType = () => `ut-${randomUUID()}`

describe('public rate limits', () => {
  it('refuses a burst of checkout starts from one IP after the limit', async () => {
    const address = ip()
    // All at once, across different sizes: the parallel case is the one a
    // count-then-insert limiter lets straight through.
    const answers = await Promise.all(
      Array.from({ length: PUBLIC_LIMITS.checkoutStartsPerIp + 6 }, () =>
        mayStartCheckout(address, unitType()),
      ),
    )
    expect(answers.filter(Boolean).length).toBeLessThanOrEqual(PUBLIC_LIMITS.checkoutStartsPerIp)
    expect(await mayStartCheckout(address, unitType())).toBe(false)
    // Somebody else is unaffected.
    expect(await mayStartCheckout(ip(), unitType())).toBe(true)
  })

  it('caps starts against one unit type across many IPs, and a blocked IP does not spend it', async () => {
    const size = unitType()
    const noisy = ip()
    for (let i = 0; i < PUBLIC_LIMITS.checkoutStartsPerIp + 10; i++) await mayStartCheckout(noisy, size)
    expect(
      await prisma.rateLimitEvent.count({ where: { bucket: 'checkout-start:unit-type', key: size } }),
    ).toBe(PUBLIC_LIMITS.checkoutStartsPerIp)

    const rest = PUBLIC_LIMITS.checkoutStartsPerUnitType - PUBLIC_LIMITS.checkoutStartsPerIp
    for (let i = 0; i < rest; i++) expect(await mayStartCheckout(ip(), size)).toBe(true)
    expect(await mayStartCheckout(ip(), size)).toBe(false)
  })

  it('refuses promo checks from one IP after the limit', async () => {
    const address = ip()
    for (let i = 0; i < PUBLIC_LIMITS.promoChecksPerIp; i++) expect(await mayCheckPromo(address)).toBe(true)
    expect(await mayCheckPromo(address)).toBe(false)
  })

  // SEC-05. Through the real flows, so the guard cannot be unhooked unnoticed.
  it('stops minting sign-in and reset links for one address after the limit, across both kinds', async () => {
    const email = `sec05-${randomUUID()}@example.com`
    const tenant = await prisma.tenant.create({ data: { email, firstName: 'Ada', lastName: 'Renter' } })
    try {
      // Mixed case and from loopback: the email limit is the one with no exemption.
      for (let i = 0; i < PUBLIC_LIMITS.authLinksPerEmail + 3; i++) {
        if (i % 2) await requestMagicLink(email.toUpperCase(), 'tenant', '::1')
        else await requestPasswordReset(email, 'tenant', null)
      }
      expect(await prisma.authToken.count({ where: { subjectId: tenant.id } })).toBe(PUBLIC_LIMITS.authLinksPerEmail)
    } finally {
      await prisma.authToken.deleteMany({ where: { subjectId: tenant.id } })
      await prisma.tenant.delete({ where: { id: tenant.id } })
    }
  })

  it('refuses link requests from one IP across many addresses, without spending theirs', async () => {
    const address = ip()
    const victim = `sec05-${randomUUID()}@example.com`
    for (let i = 0; i < PUBLIC_LIMITS.authLinksPerIp; i++) {
      expect(await mayRequestAuthLink(`sec05-${randomUUID()}@example.com`, address)).toBe(true)
    }
    expect(await mayRequestAuthLink(victim, address)).toBe(false)
    expect(await prisma.rateLimitEvent.count({ where: { bucket: 'auth-link:email', key: victim } })).toBe(0)
    expect(await mayRequestAuthLink(victim, ip())).toBe(true)
  })

  // Under `next start` with no proxy every caller is `::1`, never null — which
  // is what the e2e sweep is, ~50 checkouts deep.
  it.each([null, '::1', '127.0.0.1'])('does not limit a caller with no remote address (%s)', async (local) => {
    const size = unitType()
    for (let i = 0; i < PUBLIC_LIMITS.checkoutStartsPerUnitType + 2; i++) {
      expect(await mayStartCheckout(local, size)).toBe(true)
    }
    for (let i = 0; i < PUBLIC_LIMITS.promoChecksPerIp + 2; i++) expect(await mayCheckPromo(local)).toBe(true)
    expect(await prisma.rateLimitEvent.count({ where: { key: size } })).toBe(0)
  })

  it('forgets attempts older than the window, and prunes them', async () => {
    const address = ip()
    const old = new Date(Date.now() - PUBLIC_LIMITS.promoWindowMs - 1000)
    await prisma.rateLimitEvent.createMany({
      data: Array.from({ length: PUBLIC_LIMITS.promoChecksPerIp }, () => ({
        bucket: 'promo-check:ip',
        key: address,
        at: old,
      })),
    })
    expect(await mayCheckPromo(address)).toBe(true)

    const ancient = ip()
    await prisma.rateLimitEvent.create({
      data: { bucket: 'promo-check:ip', key: ancient, at: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    })
    await pruneRateLimitEvents()
    expect(await prisma.rateLimitEvent.count({ where: { key: ancient } })).toBe(0)
  })
})
