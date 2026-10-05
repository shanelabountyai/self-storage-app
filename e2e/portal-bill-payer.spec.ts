import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
import { hashPassword } from '../apps/web/lib/auth/password'
import { mintUnsubscribeToken } from '../apps/web/lib/comms/unsubscribe-token'
import { assertNoAxeViolations } from './a11y-helpers'
import { signInAsTenant } from './sign-in'

// B-437 / PRD 01 US-703 "someone else can pay". The tenant names the one
// person who is sent the bill, on /portal/notifications; that person stops it
// from the link in the email; the tenant removes them.
//
// A tenant of its own (B-120's first discipline): naming a payer on a demo
// tenant would add a recipient to every reminder another spec counts. No
// facility and no lease, so there is nothing here an audit row could pin.
const EMAIL = 'e2e-b437-bill-payer@example.com'
const PASSWORD = 'bill-payer-e2e-1'
const PAYER_EMAIL = 'e2e-b437-sam@example.com'

// Serial: one tenant, and each test starts from the state the last one left.
test.describe.configure({ mode: 'serial' })

test.describe('a tenant sends their bill to someone else', () => {
  let tenantId = ''

  test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name !== 'desktop-chrome') return
    const tenant =
      (await prisma.tenant.findFirst({ where: { email: EMAIL }, select: { id: true } })) ??
      (await prisma.tenant.create({
        data: {
          email: EMAIL,
          firstName: 'Ada',
          lastName: 'Parent',
          passwordHash: await hashPassword(PASSWORD),
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      }))
    tenantId = tenant.id
    await prisma.nominatedPayer.deleteMany({ where: { tenantId } })
  })

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'one tenant in the one shared database')
    await signInAsTenant(page, EMAIL, PASSWORD)
    await page.goto('/portal/notifications')
  })

  const section = (page: import('@playwright/test').Page) =>
    page.getByRole('region', { name: 'Send my bill to someone else' })

  // a11y-state: /portal/notifications | bill payer refused
  test('says what the payer will and will not get, and refuses without the consent box', async ({ page }) => {
    // 3.3.4: stated before the control, not after it.
    await expect(section(page)).toContainText('no gate code, no documents and no login to your account')

    await section(page).getByLabel('Their name').fill('Sam Daughter')
    await section(page).getByLabel('Their email').fill(PAYER_EMAIL)
    await section(page).getByRole('button', { name: 'Send them my bill' }).click()

    await expect(section(page)).toContainText('Tick the box to agree')
    await expect(section(page).getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true')
    // The refusal kept what was typed (3.3.7) and wrote nothing.
    await expect(section(page).getByLabel('Their name')).toHaveValue('Sam Daughter')
    expect(await prisma.nominatedPayer.count({ where: { tenantId } })).toBe(0)
    await assertNoAxeViolations(page, { state: 'bill payer refused' })
  })

  // a11y-state: /portal/notifications | bill payer named
  test('names the payer, and shows who it is and since when', async ({ page }) => {
    await section(page).getByLabel('Their name').fill('Sam Daughter')
    await section(page).getByLabel('Their email').fill(PAYER_EMAIL)
    await section(page).getByRole('checkbox').check()
    await section(page).getByRole('button', { name: 'Send them my bill' }).click()

    // The form that was submitted is gone, so the result is announced in the
    // section's own region, which takes focus.
    const announced = section(page).getByRole('status').filter({ hasText: 'Sam Daughter will get your bill' })
    await expect(announced).toHaveText(
      `Sam Daughter will get your bill and payment reminders at ${PAYER_EMAIL}.`,
    )
    await expect(announced).toBeFocused()
    await expect(section(page)).toContainText(`Sam Daughter (${PAYER_EMAIL}) gets your bill`)
    // One payer at a time: the form is gone while there is one.
    await expect(section(page).getByLabel('Their name')).toHaveCount(0)
    await assertNoAxeViolations(page, { state: 'bill payer named' })
  })

  // a11y-state: /unsubscribe/[token] | bill payer stop
  test("the payer's own link stops it, and the tenant is told", async ({ page }) => {
    const payer = await prisma.nominatedPayer.findFirstOrThrow({ where: { tenantId, removedAt: null } })
    await page.goto(`/unsubscribe/${mintUnsubscribeToken(PAYER_EMAIL, 'en', payer.id)}`)
    await expect(page.getByText('You will stop getting bills and payment reminders')).toBeVisible()
    await assertNoAxeViolations(page, { state: 'bill payer stop' })
    await page.getByRole('button', { name: 'Unsubscribe me' }).click()
    await expect(page.getByText('will not be sent this bill')).toBeVisible()

    // A stop, not an unsubscribe: nothing went on the suppression list.
    expect(await prisma.suppression.count({ where: { address: PAYER_EMAIL } })).toBe(0)

    await page.goto('/portal/notifications')
    await expect(section(page)).toContainText('asked us on')
    await expect(section(page)).toContainText('It is not being sent to them.')
  })

  test('the tenant removes the payer and the form comes back', async ({ page }) => {
    await section(page).getByRole('button', { name: 'Stop sending them my bill' }).click()
    await expect(
      section(page).getByRole('status').filter({ hasText: 'no longer sent to anyone else' }),
    ).toBeFocused()
    await expect(section(page).getByLabel('Their name')).toBeVisible()
    expect(await prisma.nominatedPayer.count({ where: { tenantId, removedAt: null } })).toBe(0)
  })
})
