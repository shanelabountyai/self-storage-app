import { expect, test } from '@playwright/test'
import { LEGAL_PAGES } from '../apps/web/lib/site-config'

test('home page renders its search hero', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByLabel('Where do you need storage?')).toBeVisible()
})

test('the first tab stop is the skip link', async ({ page }) => {
  await page.goto('/')

  // Keyboard users must be able to bypass the header (WCAG 2.4.1), and the
  // skip link only works if it is genuinely the first focusable element.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused()
})

test('search submits to a shareable URL', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Where do you need storage?').fill('78704')
  await page.getByRole('button', { name: 'Find storage' }).click()

  // US-101: the query has to survive into a bookmarkable URL.
  await expect(page).toHaveURL(/\/storage\/search\?q=78704/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('78704')
})

test('search ranks real facilities with distance and a from-price', async ({ page }) => {
  // 78704 is the demo Austin facility's own zip, so it must rank first at
  // essentially zero distance (US-101).
  await page.goto('/storage/search?q=78704')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Austin, TX 78704')
  const first = page.getByRole('listitem').filter({ hasText: 'Demo — Austin South' }).first()
  await expect(first).toBeVisible()
  await expect(first).toContainText('mi')
  await expect(first).toContainText(/Units from \$\d/)
})

test('a search with nothing nearby offers the closest facilities instead', async ({ page }) => {
  // US-101: never a dead end. Anchorage is real, so this is the
  // "nothing within the radius" state, not the "we can't find that" one.
  await page.goto('/storage/search?q=99501')

  await expect(page.getByRole('heading', { name: /Nothing within \d+ miles/ })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Demo —' }).first()).toBeVisible()
})

test('an unrecognisable search names the problem and offers a human', async ({ page }) => {
  await page.goto('/storage/search?q=zzzzz')

  await expect(page.getByRole('heading', { name: /We couldn't find/ })).toBeVisible()
  // §6.7: full-page error states always include click-to-call. Scoped to main
  // because the header carries a phone link on every page — the point is that
  // the error state itself offers a human, not that the chrome does.
  await expect(page.getByRole('main').getByRole('link', { name: /^Call/ })).toBeVisible()
})

test('search works with JavaScript disabled', async ({ browser }) => {
  // The form is a plain GET form and "Use my location" is purely additive, so
  // the core journey must not depend on the client bundle at all.
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  await page.goto('/')
  await page.getByLabel('Where do you need storage?').fill('78704')
  await page.getByRole('button', { name: 'Find storage' }).click()

  await expect(page).toHaveURL(/\/storage\/search\?q=78704/)
  await expect(page.getByRole('listitem').filter({ hasText: 'Demo — Austin South' }).first()).toBeVisible()
  await context.close()
})

test('a search result links through to its facility page', async ({ page }) => {
  await page.goto('/storage/search?q=78704')
  await page.getByRole('link', { name: 'Demo — Austin South' }).click()

  // US-103: the crawlable URL scheme is /storage/{state}/{city}/{slug}. The
  // `from` parameter carries the search onward so the facility page can offer
  // a way back; it is not part of the canonical path.
  await expect(page).toHaveURL(/\/storage\/tx\/austin\/demo-austin-south(\?|$)/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo — Austin South')
})

test('the facility page separates office hours from gate hours', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  // §6.3: these must never be conflated. The demo facility's office is shut on
  // Sunday while the gate is open — if one table were rendering for both, this
  // pair could not both hold.
  const office = page.getByRole('table', { name: 'Office hours' })
  const gate = page.getByRole('table', { name: 'Gate access hours' })
  await expect(office.getByRole('row').filter({ hasText: 'sunday' })).toContainText('Closed')
  await expect(gate.getByRole('row').filter({ hasText: 'sunday' })).toContainText('8:00 AM')
})

test('the facility page offers click-to-call without scrolling', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  // §4.1 US-103: visible without scrolling on mobile. Asserted as "inside the
  // first viewport", which is what that sentence means on a phone.
  const call = page.getByRole('main').getByRole('link', { name: /^Call/ })
  await expect(call).toBeVisible()
  const box = await call.boundingBox()
  const viewport = page.viewportSize()!
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
})

test('a non-canonical facility URL redirects to the canonical one', async ({ page }) => {
  // The slug alone resolves the facility, so the state/city segments are
  // forgeable. One URL per facility in the index, not one per spelling.
  await page.goto('/storage/ca/nowhere/demo-austin-south')
  await expect(page).toHaveURL('/storage/tx/austin/demo-austin-south')
})

test('an unknown facility 404s rather than rendering an empty page', async ({ page }) => {
  const response = await page.goto('/storage/tx/austin/no-such-facility')
  expect(response?.status()).toBe(404)
})

test('every footer legal page resolves', async ({ page }) => {
  for (const legalPage of LEGAL_PAGES) {
    const response = await page.goto(legalPage.href)
    expect(response?.status(), `${legalPage.href} should not 404`).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
})

// Reflow moved to e2e/a11y.spec.ts in B-093, where it runs over every public
// route rather than the homepage alone — the two-column hours grid and the unit
// tables are the things that break out of 320px, and neither is on the homepage.

test('the skip link paints a real focus indicator', async ({ page }) => {
  // The programmatic half of WCAG 1.4.11 for focus. A machine can check that an
  // indicator is drawn and how thick it is; it cannot check that it is visible
  // against what is behind it — tests/contrast-tokens.test.ts does the contrast
  // arithmetic, and a human still has to look at it in Safari, whose handling of
  // `outline-style: auto` differs from Chromium's.
  await page.goto('/')
  await page.keyboard.press('Tab')

  const indicator = await page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null
    const style = getComputedStyle(el)
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      boxShadow: style.boxShadow,
    }
  })

  expect(indicator, 'nothing was focused after one Tab').not.toBeNull()
  const drawn =
    (indicator!.outlineStyle !== 'none' && indicator!.outlineWidth >= 2) ||
    indicator!.boxShadow !== 'none'
  expect(drawn, `focused element draws no indicator: ${JSON.stringify(indicator)}`).toBe(true)
})

test('a unit shows both rates only when they differ', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  // The demo facility prices every size below its street rate, so the saving
  // must be stated in words as well as struck through — a line through a
  // number is a visual-only signal (1.4.1).
  const card = page.getByRole('listitem').filter({ hasText: '10x10 Climate' }).first()
  await expect(card).toContainText('/mo online')
  await expect(card).toContainText('off for renting online')
})

