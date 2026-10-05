import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
import { assertNoAxeViolations } from './a11y-helpers'
import { signInAsDemoOwner } from './sign-in'

// PRD 02 US-14 "AC (the counter can see who is coming)" (B-434).
//
// Two holds of this file's own, in the E2E Sandbox, on a size rather than a
// unit (B-120): a sandbox hold is disposable (`global-setup.ts` expires every
// one), no unit count moves until "Start move-in" takes a checkout lock, and
// that lock is released by the next run's setup. Both rows are deleted in
// `afterAll`. Each Playwright project gets its own pair.

const suffix = randomUUID().slice(0, 6)
const TODAY = `Today${suffix}`
const LATER = `Later${suffix}`
const DAY_MS = 24 * 60 * 60 * 1000
let laterId = ''

test.beforeAll(async () => {
  const facility = await prisma.facility.findUniqueOrThrow({ where: { slug: 'demo-e2e' }, select: { id: true } })
  const unit = await prisma.unit.findFirstOrThrow({
    where: { facilityId: facility.id, status: 'available' },
    select: { unitTypeId: true },
  })
  const hold = (lastName: string, moveInDays: number) =>
    prisma.reservation.create({
      data: {
        facilityId: facility.id,
        unitTypeId: unit.unitTypeId,
        firstName: 'Ada',
        lastName,
        email: `${lastName.toLowerCase()}@example.com`,
        phone: '512-555-0142',
        // No demo rate is $87.31, so the checkout showing it is the held rate.
        quotedRateCents: 8_731,
        moveInDate: new Date(Date.now() + moveInDays * DAY_MS),
        expiresAt: new Date(Date.now() + 10 * DAY_MS),
        tokenHash: randomUUID(),
      },
    })
  // The later one first, so creation order cannot be what sorts them.
  laterId = (await hold(LATER, 3)).id
  await hold(TODAY, 0)
})

test.afterAll(async () => {
  await prisma.reservation.deleteMany({ where: { lastName: { in: [TODAY, LATER] } } })
  await prisma.$disconnect()
})

test.describe.configure({ mode: 'serial' })

test.describe('signed in as the demo owner, at the E2E Sandbox', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
    await page.goto('/admin')
    await page.getByLabel('Switch facility').selectOption({ label: 'Demo — E2E Sandbox' })
    await page.getByRole('button', { name: 'Switch', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Demo — E2E Sandbox' })).toBeVisible()
  })

  test("the dashboard tile leads to the list, and today's arrival sits above a later one", async ({ page }) => {
    await page.getByRole('link', { name: /Arriving today/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: /^Reservations — Demo — E2E Sandbox/ })).toBeVisible()

    const names = await page.getByRole('rowheader').allTextContents()
    const today = names.findIndex((name) => name.includes(TODAY))
    const later = names.findIndex((name) => name.includes(LATER))
    expect(today).toBeGreaterThanOrEqual(0)
    expect(later).toBeGreaterThan(today)
    await expect(page.getByRole('row').filter({ hasText: TODAY })).toContainText('Arriving today')
    await expect(page.getByRole('row').filter({ hasText: TODAY })).toContainText('$87.31/mo')

    await assertNoAxeViolations(page)
  })

  test('the walk-in search finds a held reservation', async ({ page }) => {
    await page.goto(`/admin/pos?q=${TODAY}`)
    const found = page.getByRole('list', { name: 'Held reservations' }).getByRole('link', { name: `Ada ${TODAY}` })
    await expect(found).toBeVisible()
    await found.click()
    await expect(page.getByRole('rowheader').filter({ hasText: TODAY })).toBeVisible()
  })

  test('Start move-in opens a counter checkout at the held rate', async ({ page }) => {
    await page.goto(`/admin/reservations?q=${TODAY}`)
    await page.getByRole('button', { name: `Start move-in for Ada ${TODAY}` }).click()
    await page.waitForURL(/\/checkout\?token=/)
    // The rent line sits inside the collapsed price breakdown, so attached, not visible.
    await expect(page.getByText('$87.31').first()).toBeAttached()
  })

  test('Cancel hold asks first, then writes one audit row', async ({ page }) => {
    await page.goto(`/admin/reservations?q=${LATER}`)
    await page.getByRole('button', { name: `Cancel hold for Ada ${LATER}` }).click()
    const confirm = page.getByRole('button', { name: 'Yes, cancel the hold' })
    await expect(confirm).toBeVisible()
    // a11y-state: /admin/reservations | the cancel confirm step
    await assertNoAxeViolations(page)

    await confirm.click()
    await expect(page.getByText('Nobody is holding a unit here.').or(page.getByText(/No held reservation matches/))).toBeVisible()
    expect(
      await prisma.auditLog.count({ where: { action: 'reservation.cancelled', entityId: laterId } }),
    ).toBe(1)
  })
})
