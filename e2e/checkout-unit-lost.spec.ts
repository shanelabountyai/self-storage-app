import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
import { startCheckout } from '../apps/web/lib/checkout/session'

// B-172 / PRD 01 FR-4.1. The unit-lost branch, when the size itself has gone.
//
// The first time this branch has been scanned at all: B-149 built it and
// deferred the scan to B-156, which deferred it too, because it is a STATE and
// the scan contract is route-keyed — it renders only for a lapsed session whose
// size has since sold out, which no route can be visited to reach.
//
// Everything here is its own disposable fixture: a facility, two unit types and
// three units created by this file and deleted by it. That is deliberate rather
// than lazy. Reaching this state means taking a whole size to zero available,
// and doing that to shared demo inventory is precisely the unscoped mutation
// B-120 forbids — every other checkout spec would then fail with "sold out" for
// a reason that has nothing to do with the code. Isolated, it also needs none
// of B-120's three disciplines and is repeatable on an un-reseeded database.
//
// The fixture is per PROJECT, not per file: desktop-chrome and mobile-chrome
// run the same file concurrently, and a single shared slug means both `beforeAll`
// hooks race to create the same facility — one wins and the other dies on the
// unique index. A slug per project gives each its own inventory and lets the
// branch be checked at both widths rather than skipped at one.
let slug = ''
let facilityId = ''
let smallTypeId = ''
let biggerTypeId = ''
let token = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({}, testInfo) => {
  slug = `e2e-unit-lost-${testInfo.project.name}`
  await cleanUp()

  const facility = await prisma.facility.create({
    data: {
      name: 'E2E — Unit Lost',
      slug,
      // Amarillo, deliberately: the search specs rank against 78704, and a
      // facility 500 miles away cannot enter their assertions.
      addressLine1: '1 Test Way',
      city: 'Amarillo',
      state: 'TX',
      postalCode: '79101',
      timezone: 'America/Chicago',
      phone: '(806) 555-0199',
    },
  })
  facilityId = facility.id

  const rate = (unitTypeId: string, street: number, web: number) =>
    prisma.unitTypeRate.create({
      data: {
        facilityId,
        unitTypeId,
        streetRateCents: street,
        webRateCents: web,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      },
    })

  const small = await prisma.unitType.create({
    data: { facilityId, name: 'Standard', widthFt: 10, lengthFt: 10 },
  })
  smallTypeId = small.id
  await rate(smallTypeId, 14_900, 12_900)

  // A different NAME as well as a different size: `(facilityId, name)` is
  // unique, and two "Standard"s at one facility is a fixture that cannot exist.
  const bigger = await prisma.unitType.create({
    data: { facilityId, name: 'Large', widthFt: 10, lengthFt: 15 },
  })
  biggerTypeId = bigger.id
  await rate(biggerTypeId, 17_900, 14_900)

  await prisma.unit.create({
    data: { facilityId, unitTypeId: smallTypeId, number: 'S-1', status: 'available' },
  })
  await prisma.unit.createMany({
    data: [
      { facilityId, unitTypeId: biggerTypeId, number: 'L-1', status: 'available' },
      { facilityId, unitTypeId: biggerTypeId, number: 'L-2', status: 'available' },
    ],
  })
})

test.afterAll(async () => {
  await cleanUp()
})

async function cleanUp(): Promise<void> {
  const existing = await prisma.facility.findUnique({ where: { slug }, select: { id: true } })
  if (!existing) return
  const sessions = await prisma.checkoutSession.findMany({
    where: { facilityId: existing.id },
    select: { id: true },
  })
  await prisma.checkoutSessionUnit.deleteMany({
    where: { checkoutSessionId: { in: sessions.map((row) => row.id) } },
  })
  await prisma.checkoutSession.deleteMany({ where: { facilityId: existing.id } })
  await prisma.unit.deleteMany({ where: { facilityId: existing.id } })
  await prisma.unitTypeRate.deleteMany({ where: { facilityId: existing.id } })
  await prisma.unitType.deleteMany({ where: { facilityId: existing.id } })
  await prisma.facility.delete({ where: { id: existing.id } })
}