test('"What you\'d pay today" itemizes and foots', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  const card = page.getByRole('listitem').filter({ hasText: '10x10 Climate' }).first()
  await card.getByText("What you'd pay today").click()

  // US-301: rent, the one-time fee, tax, and the protection plan named even
  // though it costs nothing yet — plus both totals.
  await expect(card).toContainText('First month rent')
  await expect(card).toContainText('One-time admin fee')
  await expect(card).toContainText('Tax')
  await expect(card).toContainText('Protection plan')
  await expect(card).toContainText('Total due today')
  await expect(card).toContainText('Then each month')
})

test('filters narrow the list and survive into the URL', async ({ page }) => {
  await page.goto('/storage/tx/austin/demo-austin-south')

  await page.getByLabel('Size').selectOption('small')
  // 3.2.2: selecting must not navigate on its own.
  await expect(page).not.toHaveURL(/size=small/)

  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page).toHaveURL(/size=small/)
  await expect(page.getByRole('status')).toContainText('1 size matches')
})

test('a filter combination with no matches offers a way out', async ({ page }) => {
  // §6.7: name the problem and the next action. "Nothing matches" is a
  // different problem from "this facility has nothing", and needs different copy.
  await page.goto('/storage/tx/austin/demo-austin-south?size=small&features=driveUp')

  await expect(page.getByRole('main')).toContainText('Nothing here matches those filters')
  await expect(page.getByRole('link', { name: 'Clear them' })).toBeVisible()
})

test('a search result carries its query into the facility page', async ({ page }) => {
  await page.goto('/storage/search?q=78704')
  await page.getByRole('link', { name: 'Demo — Austin South' }).click()

  // US-103: a comparer must be able to get back without retyping their zip.
  await expect(page.getByRole('link', { name: /Back to storage near 78704/ })).toBeVisible()
  await page.getByRole('link', { name: /Back to storage near 78704/ }).click()
  await expect(page).toHaveURL(/\/storage\/search\?q=78704/)
})

