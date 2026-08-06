import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  PAY_LINK_TTL_DAYS,
  attributePayment,
  checkPayLink,
  mintPayLink,
  payLinkUrl,
  revokePayLinksForLease,
} from '../apps/web/lib/portal/pay-links'

// B-051 / PRD 05 CN-4, FR-12. Pay-now magic links.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let tenantId = ''
let leaseId = ''
let unitTypeId = ''

async function mint(eventId?: string) {
  const link = await mintPayLink({ tenantId, leaseId, eventId })
  if (!link) throw new Error('mint failed')
  return link
}

describeDb('pay links', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: 'Pay Link Test',
        slug: `paylink-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
    })
    facilityId = facility.id

    const tenant = await prisma.tenant.create({
      data: { email: `paylink-${suffix}@example.com`, firstName: 'Ada', lastName: 'Renter' },
    })
    tenantId = tenant.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    const unit = await prisma.unit.create({ data: { facilityId, unitTypeId, number: 'P-1' } })
    const lease = await prisma.lease.create({
      data: {
        facilityId,
        tenantId,
        unitId: unit.id,
        status: 'active',
        startDate: new Date(),
        billingDay: 1,
        monthlyRateCents: 12_900,
      },
    })
    leaseId = lease.id
  })

  afterEach(async () => {
    await prisma.payLink.deleteMany({ where: { leaseId } })
    await prisma.lease.update({ where: { id: leaseId }, data: { status: 'active' } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.payLink.deleteMany({ where: { tenantId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
  })

  describe('the token itself', () => {
    it('carries well over the 128-bit floor CN-4 sets', async () => {
      const { token } = await mint()
      // 32 random bytes, base64url — 256 bits before encoding.
      expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    })

    it('never stores the plaintext anywhere', async () => {
      const { token } = await mint()
      const rows = await prisma.payLink.findMany({ where: { leaseId } })
      // A leaked database must give an attacker no working links.
      expect(rows).toHaveLength(1)
      expect(JSON.stringify(rows)).not.toContain(token)
    })

    it('is unguessable across mints', async () => {
      const tokens = new Set<string>()
      for (let i = 0; i < 5; i++) tokens.add((await mint()).token)
      expect(tokens.size).toBe(5)
    })

    it('builds a URL on the pay route, not the portal', async () => {
      const { token } = await mint()
      expect(payLinkUrl(token, 'https://example.com/')).toBe(`https://example.com/pay/${token}`)
    })

    it('defaults to a seven-day life', async () => {
      const { expiresAt } = await mint()
      const days = Math.round((expiresAt.getTime() - Date.now()) / 86_400_000)
      expect(days).toBe(PAY_LINK_TTL_DAYS)
    })
  })

  describe('checking a link', () => {
    it('accepts a live link and returns its tenant and lease', async () => {
      const { token } = await mint()
      const check = await checkPayLink(token)
      expect(check).toMatchObject({ ok: true, tenantId, leaseId })
    })

    it('stays usable — a tenant who comes back an hour later is not locked out', async () => {
      // Deliberately NOT single-use: CN-4 wants the balance as of page load, so
      // the link has to be revisitable for its whole life.
      const { token } = await mint()
      expect((await checkPayLink(token)).ok).toBe(true)
      expect((await checkPayLink(token)).ok).toBe(true)
      expect((await checkPayLink(token)).ok).toBe(true)
    })

    it('counts clicks, and counts the first one only once', async () => {
      const { token } = await mint()
      await checkPayLink(token)
      const afterFirst = await prisma.payLink.findFirstOrThrow({ where: { leaseId } })
      await checkPayLink(token)
      const afterSecond = await prisma.payLink.findFirstOrThrow({ where: { leaseId } })

      expect(afterSecond.clickCount).toBe(2)
      expect(afterSecond.firstClickedAt?.getTime()).toBe(afterFirst.firstClickedAt?.getTime())
      expect(afterSecond.lastClickedAt!.getTime()).toBeGreaterThanOrEqual(
        afterFirst.lastClickedAt!.getTime(),
      )
    })

    it('refuses an expired link', async () => {
      const { token } = await mint()
      await prisma.payLink.updateMany({
        where: { leaseId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      expect(await checkPayLink(token)).toEqual({ ok: false })
    })

    it('refuses a revoked link', async () => {
      const { token } = await mint()
      await revokePayLinksForLease(leaseId)
      expect(await checkPayLink(token)).toEqual({ ok: false })
    })

    it('refuses a token that never existed, and says nothing different about it', async () => {
      // Same answer for every failure mode — nothing to enumerate.
      expect(await checkPayLink('not-a-real-token')).toEqual({ ok: false })
      expect(await checkPayLink('')).toEqual({ ok: false })
    })

    it('refuses a link whose lease has ended, even if nothing revoked it', async () => {
      // Belt and braces: relying on the revocation alone would leave a window.
      const { token } = await mint()
      await prisma.lease.update({ where: { id: leaseId }, data: { status: 'ended' } })
      expect(await checkPayLink(token)).toEqual({ ok: false })
    })
  })

  describe('revocation', () => {
    it('kills every live link for the lease and reports how many', async () => {
      await mint()
      await mint()
      expect(await revokePayLinksForLease(leaseId)).toBe(2)
      // Idempotent: a second sweep finds nothing left to revoke.
      expect(await revokePayLinksForLease(leaseId)).toBe(0)
    })
  })

  describe('attribution', () => {
    it('ties a payment to the link that produced it', async () => {
      const { token } = await mint('evt_test')
      const check = await checkPayLink(token)
      if (!check.ok) throw new Error('unexpected')

      const payment = await prisma.payment.create({
        data: { facilityId, tenantId, amountCents: 12_900, method: 'card', status: 'pending' },
      })
      await attributePayment(check.payLinkId, payment.id)

      const link = await prisma.payLink.findUniqueOrThrow({ where: { id: check.payLinkId } })
      expect(link.paymentId).toBe(payment.id)
      // The event is what ties it back to the send log (CN-4).
      expect(link.eventId).toBe('evt_test')

      await prisma.payLink.updateMany({ where: { leaseId }, data: { paymentId: null } })
      await prisma.payment.delete({ where: { id: payment.id } })
    })

    it('keeps one live link per event rather than accumulating them', async () => {
      // Re-rendering the same message must not leave two working links for it.
      const first = await mint('evt_same')
      const second = await mint('evt_same')

      expect((await checkPayLink(first.token)).ok).toBe(false)
      expect((await checkPayLink(second.token)).ok).toBe(true)
    })

    it('gives different events different links', async () => {
      // A due-soon reminder and a decline notice must be tellable apart, or
      // neither can be credited with the payment.
      const a = await mint('evt_a')
      const b = await mint('evt_b')
      expect((await checkPayLink(a.token)).ok).toBe(true)
      expect((await checkPayLink(b.token)).ok).toBe(true)
      expect(a.token).not.toBe(b.token)
    })
  })
})