/// Starts a real checkout on the small size, then takes that size to zero and
/// lets the lock lapse — which is the only way this branch is reachable.
async function loseTheUnit(): Promise<void> {
  // Reset first: these tests run serially against one fixture, and the previous
  // one leaves the small size occupied — which is the state it exists to
  // produce, and the state that would stop the next `startCheckout` cold.
  const sessions = await prisma.checkoutSession.findMany({
    where: { facilityId },
    select: { id: true },
  })
  await prisma.checkoutSessionUnit.deleteMany({
    where: { checkoutSessionId: { in: sessions.map((row) => row.id) } },
  })
  await prisma.checkoutSession.deleteMany({ where: { facilityId } })
  await prisma.unit.updateMany({ where: { facilityId }, data: { status: 'available' } })

  const started = await startCheckout({ facilityId, unitTypeId: smallTypeId, quotedRateCents: 12_900 })
  if (!started.ok) throw new Error('fixture could not start a checkout')
  token = started.token

  // The size is now genuinely gone: its one unit is the one this session took,
  // and `availableCount` counts nothing else.
  await prisma.unit.updateMany({ where: { unitTypeId: smallTypeId }, data: { status: 'occupied' } })
  await prisma.checkoutSession.update({
    where: { id: started.sessionId },
    data: { lockExpiresAt: new Date(Date.now() - 60_000) },
  })
}

test('the unit-lost branch is readable, and its sizes are controls rather than a display', async ({
  page,
}) => {
  await loseTheUnit()
  await page.goto(`/checkout?token=${encodeURIComponent(token)}`)

  await expect(page.getByRole('heading', { name: "We couldn't keep that unit" })).toBeVisible()

  // 2.4.4 / 2.4.6. The sizes were written as raw glyphs, so a screen reader
  // read the whole recovery path as "10 prime times 15 prime Standard" — at the
  // highest-intent moment in the funnel. The accessible name is words.
  const move = page.getByRole('button', { name: /Move me to the 10 foot by 15 foot/ })
  await expect(move).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /Or wait for a 10 foot by 10 foot/ }),
  ).toBeVisible()

  // The trade, in the renter's terms: what it costs against what they lost.
  await expect(page.getByRole('listitem').filter({ hasText: '$149.00/mo' })).toContainText(
    '$20.00 more a month than the unit you had',
  )

  // B-172: no sticky total for a unit the renter has just been told they lost.
  await expect(page.getByText('Due today')).toHaveCount(0)

  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    violations.map((v) => `${v.id}: ${v.help}`),
    'axe found accessibility violations on the unit-lost branch',
  ).toEqual([])
})

test('moving to another size keeps the answers and re-prices to that size', async ({
  page,
}) => {
  await loseTheUnit()
  await page.goto(`/checkout?token=${encodeURIComponent(token)}`)

  await page.getByRole('button', { name: /Move me to the 10 foot by 15 foot/ }).click()

  // Announced from ABOVE the panel, because a successful move removes the panel
  // — B-170's rule. `CheckoutAnnouncer` is the region that does it here, and it
  // has to say which recovery happened: "another unit the same size" would be
  // the announcement contradicting the screen after a move to a 10×15.
  await expect(
    page.getByRole('status').filter({ hasText: 'We moved you to the' }),
  ).toContainText('10 foot by 15 foot Large')

  // 2.4.3. Focus follows the announcement onto the step heading rather than
  // falling to `<body>` when the panel it was standing in is removed.
  await expect(page.locator('#step')).toBeFocused()

  // Back on the step they were on, with the new size's price — not the lost
  // one's. `relockAtSize` re-quotes from the catalogue rather than carrying the
  // rate of the unit that has gone.
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  // The summary drops the cents on a whole-dollar figure, so this is what the
  // renter actually reads: the new size's rent, not the lost unit's $129.
  await expect(page.getByText('then $149/mo')).toBeVisible()
  await expect(page.getByText('then $129/mo')).toHaveCount(0)

  const session = await prisma.checkoutSession.findFirstOrThrow({
    where: { facilityId },
    include: { units: true },
  })
  expect(session.unitTypeId).toBe(biggerTypeId)
  expect(session.quotedRateCents).toBe(14_900)
  expect(session.units[0]?.unitTypeId).toBe(biggerTypeId)
})
