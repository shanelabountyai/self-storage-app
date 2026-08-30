import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'

// PRD 02 §4.6 US-30 (B-129). The advertising half of US-30 that does not depend
// on master PRD §11 OQ-9 being answered.
//
// Read-only throughout, per B-120's rule for shared demo fixtures: nothing here
// schedules, approves or cancels anything. The demo seed opens an auction case
// for the `pending_auction` lease and stops there, so what this asserts is the
// state that actually ships — a case that exists, is not scheduled, and is
// therefore correctly absent from the lot sheet with the reason said out loud.
// That is the load-bearing half of this screen: the download is easy, and a
// short file nobody realises is short is the failure mode.

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('names the scheduled sales that are NOT on the lot sheet, and why', async ({ page }) => {
    await page.goto('/admin/auctions')
    await expect(page.getByRole('heading', { name: 'Advertising the sale' })).toBeVisible()

    const cases = page.getByRole('heading', { name: /^Open cases \(/ })
    await expect(cases).toBeVisible()
    // A facility with no case at all would make everything below vacuously
    // true, so the fixture is asserted rather than assumed.
    await expect(cases).not.toHaveText('Open cases (0)')

    // Nothing in the demo seed is approved or scheduled, so there is nothing
    // lawful to advertise and the screen says so rather than offering a file.
    await expect(page.getByText('No sale here is ready to advertise')).toBeVisible()
    await expect(page.getByRole('link', { name: /Download the lot sheet/ })).toHaveCount(0)

    // And the case that exists is accounted for by name, not silently dropped.
    const notOnSheet = page.getByRole('heading', { name: /^Not on the sheet \(/ })
    await expect(notOnSheet).toBeVisible()
    await expect(page.getByText('No sale has been scheduled yet')).toBeVisible()
  })

  test('the lot sheet route is a CSV with its header row, never a cached one', async ({ page }) => {
    // The wiring, which the unit tests cannot see: route registration, the
    // facility parameter, and the caching posture. `no-store` is not tidiness
    // — readiness is live, and a lot sheet served from a cache is an
    // advertisement for a sale that may since have been settled.
    //
    // The facility id comes from the switcher's own option values rather than
    // from a cookie or a guess, so this asserts one outcome instead of
    // branching on whether it resolved — a test with an `else` that also
    // passes is not testing the route.
    await page.goto('/admin/auctions')
    // The switcher's CURRENT value, not its first option — the first option is
    // the "All facilities" sentinel (`all`), which is not a facility id and
    // produced a 404 from this route rather than a sheet. The section under
    // test only renders for a single resolved facility, so reading the
    // resolved value is both correct and the thing the page is already using.
    const facilityId = await page.getByLabel('Switch facility').inputValue()
    expect(facilityId, 'the auctions screen resolved no single facility').not.toBe('all')
    expect(facilityId).toBeTruthy()

    const response = await page.request.get(`/admin/auctions/lots.csv?facility=${facilityId}`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/csv')
    expect(response.headers()['cache-control']).toContain('no-store')
    // B-205: no generated `Lot` column — it was `index + 1` over whatever
    // passed readiness at that moment, so it named a different unit on a later
    // download. `Unit` and `Case reference` identify a lot for its whole life.
    // `Tenant`, `Sale time` and `Description of goods` are the three
    // elements a lien advertisement must carry, and all three were missing.
    expect((await response.text()).split('\r\n')[0]).toBe(
      'Facility,Address,City,State,ZIP,Unit,Tenant,Description of goods,Size,Width ft,Length ft,Sq ft,Sale date,Sale time,Terms,Case reference',
    )
  })

  test('refuses a lot sheet with no facility named', async ({ page }) => {
    // The parameter is what scopes the sheet to one facility's cases, and a
    // lien sale is governed by the state its facility is in — so a missing one
    // is refused rather than defaulted.
    const response = await page.request.get('/admin/auctions/lots.csv')
    expect(response.status()).toBe(400)
  })
})
