import { expect, test } from '@playwright/test'
import { assertNoAxeViolations } from './a11y-helpers'
import { createIncidentFixture } from './incident-fixture'
import { signInAsDemoOwner } from './sign-in'

// PRD 02 US-37 "an incident is one record" (B-424).
//
// **Nothing here records an incident or sends the message (B-120).** Recording
// one raises a task on a shared demo tenant, and the send emails them. What
// both WRITE is covered in tests/incidents-db.test.ts; this file asserts the
// record's screen against a fixture row of its own.

let fixture: Awaited<ReturnType<typeof createIncidentFixture>>

test.beforeAll(async () => {
  fixture = await createIncidentFixture()
})
test.afterAll(async () => {
  await fixture.cleanup()
})

test('redirects an unauthenticated visitor to /login', async ({ page }) => {
  await page.goto(`/admin/incidents/${fixture.id}`)
  await expect(page).toHaveURL(/\/login/)
})

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('/admin/incidents/[id] shows the frozen gate log and has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto(`/admin/incidents/${fixture.id}`)
    await expect(page.getByRole('heading', { level: 1, name: /^Break-in — Demo — Austin South/ })).toBeVisible()
    await expect(page.getByRole('table', { name: /inside the incident window/ }).getByRole('row')).toHaveCount(2)

    await assertNoAxeViolations(page)
  })

  // a11y-state: /admin/incidents/[id] | the notify confirm step
  test('echoes who the message reaches before anything is sent', async ({ page }) => {
    await page.goto(`/admin/incidents/${fixture.id}`)

    const form = page.getByRole('form', { name: 'Tell the affected tenants' })
    await form.getByLabel('Subject').fill('e2e-check — never confirmed')
    await form.getByLabel('Message').fill('e2e-check — never confirmed')
    await form.getByRole('button', { name: 'Review the message' }).click()

    await expect(form.getByRole('status')).toHaveText(/It can be sent once/)
    await expect(form.getByRole('button', { name: 'Yes, send it' })).toBeVisible()

    await assertNoAxeViolations(page)
  })
})
