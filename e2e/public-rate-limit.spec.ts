import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
import { PUBLIC_LIMITS } from '../apps/web/lib/http/rate-limit'
import { DEMO_PROMO_CODE } from '../apps/web/scripts/demo-credentials'

// SEC-04. The limits key on `x-forwarded-for`, and every other spec arrives as
// loopback, which is exempt — so without these two the sweep would never once
// run the refusing branch against the build that ships.
//
// The window is filled by writing the rows rather than by pressing "Rent now"
// five times: each real start holds a sandbox unit for 30 minutes, and the
// sweep already uses most of them. The address is unique per run, so nothing
// here is shared state.
const FACILITY = '/storage/tx/houston/demo-e2e'

async function fill(bucket: string, key: string, count: number): Promise<void> {
  await prisma.rateLimitEvent.createMany({
    data: Array.from({ length: count }, () => ({ bucket, key })),
  })
}

test('a checkout start past the per-IP limit holds no unit and says why (SEC-04)', async ({ request }) => {
  const ip = `e2e-${randomUUID()}`
  const unit = await prisma.unit.findFirstOrThrow({
    where: { facility: { slug: 'demo-e2e' }, status: 'available' },
    select: { unitTypeId: true },
  })
  await fill('checkout-start:ip', ip, PUBLIC_LIMITS.checkoutStartsPerIp)
  const sessionsBefore = await prisma.checkoutSession.count({ where: { unitTypeId: unit.unitTypeId } })

  const refused = await request.post(`${FACILITY}/rent`, {
    form: { unitTypeId: unit.unitTypeId },
    headers: { 'x-forwarded-for': ip },
    maxRedirects: 0,
  })
  expect(refused.headers().location).toContain(`${FACILITY}?throttled=1`)
  // Refused for this address without spending the size's own allowance.
  expect(
    await prisma.rateLimitEvent.count({
      where: { bucket: 'checkout-start:unit-type', key: unit.unitTypeId, at: { gte: new Date(Date.now() - 60_000) } },
    }),
  ).toBe(0)
  expect(await prisma.checkoutSession.count({ where: { unitTypeId: unit.unitTypeId } })).toBe(sessionsBefore)

  const notice = await request.get(`${FACILITY}?throttled=1`)
  expect(await notice.text()).toContain('Too many checkouts were started from your connection')
})

test('a promo code past the per-IP limit is not judged (SEC-04)', async ({ request }) => {
  const ip = `e2e-${randomUUID()}`
  const url = `${FACILITY}?promo=${DEMO_PROMO_CODE}`

  const judged = await (await request.get(url, { headers: { 'x-forwarded-for': ip } })).text()
  expect(judged).not.toContain('Too many codes tried')

  await fill('promo-check:ip', ip, PUBLIC_LIMITS.promoChecksPerIp)
  const refused = await (await request.get(url, { headers: { 'x-forwarded-for': ip } })).text()
  expect(refused).toContain('Too many codes tried')
})
