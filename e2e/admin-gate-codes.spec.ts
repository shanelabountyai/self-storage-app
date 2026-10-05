import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
import { assertNoAxeViolations } from './a11y-helpers'
import { signInAsDemoOwner } from './sign-in'

// PRD 03 US-10 (B-436). A vendor code of this file's own, in the E2E Sandbox
// (B-120): nothing else asserts against a non-tenant grant there, the spec
// revokes it, and `afterAll` deletes its rows. Each Playwright project gets
// its own vendor name.

const VENDOR = `Pest Control ${randomUUID().slice(0, 6)}`

test.afterAll(async () => {
  const grants = await prisma.accessGrant.findMany({ where: { holderName: VENDOR }, select: { id: true } })
  const grantIds = grants.map((grant) => grant.id)
  const credentials = await prisma.accessCredential.findMany({
    where: { grantId: { in: grantIds } },
    select: { id: true },
  })
  await prisma.simulatedGateCode.deleteMany({
    where: { credentialId: { in: credentials.map((credential) => credential.id) } },
  })
  await prisma.gateCommand.deleteMany({ where: { grantId: { in: grantIds } } })
  await prisma.accessCredential.deleteMany({ where: { grantId: { in: grantIds } } })
  await prisma.accessGrant.deleteMany({ where: { id: { in: grantIds } } })
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
    await page.goto('/admin/access/codes')
    await expect(
      page.getByRole('heading', { level: 1, name: /^Staff and vendor codes — Demo — E2E Sandbox/ }),
    ).toBeVisible()
  })

  test('a temporary code with no last day is refused at the field', async ({ page }) => {
    const form = page.getByRole('form', { name: 'Issue a staff, vendor or temporary gate code' })
    await form.getByLabel('Kind').selectOption('temporary')
    await form.getByLabel('Name').fill(VENDOR)
    await form.getByRole('button', { name: 'Issue code' }).click()
    // The summary and the field both say it.
    await expect(form.getByText('A temporary code needs a last day').first()).toBeVisible()
    expect(await prisma.accessGrant.count({ where: { holderName: VENDOR } })).toBe(0)
  })

  test('a vendor code is issued, listed, and revoked after a confirm', async ({ page }) => {
    const form = page.getByRole('form', { name: 'Issue a staff, vendor or temporary gate code' })
    await form.getByLabel('Kind').selectOption('vendor')
    await form.getByLabel('Name').fill(VENDOR)
    await form.getByLabel('Hours').selectOption('weekdays')
    await form.getByRole('button', { name: 'Issue code' }).click()
    await expect(form.getByText(/^Gate code: \d{6}$/)).toBeVisible()

    const row = page.getByRole('row').filter({ hasText: VENDOR })
    await expect(row).toContainText('Vendor')
    await expect(row).toContainText('Weekdays only')
    await expect(row).toContainText('Until revoked')
    // a11y-state: /admin/access/codes | a code just issued, in the list
    await assertNoAxeViolations(page)

    await page.getByRole('button', { name: `Revoke the code for ${VENDOR}` }).click()
    const confirm = page.getByRole('button', { name: 'Yes, revoke the code' })
    await expect(confirm).toBeVisible()
    // a11y-state: /admin/access/codes | the revoke confirm step
    await assertNoAxeViolations(page)
    await confirm.click()

    await expect(page.getByRole('row').filter({ hasText: VENDOR })).toHaveCount(0)
    const grant = await prisma.accessGrant.findFirstOrThrow({ where: { holderName: VENDOR } })
    expect(grant.state).toBe('revoked')
  })
})
