import { expect, test } from '@playwright/test'
import { assertNoAxeViolations } from './a11y-helpers'
import { signInAsDemoTenant } from './sign-in'

// B-090 part 6 (D-122), rewritten by B-262 (D-123). Spanish on the move-in
// path and in the portal.
//
// Nothing here mutates shared demo state: the language is a URL, so these specs
// need neither of B-120's two disciplines — a full sweep can run twice against
// the same database and this file behaves identically both times. That was
// already true when the locale was a cookie on the test's own context; it is
// now true because there is no per-visitor state at all.
//
// **What changed with B-262 is the thing being asserted, not the assertions.**
// D-122 put the locale in a cookie, so the load-bearing claim was that the
// cookie SURVIVED a navigation. The locale is in the path now, so the claim is
// the opposite shape: that the URL carries it, that an English URL is English
// no matter what the visitor did last, and that an untranslated page's `/es/`
// twin redirects rather than serving English prose from a Spanish address.
//
// What the unit tests cannot see is exactly what is asserted here: that
// `<html lang>` follows the URL (SC 3.1.1), and that adding two focusable
// controls to the header did not displace the skip link (SC 2.4.1) — which is
// a real risk, because that assertion has been broken by a header change in
// this repo before.

test('the language toggle moves the visitor to the other language’s URL', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  await page.getByRole('link', { name: 'Switch to Español' }).click()

  // The URL is the assertion now, and it is the half a cookie never gave: the
  // address bar says which language you are reading, and the link a Spanish
  // speaker copies stays Spanish for whoever opens it.
  await expect(page).toHaveURL('/es')
  // SC 3.1.1 Language of Page. A Spanish page announced as `lang="en"` is read
  // aloud with English phonemes, which is worse for a screen-reader user than
  // no translation at all.
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bodegas')

  // Reversible from the Spanish page, and named in the language it switches TO
  // — "English" is what somebody reading Spanish will recognise.
  await page.getByRole('link', { name: 'Cambiar a English' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('the language survives a navigation, because the links carry it', async ({ page }) => {
  await page.goto('/es')

  // A language that is lost on the next click is not a language. Under D-122
  // this was a claim about a cookie; it is now a claim about every internal
  // link, which is why it CLICKS rather than navigating directly — a raw
  // `href="/storage/search"` anywhere in the chrome would drop the visitor
  // into English here and nothing else would notice.
  await page.getByRole('link', { name: 'Buscar bodegas' }).click()
  await expect(page).toHaveURL(/\/es\/storage\/search$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
})

test('an English URL is English whatever the visitor read last', async ({ page }) => {
  // The failure a cookie made possible and a path makes impossible: two people
  // opening the same link and reading different words. Googlebot is one of the
  // two, which is what D-77's duplicate gate was built to reason about.
  await page.goto('/es/storage/search?q=78704')
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')

  await page.goto('/storage/search?q=78704')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Storage near')
})

test('a Spanish URL for an untranslated page redirects rather than serving English', async ({
  page,
}) => {
  // `/terms`, `/privacy` and `/messaging-policy` stay English by decision
  // (D-122's legal carve-out). A `/es/` twin that RENDERED them would be a
  // second indexable copy of the English page — the duplicate D-77 refuses —
  // so the proxy sends it to the one URL that content lives at.
  for (const path of ['/terms', '/privacy', '/messaging-policy']) {
    const response = await page.goto(`/es${path}`)
    expect(response?.status(), `/es${path}`).toBe(200)
    await expect(page).toHaveURL(path)
  }
})

test('a link out of Spanish to an English page re-announces the language', async ({ page }) => {
  // The other half of the toggle's bug, and the one nothing would have looked
  // for. `/terms` stays English, so the footer links to it unprefixed — which
  // makes it a CROSS-LOCALE link from `/es/faq`. Next keeps the root layout
  // across a client-side navigation, so under `next/link` the English terms
  // rendered inside a document still announced as `lang="es"`, and a screen
  // reader read English words with Spanish phonemes (SC 3.1.1).
  await page.goto('/es/faq')
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')

  await page.getByRole('link', { name: 'Términos' }).click()
  await expect(page).toHaveURL('/terms')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('an unknown language segment is a page, not a locale', async ({ page }) => {
  // `/espanol` must not be read as `/es` + `panol`. The prefix test is for a
  // whole segment, and getting that wrong renders a path with its first three
  // characters cut off — or, on `/es/admin`, would have skipped the auth gate.
  const response = await page.goto('/espanol')
  expect(response?.status()).toBe(404)
})

test('the skip link is still the first tab stop in Spanish', async ({ page }) => {
  await page.goto('/es')

  // WCAG 2.4.1. The toggle adds two focusable controls to the header, and the
  // English version of this assertion lives in `smoke.spec.ts` — the Spanish
  // one is here because the skip link's own text is translated too, so a
  // by-name check in English would pass for the wrong reason.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Saltar al contenido principal' })).toBeFocused()
})

test('the Spanish facility page has no axe violations', async ({ page }) => {
  await page.goto('/es/storage/tx/austin/demo-austin-south')

  await expect(page.getByRole('heading', { name: 'Unidades disponibles' })).toBeVisible()
  // The scan is not redundant with the English one: `lang` changed, the
  // toggle's per-button `lang` is new markup (SC 3.1.2 Language of Parts), and
  // longer Spanish strings are what break a name/label match.
  // a11y-state: /storage/[state]/[city]/[slug] | Spanish
  await assertNoAxeViolations(page)
})

test('a renter can reach the Spanish checkout from a Spanish facility page', async ({ page }) => {
  await page.goto('/es/storage/tx/austin/demo-austin-south')

  // The point of the whole session's scope: the funnel does not switch back to
  // English at the money moment. A renter dropped into an English checkout has
  // been served worse than one who was never offered Spanish.
  await page.getByRole('button', { name: 'Rentar ahora' }).first().click()
  // B-262: the Spanish checkout is at its own URL. A renter who reached it from
  // `/es/...` and landed on `/checkout` would be reading English at the money
  // moment, which is the failure this whole row exists to end.
  await expect(page).toHaveURL(/\/es\/checkout\?token=/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Múdese en línea')
  await expect(page.getByLabel('Correo electrónico')).toBeVisible()
})

// --- B-260: the portal ------------------------------------------------------
//
// B-090f translated the move-in path and then sent the renter to "Ir a mi
// cuenta" — an English account. These assert the other half: that every route
// the portal nav offers renders in Spanish, and that `<html lang>` follows the
// URL on a signed-in page as well as a public one.
//
// B-262: reached at `/es/portal/...`. The portal is `noindex` and behind a
// login, so it gains nothing from having its own URL — but it is prefixed
// anyway, because a second mechanism for "which language am I reading" is the
// thing most likely to disagree with the first, and the proxy strips the prefix
// before the auth gate sees the path either way.

test.describe('the portal in Spanish', () => {

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
      await page.goto(`/es${route}`)

      // SC 3.1.1 on a signed-in page: the portal is outside the `(public)`
      // route group, so it inherits neither the provider nor the toggle and
      // this is a genuinely separate mounting from the one B-090f asserted.
      await expect(page.locator('html')).toHaveAttribute('lang', 'es')
      await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(heading)
    })
  }

  test('the portal nav keeps a Spanish tenant in Spanish', async ({ page }) => {
    await signInAsDemoTenant(page)
    await page.goto('/es/portal')

    for (const name of ['Resumen', 'Formas de pago', 'Estados de cuenta', 'Documentos']) {
      await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible()
    }

    // B-262. `PortalNav` is a client component reading `usePathname()`, which
    // returns `/es/portal` after the proxy's rewrite — so an unprefixed link
    // here would drop the tenant into English on the next click, and the
    // `aria-current` that tells a screen-reader user where they are would never
    // match. Both were broken when this was first built.
    await page.getByRole('link', { name: 'Formas de pago', exact: true }).first().click()
    await expect(page).toHaveURL('/es/portal/methods')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByRole('link', { name: 'Formas de pago', exact: true }).first()).toHaveAttribute(
      'aria-current',
      'page',
    )

    // The toggle has to be INSIDE the portal too: a tenant who chose Spanish
    // while renting has no other way back to English once they are signed in.
    await expect(page.getByRole('link', { name: 'Cambiar a English' })).toBeVisible()
  })

  test('the Spanish portal dashboard has no axe violations', async ({ page }) => {
    await signInAsDemoTenant(page)
    await page.goto('/es/portal')

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mi cuenta')
    // Dana is seeded past-due with a suspended grant, so this scans the money
    // and access branches rather than an empty account.
    // a11y-state: /portal | Spanish
    await assertNoAxeViolations(page)
  })
})
