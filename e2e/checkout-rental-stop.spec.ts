import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
import { assertNoAxeViolations } from './a11y-helpers'

// B-415 / PRD 02 US-32 "money owed elsewhere is seen before the keys". No demo
// tenant left owing, so this spec owns one: a former tenant at a fixed-slug
// facility of their own (B-120's first discipline), inactive from the start so
// it never shows in search or the reports. Nothing here is mutated by the
// test: a stopped renter writes no row.
const SLUG = 'e2e-b415-rental-stop'
const PHONE = '737-555-0415'
const OWED_CENTS = 12_345

test.beforeAll(async () => {
  const email = `${SLUG}@example.com`
  // Two projects race this. A second tenant or lease would be a second match
  // for the same phone, which stops the renter exactly as one does.
  if (await prisma.tenant.findFirst({ where: { email, leases: { some: {} } } })) return

  const facility = await prisma.facility.upsert({
    where: { slug: SLUG },
    update: {},
    create: {
      name: 'E2E — Rental stop',
      slug: SLUG,
      status: 'inactive',
      addressLine1: '1 Former Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '78704',
      timezone: 'America/Chicago',
    },
    select: { id: true },
  })
  const tag = Date.now()
  const unitType = await prisma.unitType.create({
    data: { facilityId: facility.id, name: `5x5 ${SLUG} ${tag}`, widthFt: 5, lengthFt: 5 },
  })
  const unit = await prisma.unit.create({
    data: { facilityId: facility.id, unitTypeId: unitType.id, number: `B415-${tag}` },
  })
  const tenant = await prisma.tenant.create({
    data: { email, firstName: 'Fern', lastName: 'Former', phone: PHONE, postalCode: '73301' },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId: facility.id,
      tenantId: tenant.id,
      unitId: unit.id,
      status: 'ended',
      startDate: new Date('2026-01-01'),
      moveOutDate: new Date('2026-06-30'),
      monthlyRateCents: 12_900,
      billingDay: 1,
    },
  })
  await prisma.ledgerEntry.create({
    data: {
      facilityId: facility.id,
      leaseId: lease.id,
      type: 'charge',
      amountCents: OWED_CENTS,
      description: 'Rent',
    },
  })
})

test('a renter who left owing money elsewhere is told to call, and never why', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  // A new name, a new email and a new zip: the phone is the only key that
  // matches, which is the renter this rule is for.
  const email = `e2e-b415-${Date.now()}@demo.example.com`
  await page.getByLabel('First name').fill('Nora')
  await page.getByLabel('Last name').fill('Newname')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Mobile number').fill('(737) 555-0415')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // SC 4.1.3 and 2.4.3: announced, and focus is on the message. SC 3.3.3: it
  // names the next action.
  const message = page.getByRole('main').getByRole('alert')
  await expect(message).toContainText(/Please call the office at .+ to finish renting\./)
  await expect(message).toBeFocused()

  // Neither the balance nor any word for it, anywhere on the page.
  const main = await page.getByRole('main').innerText()
  expect(main).not.toMatch(/123\.45|owe|balance|former|do not rent/i)

  // Still on step 1, and nothing was created.
  await expect(page.getByRole('heading', { name: 'Your unit' })).toHaveCount(0)
  expect(await prisma.tenant.count({ where: { email } })).toBe(0)

  await assertNoAxeViolations(page)
})
