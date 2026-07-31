import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// PRD 01 §6.8: "CI includes automated a11y checks (axe) on all key templates."
// Every public route is listed here — a new page that isn't added is a page
// nobody checks, so this list is the contract.
const PUBLIC_ROUTES = [
  '/',
  '/storage/search?q=78704',
  '/faq',
  '/about',
  '/contact',
  '/terms',
  '/privacy',
  '/accessibility',
]

for (const route of PUBLIC_ROUTES) {
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
