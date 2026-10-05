import { expect, test } from '@playwright/test'
import { OWNER_STATE, TENANT_STATE } from './sign-in'

// B-435 (PRD 01 §6.7). Every segment fails politely. axe, reflow, zoom and text
// spacing on both pages ride `PUBLIC_SCAN_ROUTES` in `a11y.spec.ts`.

const SPANISH = { name: 'st_locale', value: 'es', url: 'http://localhost:3000' }

test('an unknown facility slug is a 404 with the zip search and the phone', async ({ page }) => {
  const response = await page.goto('/storage/tx/austin/no-such-facility')
  expect(response?.status()).toBe(404)
  await expect(page).toHaveTitle(/^We can't find that page/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("We can't find that page")
  await expect(page.getByRole('main').getByLabel('Where do you need storage?')).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: '(512) 555-0100' })).toHaveAttribute(
    'href',
    'tel:+15125550100',
  )
})

test('a URL that matches no route gets the same page inside the public shell', async ({ page }) => {
  const response = await page.goto('/no-such-page')
  expect(response?.status()).toBe(404)
  await expect(page).toHaveTitle(/^We can't find that page/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("We can't find that page")
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('main').getByLabel('Where do you need storage?')).toBeVisible()
})

test('the not-found page follows the reader into Spanish', async ({ context, page }) => {
  await context.addCookies([SPANISH])
  await page.goto('/no-such-page')
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page).toHaveTitle(/^No encontramos esa página/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No encontramos esa página')
})

test('an error on a public route names the problem and offers Try again', async ({ page }) => {
  await page.goto('/e2e-error')
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveText('This page did not load')
  await expect(heading).toBeFocused()
  await expect(page).toHaveTitle(/^This page did not load/)
  await expect(page.getByRole('main')).toContainText('Nothing was charged.')
  await expect(page.getByRole('main').getByRole('link', { name: '(512) 555-0100' })).toBeVisible()
  // The route throws every time, so Try again lands back on the same page.
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(heading).toHaveText('This page did not load')
})

test('the error page follows the reader into Spanish', async ({ context, page }) => {
  await context.addCookies([SPANISH])
  await page.goto('/e2e-error')
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Esta página no cargó')
  await expect(page.getByRole('button', { name: 'Intentar de nuevo' })).toBeVisible()
})

test.describe('signed in as a tenant', () => {
  test.use({ storageState: TENANT_STATE })

  test('a statement that is not theirs is a 404 inside the portal', async ({ page }) => {
    const response = await page.goto('/portal/statements/not-a-lease/2026-01')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("We can't find that page")
    await expect(page.getByRole('main').getByRole('link', { name: 'Back to your account' })).toBeVisible()
  })
})

test.describe('signed in as staff', () => {
  test.use({ storageState: OWNER_STATE })

  test('a record that does not exist is a 404 inside the staff shell', async ({ page }) => {
    const response = await page.goto('/admin/incidents/not-an-incident')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.getByRole('link', { name: 'Back to the dashboard' })).toBeVisible()
  })
})
