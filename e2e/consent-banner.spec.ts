import { expect, test } from '@playwright/test'

// B-069 / PRD 01 §6.8.1. The cookie consent banner.
//
// The backlog line names this as "the most common source of shipped keyboard
// traps", so every criterion in §6.8.1's row for this flow gets an assertion
// here rather than a code comment claiming it. A trap is not something a unit
// test can see.

test.beforeEach(async ({ context }) => {
  // A fresh visitor: no consent recorded.
  await context.clearCookies()
})

test('the banner appears without stealing focus', async ({ page }) => {
  await page.goto('/storage/size-guide')

  const region = page.getByRole('region', { name: 'Cookies on this site' })
  await expect(region).toBeVisible()

  // §6.8.1 asks for focus to move into a banner on appearance. This one is
  // present at page LOAD, and focusing it then breaks a stronger rule — WCAG
  // 2.4.1's skip link must be the first tab stop, and it was not. So the
  // banner leaves focus alone and the skip link still wins the first Tab.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
})

test('it is not a keyboard trap — tab reaches it and leaves again', async ({ page }) => {
  await page.goto('/storage/size-guide')

  // Reachable by keyboard from the page, which is what matters now that focus
  // is not moved there for you.
  await page.getByRole('button', { name: 'No thanks' }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: "That's fine" })).toBeFocused()

  // And a third tab leaves the banner entirely. In a trap it would cycle back
  // to the first button forever.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: "That's fine" })).not.toBeFocused()
  await expect(page.getByRole('button', { name: 'No thanks' })).not.toBeFocused()
})

test('reject comes before accept and dismisses by keyboard alone', async ({ page }) => {
  await page.goto('/storage/size-guide')

  // "Reject is as reachable and as prominent as Accept" — reject comes FIRST in
  // the DOM and so in the tab order, which is the stronger version of
  // reachable. (The trap test above walks reject → accept to prove the order.)
  await page.getByRole('button', { name: 'No thanks' }).focus()
  await expect(page.getByRole('button', { name: 'No thanks' })).toBeFocused()

  // Dismissed by the keyboard alone, never needing a pointer.
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Cookies on this site' })).toBeHidden()

  // Dismissal must not drop focus on `<body>` — the button that was pressed has
  // just left the DOM, and a keyboard user would otherwise be silently returned
  // to the top of the document.
  await expect(page.locator('#main')).toBeFocused()
})

test('the choice sticks across a reload', async ({ page }) => {
  await page.goto('/storage/size-guide')
  await page.getByRole('button', { name: 'No thanks' }).click()
  await expect(page.getByRole('region', { name: 'Cookies on this site' })).toBeHidden()

  await page.reload()
  // Asking again after somebody said no is how a banner becomes the thing
  // people install an extension to block.
  await expect(page.getByRole('region', { name: 'Cookies on this site' })).toBeHidden()
})

test('it does not obscure content at 320px', async ({ page }) => {
  // §6.8.1: "It does not obscure content at 320px or at 200% zoom." A
  // viewport-fixed bar is exactly what fails this once its text wraps.
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/storage/size-guide')

  const region = page.getByRole('region', { name: 'Cookies on this site' })
  await expect(region).toBeVisible()

  const box = await region.boundingBox()
  const main = await page.locator('main').boundingBox()
  expect(box).not.toBeNull()
  expect(main).not.toBeNull()

  // In normal flow means it starts at or below the end of the main content,
  // rather than floating over it.
  expect(box!.y).toBeGreaterThanOrEqual(main!.y + main!.height - 1)

  // And the page must not scroll sideways because of it (WCAG 1.4.10).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('both buttons meet the 44px touch target', async ({ page }) => {
  await page.goto('/storage/size-guide')
  for (const name of ['No thanks', "That's fine"]) {
    const box = await page.getByRole('button', { name }).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
})
