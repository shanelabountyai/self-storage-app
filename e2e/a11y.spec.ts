import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// Automated axe checks run in CI per master PRD §7.2. Every customer-facing
// route added later should get a case here.
const routes = ['/']

for (const route of routes) {
  test(`${route} has no WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(route)

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations',
    ).toEqual([])
  })
}
