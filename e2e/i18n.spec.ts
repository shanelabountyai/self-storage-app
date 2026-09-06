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

  // B-259 (D-125). The three consent boxes were the last English thing on this
  // screen, and the one that mattered most: a renter cannot give express
  // written consent to words they cannot read. Asserted here rather than in a
  // unit test because the failure mode is a page that renders — the strings
  // are not dictionary entries, so `Dictionary` cannot catch a missing one.
  await expect(page.getByText('Acepto recibir mensajes de texto sobre mi cuenta')).toBeVisible()
  await expect(page.getByText('Envíenme correos electrónicos ocasionales')).toBeVisible()
  await expect(page.getByText('Acepto recibir mensajes de texto promocionales')).toBeVisible()

  // STOP and HELP are the literal strings the classifier matches, so they stay
  // English inside the Spanish sentence. A translated keyword is an
  // instruction that does nothing.
  await expect(page.getByText('Responda STOP para darse de baja').first()).toBeVisible()

  // The locale that was RENDERED, carried to the action — this is what stamps
  // the consent rows, and reading the cookie again at submit time would get it
  // wrong for anyone who used the language toggle after the page drew.
  await expect(page.locator('input[name="disclosureLocale"]')).toHaveValue('es')
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

// --- B-262: the static pages ------------------------------------------------
//
// The prose a renter READS rather than operates. Two claims, and the second is
// the one worth a test: the pages that were translated are Spanish, and the
// pages D-122 keeps in English are still English. That second half is a
// decision, not an omission — a later session translating `/terms` out of
// tidiness would reverse it silently, and this is where that shows up.

test.describe('the static pages in Spanish', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([SPANISH])
  })

  const TRANSLATED: [string, RegExp][] = [
    ['/faq', /Preguntas frecuentes/],
    ['/about', /Acerca de nosotros/],
    ['/contact', /Contacto/],
    ['/accessibility', /Accesibilidad/],
    // B-259 (D-124/D-125).
    ['/messaging-policy', /Política de mensajes de texto/],
  ]

  for (const [route, heading] of TRANSLATED) {
    test(`${route} renders in Spanish`, async ({ page }) => {
      await page.goto(route)
      await expect(page.locator('html')).toHaveAttribute('lang', 'es')
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading)
    })
  }

  // D-122: anything a lawyer wrote stays English until somebody with a licence
  // says otherwise. `/messaging-policy` LEFT this list at B-259 — it is the
  // TCPA / A2P 10DLC disclosure, and it could only be translated once the
  // disclosures it explains had a Spanish version of their own to point at.
  const ENGLISH_ONLY: [string, RegExp][] = [
    ['/terms', /Terms of service/],
    ['/privacy', /Privacy/],
  ]

  for (const [route, heading] of ENGLISH_ONLY) {
    test(`${route} is deliberately still English`, async ({ page }) => {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading)
    })
  }

  // B-259. The keywords are rendered from `sms-keywords.ts` rather than typed
  // into the prose, which is what stops a translated page from publishing an
  // instruction that does nothing — and what stops the published list drifting
  // from what `classifySmsKeyword` accepts.
  test('the Spanish messaging policy keeps the keywords in English', async ({ page }) => {
    await page.goto('/messaging-policy')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByText('Responda STOP a cualquier mensaje nuestro')).toBeVisible()
    await expect(page.getByText('STOPALL, UNSUBSCRIBE, CANCEL, END y QUIT')).toBeVisible()
    await expect(page.getByText('responda START o UNSTOP')).toBeVisible()

    // One constant, formatted per locale — the English page dates itself
    // "August 2026" and cannot be rendered in a second language as prose.
    await expect(page.getByText('Última revisión: agosto de 2026')).toBeVisible()
  })

  test('the accessibility statement names its gaps in Spanish too', async ({ page }) => {
    await page.goto('/accessibility')

    // The generated half. Both exception lists are rendered from
    // `scan-coverage.ts`, and rendering half a list of gaps in the reader's
    // language reads as though the untranslated rows did not matter.
    await expect(page.getByText('las corridas de revisión automática no llevan la cookie')).toBeVisible()
    await expect(page.getByText('el recibo de un pago que de verdad se aprobó')).toBeVisible()

    // One constant, formatted per locale — the English page dates itself
    // "19 August 2026" and this one must not silently slide a day (B-228).
    await expect(page.getByText('Última revisión: 19 de agosto de 2026.')).toBeVisible()
  })
})

// --- B-261: the language we WRITE to a tenant in ----------------------------
//
// The control for `Tenant.preferredLocale`, which is a different fact from the
// `st_locale` cookie every spec above exercises: the cookie is this browser,
// this device, and it is gone with the cache; this is what `deliverForRule`
// reads when it sends a receipt, a payment reminder or a dunning email six
// months from now.
//
// **Shared-state discipline (B-120).** This mutates the demo tenant, so it
// takes protection (1): the mutation is scoped to a column no other spec
// asserts a fixed value against — nothing in the suite reads
// `preferredLocale`, because nothing in the suite sends an email. The spec
// also puts it back, so a full sweep run twice sees the same starting state
// both times; the restore is belt-and-braces rather than the protection
// itself, because a failure between the two halves must not be able to break
// a neighbouring spec, and here it cannot.

test.describe('the language a tenant is written to in', () => {
  test('a tenant can choose it, and it is not the same switch as the header toggle', async ({
    page,
    context,
  }) => {
    await context.addCookies([SPANISH])
    await signInAsDemoTenant(page)
    await page.goto('/portal/notifications')

    const select = page.getByLabel('Idioma para correos y mensajes de texto')
    await expect(select).toBeVisible()

    // The options are named in the language each one NAMES, so "Español" is
    // legible to exactly the person who needs to find it.
    await expect(select.locator('option')).toHaveText(['English', 'Español'])

    await select.selectOption('es')
    await page.getByRole('button', { name: 'Guardar idioma' }).click()

    // Confirmed in the language just chosen — it is the first sentence of the
    // change taking effect, not a report about it.
    await expect(page.getByText('A partir de ahora le escribiremos en español')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')

    // D-122 is stated where the choice is made: the lease and any mailed
    // notice stay English, and a tenant choosing Spanish must not be left
    // believing otherwise.
    await expect(
      page.getByText('Su contrato y cualquier aviso formal', { exact: false }),
    ).toBeVisible()

    // Put it back, so the sweep is repeatable — and prove the control works in
    // both directions while doing it.
    await page.getByLabel('Idioma para correos y mensajes de texto').selectOption('en')
    await page.getByRole('button', { name: 'Guardar idioma' }).click()
    await expect(page.getByText('We will write to you in English from now on')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })
})
