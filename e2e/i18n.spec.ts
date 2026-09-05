import { expect, test } from '@playwright/test'
import { assertNoAxeViolations } from './a11y-helpers'

// B-090 part 6 (D-122). Spanish on the move-in path.
//
// Nothing here mutates shared demo state: the locale lives in a cookie on the
// test's own browser context, so these specs need neither of B-120's two
// disciplines — a full sweep can run twice against the same database and this
// file behaves identically both times.
//
// What the unit tests cannot see is exactly what is asserted here: that the
// cookie survives a navigation, that `<html lang>` follows it (SC 3.1.1), and
// that adding two focusable controls to the header did not displace the skip
// link (SC 2.4.1) — which is a real risk, because that assertion has been
// broken by a header change in this repo before.

const SPANISH = { name: 'st_locale', value: 'es', url: 'http://localhost:3000' }

test('the language toggle switches the site and says so in the markup', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  await page.getByRole('button', { name: 'Switch to Español' }).click()

  // SC 3.1.1 Language of Page. A Spanish page announced as `lang="en"` is read
  // aloud with English phonemes, which is worse for a screen-reader user than
  // no translation at all.
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bodegas')

  // Reversible from the Spanish page, and named in the language it switches TO
  // — "English" is what somebody reading Spanish will recognise.
  await page.getByRole('button', { name: 'Cambiar a English' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('the chosen language survives a navigation', async ({ page, context }) => {
  await context.addCookies([SPANISH])

  // A preference that is lost on the next page is not a preference. This is
  // the whole load-bearing claim of the cookie strategy (D-122) — the URL does
  // not carry the language, so nothing else can.
  await page.goto('/storage/search?q=78704')
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bodegas cerca de')
})

test('a stale or hand-edited locale cookie falls back to English', async ({ page, context }) => {
  // `getLocale` must never be able to 500 a public page on a bad cookie —
  // anyone can edit one, and this one is deliberately not httpOnly.
  await context.addCookies([{ ...SPANISH, value: 'zz' }])

  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('the skip link is still the first tab stop in Spanish', async ({ page, context }) => {
  await context.addCookies([SPANISH])
  await page.goto('/')

  // WCAG 2.4.1. The toggle adds two focusable controls to the header, and the
  // English version of this assertion lives in `smoke.spec.ts` — the Spanish
  // one is here because the skip link's own text is translated too, so a
  // by-name check in English would pass for the wrong reason.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Saltar al contenido principal' })).toBeFocused()
})

test('the Spanish facility page has no axe violations', async ({ page, context }) => {
  await context.addCookies([SPANISH])
  await page.goto('/storage/tx/austin/demo-austin-south')

  await expect(page.getByRole('heading', { name: 'Unidades disponibles' })).toBeVisible()
  // The scan is not redundant with the English one: `lang` changed, the
  // toggle's per-button `lang` is new markup (SC 3.1.2 Language of Parts), and
  // longer Spanish strings are what break a name/label match.
  // a11y-state: /storage/[state]/[city]/[slug] | Spanish
  await assertNoAxeViolations(page)
})

test('a renter can reach the Spanish checkout from a Spanish facility page', async ({
  page,
  context,
}) => {
  await context.addCookies([SPANISH])
  await page.goto('/storage/tx/austin/demo-austin-south')

  // The point of the whole session's scope: the funnel does not switch back to
  // English at the money moment. A renter dropped into an English checkout has
  // been served worse than one who was never offered Spanish.
  await page.getByRole('button', { name: 'Rentar ahora' }).first().click()
  await expect(page).toHaveURL(/\/checkout\?token=/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Múdese en línea')
  await expect(page.getByLabel('Correo electrónico')).toBeVisible()
})
