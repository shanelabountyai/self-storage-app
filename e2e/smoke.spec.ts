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

  // `exact` because B-068's lead form added a "Size you are interested in"
  // select further down the page — two controls may legitimately mention size,
  // so the filter is addressed precisely rather than by substring.
  await page.getByLabel('Size', { exact: true }).selectOption('small')
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
  await page.getByLabel('Email', { exact: true }).fill(email)
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
  await page.getByLabel('Email', { exact: true }).fill('ada@nowhere')
  await page.getByLabel('Mobile number').fill('512-555-0142')
  await page.getByRole('button', { name: 'Reserve for free' }).click()

  await expect(page.getByRole('main').getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true')
})

test('the cancel link shows the hold before releasing it', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  const card = page.getByRole('listitem').filter({ hasText: '10x10 Test' }).first()
  await card.getByRole('link', { name: 'Reserve for free' }).click()

  await page.getByLabel('First name').fill('Cancel')
  await page.getByLabel('Last name').fill('Me')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-cancel-${Date.now()}@demo.example.com`)
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
  // state that replaced it — `.first()` because B-111 stopped `AdminForm`
  // hiding its own empty live region, and the cancel form is still mounted
  // while this resolves.
  await expect(page.getByRole('main').getByRole('status').first()).toContainText(
    'back available',
  )
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
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-details-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  // Step 2 confirms the unit that was already locked, and names it.
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('Your unit')
  await expect(page.getByRole('main')).toContainText('/mo')
})

test('a checkout step change moves focus and announces where it went', async ({ page }) => {
  // B-110. The two things the suite had never asserted about dynamic state:
  // that focus MOVES where it should, and that a live region's text CHANGES on
  // the handle it was captured from. Structural presence was all that was
  // checked, and structural presence is exactly the half that was already true
  // while a renter pressing Continue heard nothing and was left on a submit
  // button that no longer existed.
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  // Captured BEFORE the action, and asserted on the same handle after: a region
  // that unmounts and is replaced by a populated one is not announced, and is
  // what a fresh locator would have hidden.
  const announcer = page.getByRole('main').getByRole('status').first()
  // `data-live` is set by the announcer's own effect. Waiting on it rather than
  // on mere attachment is the difference between a warm run and a cold one:
  // before hydration, Continue is a plain form post and a full document load,
  // which remounts the region and announces nothing.
  await expect(announcer).toHaveAttribute('data-live', 'true')
  await expect(announcer).toHaveText('')

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-focus-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()

  // Says where they are, in the words the progress indicator uses — not that
  // something happened.
  await expect(announcer).toHaveText(/Your unit — step 2 of 6/)

  // 2.4.3: focus is on the new step's heading, so the next Tab is into step 2
  // rather than back at the top of the document.
  await expect(page.locator('#step')).toBeFocused()
})

test('checkout step 1 stays inside the field cap, at a consumer tap size', async ({ page }) => {
  // B-112. §6.4 caps a step at seven visible fields; this one rendered
  // fourteen, on a phone, immediately after "Rent now". Asserted rather than
  // described so the next item cannot quietly re-add — which is exactly how it
  // got to fourteen.
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()
  await expect(page).toHaveURL(/\/checkout\?token=/)

  const form = page.getByRole('form', { name: 'Your details' })
  const visibleControls = form.locator(
    'input:not([type=hidden]):visible, select:visible, textarea:visible',
  )

  // Seven to fill, and the two consent boxes — which sit BELOW the primary
  // action, because marketing consent is the only thing on the screen that
  // serves us rather than the renter.
  await expect(visibleControls).toHaveCount(9)
  const names = await visibleControls.evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).name),
  )
  expect(names).toEqual([
    'firstName',
    'lastName',
    'email',
    'phone',
    'addressLine1',
    'addressLine2',
    'postalCode',
    'smsConsent',
    'marketingConsent',
  ])

  // City and state are read-only, derived from the zip, with the way to type
  // them by hand closed rather than absent.
  await expect(form.getByText('City and state', { exact: true })).toBeVisible()
  await expect(page.getByLabel('City')).toBeHidden()
  await expect(form.getByText('Enter my city and state myself')).toBeVisible()

  // §6.2: ≥44px. `CONTROL_CLASS` was `h-9` — 36px — on every public and portal
  // form in the product. Asserted on the RENDERED height, because the token now
  // resolves through a CSS variable and a broken variable would still compile.
  const zip = page.getByLabel('Zip code')
  expect((await zip.boundingBox())!.height).toBeGreaterThanOrEqual(44)
})

test('checkout goes back, from the control and from the progress indicator', async ({ page }) => {
  // B-111 / §6.4: "back navigation never loses data". `canEnter` has said since
  // B-020 that a completed step may be returned to; until this item nothing
  // rendered a control, so a renter who mistyped the address that receives the
  // lease, the receipt and the gate code found out at step 4 and could only
  // abandon.
  const email = `e2e-back-${Date.now()}@demo.example.com`
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()

  // The control names its destination rather than saying "Back" — a one-word
  // accessible name makes a screen-reader user infer where it goes.
  await page.getByRole('button', { name: 'Back to your details' }).click()
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email)

  // Forward again re-asks nothing, then back again from the progress
  // indicator, which is the other half of the requirement.
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()

  const progress = page.getByRole('navigation', { name: 'Checkout progress' })
  await progress.getByRole('button', { name: /Your details/ }).click()
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email)

  // Step 1 has nothing behind it, so it offers no way back rather than a
  // control that can only be refused.
  await expect(page.getByRole('button', { name: /^Back to/ })).toHaveCount(0)
})

test('a total that moves says what moved it', async ({ page }) => {
  // §6.4: `PriceSummaryProps.changeNote` existed from B-020 and was passed by
  // nobody, so choosing a protection tier moved both totals with no stated
  // cause, one screen before the card form.
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-note-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()

  const summary = page.getByRole('complementary', { name: 'What you are paying' })
  await page.getByRole('radio', { name: /\$5,000 cover/ }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your lease' })).toBeVisible()
  await expect(summary.getByRole('status')).toContainText(/Protection plan added/)

  // Cleared by the next step, not left standing — a note that outlives its
  // cause attributes the current total to a change two steps ago.
  await page.getByRole('button', { name: 'Back to protection' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()
  await expect(summary.getByRole('status')).toHaveText('')
})

test('the sticky price summary does not cover the payment step at 360px', async ({ page }) => {
  // §6.4 wants the summary persistent on every viewport; it must not buy that
  // by sitting on top of the control that charges. Asserted against the LOWEST
  // interactive element of the payment step — everything above it, the Payment
  // Element's own submit included, clears the bar if this does.
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-360-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your lease' })).toBeVisible()
  // Named, not positional. B-112 moved the active-duty declaration onto this
  // step, so `.first()` is no longer the E-SIGN consent — and checking the
  // wrong box gets the signature refused for a reason the test cannot see.
  await page.getByRole('checkbox', { name: /sign this agreement electronically/ }).check()
  await page.getByLabel('Type your full name to sign').fill('Ada Renter')
  await page.getByRole('button', { name: 'Sign and continue' }).click()
  // `exact`, because the payment step also renders an "Automatic payments"
  // heading (B-025's autopay disclosure) and Playwright matches an accessible
  // name by case-insensitive substring — so the unqualified name resolves to
  // two elements and violates strict mode. It only ever passed because that
  // section is client-rendered: on a loaded machine the assertion resolved
  // before it mounted, and on a quiet one both are present and it fails.
  await expect(page.getByRole('heading', { name: 'Payment', exact: true })).toBeVisible()

  const back = page.getByRole('button', { name: /^Go back|^Back to/ })
  await back.scrollIntoViewIfNeeded()
  const summary = page.getByRole('complementary', { name: 'What you are paying' })
  const [controlBox, summaryBox] = [await back.boundingBox(), await summary.boundingBox()]

  // `sticky` keeps the summary in flow, so it reserves its own space rather
  // than floating over what precedes it. That is the property being pinned:
  // swapping it for `fixed` would pass every other assertion here and hide the
  // control that charges behind the total.
  expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(summaryBox!.y + 1)
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
  await page.getByLabel('Email', { exact: true }).fill(`e2e-bad-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('555')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
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
  await page.getByLabel('Email', { exact: true }).fill(`e2e-resume-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
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
  await page.getByLabel('Email', { exact: true }).fill(`e2e-prot-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
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
  await page.getByLabel('Email', { exact: true }).fill(`e2e-lease-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
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

  // Consent and signature are separate acts, and an empty submit must name BOTH
  // — not stop at the first one it finds (3.3.1).
  await sign.click()
  const alert = page.getByRole('main').getByRole('alert')
  await expect(alert).toContainText('Type your full name')
  await expect(alert).toContainText('Tick the box to agree to sign electronically')

  // Named, not positional. B-112 moved the active-duty declaration onto this
  // step, so `.first()` is no longer the E-SIGN consent — and checking the
  // wrong box gets the signature refused for a reason the test cannot see.
  const consent = page.getByRole('checkbox', { name: /sign this agreement electronically/ })
  const typedName = page.getByLabel('Type your full name to sign')
  await consent.check()
  await typedName.fill('AR')
  await sign.click()
  await expect(alert).toContainText('That does not match the name on the lease')

  // B-124: the refusal must not take the consent tick with it. React 19 resets
  // a form once its action completes, so this step used to come back EMPTY —
  // and the renter, having fixed only the name they were told about, was then
  // refused for a box they had already ticked. This assertion is the whole
  // point of that fix; without it the next line would have to re-tick.
  await expect(consent).toBeChecked()

  await typedName.fill('Ada Renter')
  await sign.click()
  // `exact`, because the payment step also renders an "Automatic payments"
  // heading (B-025's autopay disclosure) and Playwright matches an accessible
  // name by case-insensitive substring — so the unqualified name resolves to
  // two elements and violates strict mode. It only ever passed because that
  // section is client-rendered: on a loaded machine the assertion resolved
  // before it mounted, and on a quiet one both are present and it fails.
  await expect(page.getByRole('heading', { name: 'Payment', exact: true })).toBeVisible()
})

test('the payment step itemises before it charges and discloses autopay', async ({ page }) => {
  await page.goto('/storage/tx/houston/demo-e2e')
  await page
    .getByRole('listitem')
    .filter({ hasText: '10x10 Test' })
    .first()
    .getByRole('button', { name: 'Rent now' })
    .click()

  await page.getByLabel('First name').fill('Ada')
  await page.getByLabel('Last name').fill('Renter')
  await page.getByLabel('Email', { exact: true }).fill(`e2e-pay-${Date.now()}@demo.example.com`)
  await page.getByLabel('Mobile number').fill('512-555-0100')
  await page.getByLabel('Street address').fill('2400 South Congress Ave')
  // B-112: no city, no state. 78704 derives "Austin, TX" from D-14's bundled
  // dataset, which is the whole reason those two inputs went away.
  await page.getByLabel('Zip code').fill('78704')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your unit' })).toBeVisible()
  await page.getByRole('button', { name: 'This is right' }).click()
  await expect(page.getByRole('heading', { name: 'Protect what you store' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The short version' })).toBeVisible()

  // Named, not positional. B-112 moved the active-duty declaration onto this
  // step, so `.first()` is no longer the E-SIGN consent — and checking the
  // wrong box gets the signature refused for a reason the test cannot see.
  await page.getByRole('checkbox', { name: /sign this agreement electronically/ }).check()
  await page.getByLabel('Type your full name to sign').fill('Ada Renter')
  await page.getByRole('button', { name: 'Sign and continue' }).click()

  // 3.3.4: everything being charged, itemised, before the act that charges it.
  await expect(page.getByRole('heading', { name: 'What you are paying today' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('Total due today')
  await expect(page.getByRole('main')).toContainText('Then each month')

  // §6.9 / D-11a: default-on, with the amount and date stated beside the
  // control and the opt-out one activation away.
  const autopay = page.getByRole('checkbox', { name: /Pay automatically each month/ })
  await expect(autopay).toBeChecked()
  // B-044 / D-27: anniversary billing, so the day is the renter's own move-in
  // day in the FACILITY's timezone — not a constant 1, and not the UTC day,
  // which is already tomorrow when this suite runs late in the evening here.
  const billingDay = Number(
    new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/Chicago' }).format(new Date()),
  )
  await expect(page.locator('#autopay-disclosure')).toContainText(
    `day ${Math.min(billingDay, 28)} of each month`,
  )
  await expect(autopay).toHaveAttribute('aria-describedby', 'autopay-disclosure')

  // Whichever of the two payment affordances is correct for this environment.
  // This test's subject is that everything is itemised BEFORE the control that
  // charges (3.3.4) — not which control that is. It asserted the unconfigured
  // fallback for the project's whole life, and started failing the hour a real
  // Stripe key arrived, which is the test encoding the environment rather than
  // the behaviour.
  // The Payment Element itself lives in a Stripe iframe with no selector of
  // ours, so this asserts on the control that CHARGES — which is the thing
  // 3.3.4 is actually about, and is ours.
  // "Pay and complete move-in" at checkout; "Pay $X" in the portal. Either is
  // the control that charges.
  const payButton = page.getByRole('button', { name: /^Pay\b/ })
  const callInstead = page.getByText("can't take card payments online just now")
  await expect(payButton.or(callInstead).first()).toBeVisible()
})

test('an unknown checkout link says so and charges nothing', async ({ page }) => {
  await page.goto('/checkout?token=not-a-real-session')
  await expect(page.getByRole('heading', { level: 1 })).toContainText("couldn't find that checkout")
  await expect(page.getByRole('main')).toContainText('Nothing has been charged')
})
