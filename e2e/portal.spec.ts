import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signInAsDemoTenant } from './sign-in'

// PRD 01 §4.7 US-701/US-702, §6.8.1. Mirrors e2e/admin.spec.ts's split: an
// unauthenticated gating check, then a real session against the demo tenant
// (B-034's `dana@demo.example.com`, seeded with a real past-due balance and a
// suspended access grant so the banner/suspended-panel branches are actually
// exercised, not just the empty-state ones).
test.describe('portal role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/portal')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })
})

test.describe('signed in as the demo tenant', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoTenant(page)
  })

  test('/portal has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/portal')
    await expect(page.getByRole('main')).toBeVisible()

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations',
    ).toEqual([])
  })

  test('shows the past-due banner and a suspended gate-code panel, not a code', async ({ page }) => {
    await page.goto('/portal')
    // Scoped to <main>: Next ships its own empty role="alert" route announcer
    // in the document, and an unscoped query matches that instead (same note
    // as e2e/admin.spec.ts's settings-error test).
    await expect(page.getByRole('main').getByRole('alert')).toContainText('past due')
    await expect(page.getByText('Access is suspended until the balance is paid')).toBeVisible()
    await expect(page.getByRole('button', { name: /show gate code/i })).toHaveCount(0)
  })

  // GateCodePanel's own reveal/copy interaction (the aria-expanded toggle,
  // the character-by-character sr-only text, and the "Copied" live region
  // §6.8 requires to pre-exist the click that fills it) is NOT covered here.
  // The demo tenant with a known password is deliberately the suspended one
  // (above), so this panel never renders for it, and no seeded credential is
  // ever genuinely revealable regardless — ACCESS_CODE_ENCRYPTION_KEY is
  // unconfigured everywhere in this project by design (lib/access/secret.ts's
  // own "no safe dev fallback" comment), so codeForLease() returns null for
  // every demo lease. Verified instead with a real running dev server, a
  // temporary key, and a temporary revealable credential on a non-suspended
  // demo tenant — see PROGRESS.md's B-034 entry.
})
