import { expect, test } from '@playwright/test'
import { assertNoAxeViolations } from './a11y-helpers'
import { signInAsDemoTenant } from './sign-in'

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

// --- B-260: the portal ------------------------------------------------------
//
// B-090f translated the move-in path and then sent the renter to "Ir a mi
// cuenta" — an English account. These assert the other half: that every route
// the portal nav offers renders in Spanish, and that `<html lang>` follows the
// cookie on a signed-in page as well as a public one.

test.describe('the portal in Spanish', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([SPANISH])
  })

  // Every route in the portal nav, with the heading that proves the page's own
  // copy was translated rather than only its chrome. Kept as data so a new
  // portal route added without a Spanish heading is one line to catch here.
  //
  // The heading is a REGEX because two of these routes branch on how many
  // units the tenant holds, and the demo tenant holds one: /portal/transfer
  // and /portal/move-out skip their chooser and render the per-unit heading
  // instead. Both spellings are Spanish and either one proves the point, so
  // the assertion accepts either rather than pinning a fixture's lease count.
  const ROUTES: [string, RegExp][] = [
    ['/portal', /Mi cuenta/],
    ['/portal/methods', /Formas de pago/],
    ['/portal/statements', /Estados de cuenta/],
    ['/portal/documents', /Documentos y recibos/],
    ['/portal/access', /Quién puede entrar/],
    ['/portal/protection', /Protección y seguro/],
    ['/portal/contact', /Datos de contacto/],
    ['/portal/notifications', /Preferencias de avisos/],
    ['/portal/refer', /Recomiende a un amigo/],
    ['/portal/transfer', /Cambiar de unidad|Cambiarse de la Unidad/],
    ['/portal/move-out', /Solicitar desocupar/],
  ]

  for (const [route, heading] of ROUTES) {
    test(`${route} renders in Spanish`, async ({ page }) => {
      await signInAsDemoTenant(page)
      await page.goto(route)

      // SC 3.1.1 on a signed-in page: the portal is outside the `(public)`
      // route group, so it inherits neither the provider nor the toggle and
      // this is a genuinely separate mounting from the one B-090f asserted.
      await expect(page.locator('html')).toHaveAttribute('lang', 'es')
      await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(heading)
    })
  }

  test('the portal nav and its language toggle are Spanish', async ({ page }) => {
    await signInAsDemoTenant(page)
    await page.goto('/portal')

    for (const name of ['Resumen', 'Formas de pago', 'Estados de cuenta', 'Documentos']) {
      await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible()
    }
    // The toggle has to be INSIDE the portal too: a tenant who chose Spanish
    // while renting has no other way back to English once they are signed in.
    await expect(page.getByRole('button', { name: 'Cambiar a English' })).toBeVisible()
  })

  test('the Spanish portal dashboard has no axe violations', async ({ page }) => {
    await signInAsDemoTenant(page)
    await page.goto('/portal')

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mi cuenta')
    // Dana is seeded past-due with a suspended grant, so this scans the money
    // and access branches rather than an empty account.
    // a11y-state: /portal | Spanish
    await assertNoAxeViolations(page)
  })
})