test('the size guide answers the question the links promise', async ({ page }) => {
  await page.goto('/storage/size-guide')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('What size')
  await expect(page.getByRole('heading', { name: '10 foot by 10 foot' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('half a standard garage')
})

test('reserving a unit holds it, for free, with no account', async ({ page }) => {
  // US-401 / D-7: no password, no card. The whole journey from a unit card to
  // a confirmed hold.
  await page.goto('/storage/tx/houston/demo-e2e')
  const card = page.getByRole('listitem').filter({ hasText: '10x10 Test' }).first()
  await card.getByRole('link', { name: 'Reserve for free' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reserve this unit')
  await expect(page.getByRole('main')).toContainText('No credit card needed')

  const email = `e2e-${Date.now()}@demo.example.com`
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Prospect')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mobile number').fill('512-555-0142')
  await page.getByRole('button', { name: 'Reserve for free' }).click()

  await expect(page).toHaveURL(/\/reservations\?token=/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your unit is reserved')
  // 2.2.1: the hold is communicated as an absolute date and time, never a
  // countdown the renter cannot pause.
  await expect(page.getByRole('main')).toContainText('We hold it until')
  await expect(page.getByRole('main')).toContainText('Nothing has been charged')

  // Give the unit back. Unlike every other test in this suite these hold real
  // inventory, and the demo facility has a finite number of lockers — a test
  // that keeps what it takes quietly sells the size out after a few runs and
  // then fails for a reason that has nothing to do with the code.
  await page.getByRole('button', { name: 'Cancel this reservation' }).click()
})

test('an invalid reservation reports the problem next to the field', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  const card = page.getByRole('listitem').filter({ hasText: '10x10 Test' }).first()
  await card.getByRole('link', { name: 'Reserve for free' }).click()

  // A syntactically valid but wrong-looking email gets past the browser's own
  // check, so the server's message is what the renter actually sees.
  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Prospect')
  await page.getByLabel('Email').fill('ada@nowhere')
  await page.getByLabel('Mobile number').fill('512-555-0142')
  await page.getByRole('button', { name: 'Reserve for free' }).click()

  await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
})

test('the cancel link shows the hold before releasing it', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  const card = page.getByRole('listitem').filter({ hasText: '10x10 Test' }).first()
  await card.getByRole('link', { name: 'Reserve for free' }).click()

  await page.getByLabel('First name').fill('Cancel')
  await page.getByLabel('Last name').fill('Me')
  await page.getByLabel('Email').fill(`e2e-cancel-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0143')
  await page.getByRole('button', { name: 'Reserve for free' }).click()
  await expect(page).toHaveURL(/\/reservations\?token=/)

  // 3.3.4: landing on the page cancels nothing — a mail client prefetching the
  // link must not release someone's unit. Cancelling is a separate POST.
  // Re-enter the way the emailed link does: the token alone, without the
  // `new=1` the post-submit redirect carries.
  const token = new URL(page.url()).searchParams.get('token')!
  await page.goto(`/reservations?token=${encodeURIComponent(token)}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your reservation')
  await expect(page.getByRole('button', { name: 'Cancel this reservation' })).toBeVisible()

  await page.getByRole('button', { name: 'Cancel this reservation' }).click()
  // The cancel form is gone once the hold is, so the outcome is reported by the
  // state that replaced it.
  await expect(page.getByRole('main').getByRole('status')).toContainText('back available')
  await expect(page.getByRole('button', { name: 'Cancel this reservation' })).toHaveCount(0)
})

test('a reservation link that is not real says so without leaking why', async ({ page }) => {
  await page.goto('/reservations?token=definitely-not-a-real-token')
  await expect(page.getByRole('heading', { level: 1 })).toContainText("isn't good any more")
  await expect(page.getByRole('main').getByRole('link', { name: /^Call/ })).toBeVisible()
})

test('Rent now starts a checkout and holds the unit', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  const card = page.getByRole('listitem').filter({ hasText: '10x10 Test' }).first()
  await card.getByRole('button', { name: 'Rent now' }).click()

  await expect(page).toHaveURL(/\/checkout\?token=/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Move in online')

  // §6.4: the price summary is the stepper's chrome, so the total is visible
  // at step 1 rather than first appearing on the screen that asks for a card.
  await expect(page.getByRole('main')).toContainText('Due today')
  await expect(page.getByRole('main')).toContainText('/mo')

  // §6.8.1: the progress indicator carries its state in words, not colour.
  const progress = page.getByRole('navigation', { name: 'Checkout progress' })
  await expect(progress).toContainText('Your details')
  await expect(progress.getByText(/step 1 of 6, current step/)).toBeAttached()
})

test('checkout step 1 creates an account with no password', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  // US-501 step 1 / FR-5.1: no password field anywhere, and no verification
  // wall in front of a move-in.
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email').fill(`e2e-details-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  await page.getByLabel('City').fill('Austin')
  await page.getByLabel('State').fill('TX')
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // Step 2 confirms the unit that was already locked, and names it.
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('Your unit')
  await expect(page.getByRole('main')).toContainText('/mo')
})

test('checkout step 1 reports a bad field with a suggestion', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email').fill(`e2e-bad-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('555')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  await page.getByLabel('City').fill('Austin')
  await page.getByLabel('State').fill('TX')
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // 3.3.1/3.3.3: identified, tied to the field, and carrying a suggestion.
  await expect(page.getByRole('main').getByRole('alert')).toContainText('area code')
  await expect(page.getByLabel('Mobile number')).toHaveAttribute('aria-invalid', 'true')
})

test('the checkout stepper advances server-side and resumes', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)
  const url = page.url()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email').fill(`e2e-resume-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  await page.getByLabel('City').fill('Austin')
  await page.getByLabel('State').fill('TX')
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()

  // FR-4.1: resumable. Re-entering the same link lands on the step the renter
  // left, not back at the start — the session is the truth, not the tab.
  await page.goto('/')
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
})

