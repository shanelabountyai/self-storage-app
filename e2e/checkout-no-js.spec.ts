import { expect, test } from '@playwright/test'

// B-416. The accessibility statement's entry about JavaScript, run rather than
// read. It asserts BOTH halves of what `a11y.short.js.body` says: Rent now
// works, and the checkout's forms do not send. When B-442 makes them send, the
// second half fails here, which is the prompt to reword the statement and
// remove the `<noscript>` line.
test('with JavaScript off, Rent now holds the unit and the checkout says to call', async ({
  browser,
}, testInfo) => {
  // One project: the walk holds a sandbox unit, and nothing here is
  // viewport-dependent.
  test.skip(testInfo.project.name !== 'desktop-chrome', 'not viewport-dependent')

  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  const notice = page.locator('noscript p')
  await expect(notice).toContainText('need JavaScript')
  // SC 2.4.4: the link is named, and it dials.
  await expect(notice.getByRole('link', { name: /^Call / })).toHaveAttribute('href', /^tel:\+?\d+/)

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-no-js-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // The statement's other half: the step does not advance.
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toHaveCount(0)

  // Sign-in is named in the statement too.
  await page.goto('/login')
  await expect(page.locator('form', { hasText: 'Sign in' }).first()).toHaveAttribute(
    'action',
    /^javascript:/,
  )
  await context.close()
})
