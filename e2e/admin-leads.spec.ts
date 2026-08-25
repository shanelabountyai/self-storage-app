import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'

// PRD 02 §4.8 US-43 (B-180). The waitlist capture on the lead screen.
//
// Here rather than in a unit test because the thing that can break silently is
// BROWSER wiring: the email field lives in a form above the quote table and the
// "Join waitlist" buttons live in the table rows, associated back to it by the
// native `form=` owner attribute. React only copies a submitter's name/value
// into the submission when the owning form has an `id` — take the id away and
// every button still renders, still submits, and carries no size at all.

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
    await page.goto('/admin/leads')
    await page.getByRole('link', { name: /Priya Prospect/ }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Priya Prospect')
  })

  test('the lead screen has no WCAG 2.1 AA violations', async ({ page }) => {
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations on the lead screen',
    ).toEqual([])
  })

  test('one email field above the table joins the waitlist for the size whose button was pressed', async ({
    page,
  }) => {
    const join = page.getByRole('button', { name: /^Join waitlist for a / }).first()
    // The demo seed's `5x15 Climate` has no units, so a full size is normally
    // present — but nothing in the seed promises one, and a lead attached to a
    // facility where every size has stock is a legitimate state, not a failure.
    test.skip(!(await join.count()), 'no full size at this lead’s facility to wait for')

    // FIXED, not unique per run: `joinWaitlist` is idempotent by address, so a
    // second sweep against the same un-reseeded database reports "already on"
    // rather than failing or leaving a second row behind. Both sentences name
    // the size and the address, which is the whole assertion.
    const email = 'e2e-lead-waitlist@example.com'
    await page.getByLabel('Email for waitlist alerts').fill(email)

    const size = ((await join.getAttribute('aria-label')) ?? '').replace('Join waitlist for a ', '')
    await join.click()

    // Names the size the pressed button carried — the proof the submitter's
    // value reached the action — and the address typed once, above the table.
    const message = page.getByRole('status').filter({ hasText: 'waitlist for the' })
    await expect(message).toContainText(size)
    await expect(message).toContainText(email)
  })
})