test('the protection step cannot be skipped and updates the total', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email').fill(`e2e-prot-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  await page.getByLabel('City').fill('Austin')
  await page.getByLabel('State').fill('TX')
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'This is right' }).click()

  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()
  // US-501: the mid tier is preselected and changeable in one tap.
  await expect(page.getByRole('radio', { name: /\$3,000 cover/ })).toBeChecked()

  // Choosing "my own cover" without the record is refused with a named error,
  // not a disabled button (3.3.1).
  await page.getByRole('radio', { name: /I have my own cover/ }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Insurer')).toHaveAttribute('aria-invalid', 'true')

  // A plan instead, and the recurring total moves with a stated cause (§6.4).
  await page.getByRole('radio', { name: /\$5,000 cover/ }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('main')).toContainText('Your lease')
  await expect(page.getByRole('main')).toContainText('Protection')
})

test('the lease shows a summary first and signs with a typed name', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email').fill(`e2e-lease-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  await page.getByLabel('City').fill('Austin')
  await page.getByLabel('State').fill('TX')
  await page.getByLabel('Zip code').fill('78704')
  // Each step is awaited before the next click. Two reasons: the server action
  // has to land before the next page exists, and Playwright's `name` match is a
  // case-insensitive SUBSTRING — so a bare "Continue" also matches
  // "This is right — continue" and can re-click the previous step's button.
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // §6.4: the plain-language summary is real page content above the full text.
  await expect(page.getByRole('heading', { name: 'The short version' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The full agreement' })).toBeVisible()

  // §6.4/§6.8.1: the signature control is available immediately — never gated
  // on scrolling, which is broken for anyone who does not scroll.
  const sign = page.getByRole('button', { name: 'Sign and continue' })
  await expect(sign).toBeEnabled()

  // Consent and signature are separate acts; missing either is a named error.
  await sign.click()
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible()

  await page.getByRole('checkbox').first().check()
  await page.getByLabel('Type your full name to sign').fill('AR')
  await sign.click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Ada Renter')

  await page.getByLabel('Type your full name to sign').fill('Ada Renter')
  await sign.click()
  await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible()
})

test('an unknown checkout link says so and charges nothing', async ({ page }) => {
  await page.goto('/checkout?token=not-a-real-session')
  await expect(page.getByRole('heading', { level: 1 })).toContainText("couldn't find that checkout")
  await expect(page.getByRole('main')).toContainText('Nothing has been charged')
})
