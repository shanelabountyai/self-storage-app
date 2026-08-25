import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { OWNER_STATE, signInAsDemoOwner } from './sign-in'

// PRD 09 §5 (B-091 part 2). The arc the feature is judged on: an owner answers
// "what does this tenant actually see?" without a screen-share, cannot change
// anything while they are looking, and gets back to their own account in one
// click.
//
// **Shared-fixture discipline (B-120), and this spec needed two goes at it.**
// Walking the demo tenant the portal suites depend on is safe for the strongest
// possible version of discipline (1): the session is read-only by construction,
// so nothing about Dana Delinquent changes at all.
//
// The shared state it DOES consume is SR-7's throttle — ten session starts per
// impersonator per hour — and the first draft got that wrong. Two tests across
// two Playwright projects is FOUR starts per sweep, so the third consecutive
// sweep inside an hour hit the ceiling exactly and both desktop tests failed on
// a URL assertion, which reads like a broken feature and was the throttle
// working. Measured, not inferred: `select count(*) from impersonation_session
// where "startedAt" > now() - interval '60 minutes'` returned precisely 10.
//
// Two changes came out of it. The arc is ONE test, so a sweep costs two starts
// and five consecutive sweeps fit in an hour. And when the throttle does refuse,
// the test SELF-SKIPS naming it — discipline (2) — because the alternative is a
// future session debugging an impersonation bug that does not exist.

test.describe('support impersonation', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  /// Returns the refusal text when the start was refused, or null when the
  /// session is running. Only the throttle is treated as skippable — every
  /// other refusal is a real failure and is asserted on by the caller.
  async function startSession(page: Page, reason: string): Promise<string | null> {
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await expect(page).toHaveURL(/\/admin\/tenants\/.+/)

    // B-181 put the form behind a closed <details> in the Actions region — it
    // is used a few times a month and stood between the banner stack and the
    // units. Opening it is what a staffer now does too.
    await page.locator('summary').filter({ hasText: 'View the portal as this tenant' }).click()

    const form = page.getByRole('form', { name: 'Start a support session as this tenant' })
    await form.getByLabel('Reason').fill(reason)
    await form.getByRole('button', { name: 'Start support session' }).click()

    // Wait for the REDIRECT, not for "the URL matches either outcome" — the
    // first draft polled for either and matched the tenant profile it was
    // already on, so it read a pristine form microseconds after the click and
    // reported a refusal with no error text in it. Only the success has
    // something to wait for; the refusal is what is left when it does not come.
    const started = await page
      .waitForURL(/\/portal$/, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    if (started) return null
    return (await form.textContent()) ?? ''
  }

  test('an owner starts a read-only session, cannot change anything, and gets back in one click', async ({
    page,
  }, testInfo) => {
    // The reason carries the project name because BOTH Playwright projects run
    // this spec against the same database: a fixed string put two identical
    // rows on the record and the assertion below failed on a strict-mode
    // violation rather than on anything being wrong.
    const reason = `E2E ${testInfo.project.name} — what does this tenant actually see`
    const refusal = await startSession(page, reason)
    test.skip(
      refusal !== null && /support sessions in the last hour/.test(refusal),
      'SR-7 throttle reached — see the note at the top of this file',
    )
    expect(refusal, 'the session was refused for a reason other than the throttle').toBeNull()

    // FR-22/D-13d: the REAL portal at its real URL, not a copy embedded in the
    // admin shell. The URL is that requirement.
    const banner = page.getByTestId('impersonation-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Dana Delinquent')
    await expect(banner).toContainText('Read-only')

    // FR-12/SR-4's gate-code masking is NOT asserted, and the reason is worth
    // stating rather than leaving as an omission: it cannot be observed end to
    // end in this project at all. `ACCESS_CODE_ENCRYPTION_KEY` is unconfigured
    // everywhere by design (lib/access/secret.ts — "no safe dev fallback"), so
    // `codeForLease()` returns null for every demo lease and the panel never
    // renders for anybody, impersonated or not; portal.spec.ts records the same
    // gap for the panel's own reveal interaction. An assertion here would pass
    // whether or not the masking exists, which is worse than none — it would
    // read as coverage of the one item on FR-12's hard-block list that is not a
    // mutation. This tenant is also the seeded delinquent one, so the
    // suspended-access branch correctly wins ahead of the masking branch: what
    // she sees is why the gate will not open, which is what a support call is
    // about.

    // FR-15. Scanned WITH the banner on screen, which is the state a
    // screen-reader user actually meets — a scan of the portal without it would
    // assert nothing about the one element this item adds.
    await expect(page.getByRole('main')).toBeVisible()
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(
      violations.map((v) => `${v.id}: ${v.help}`),
      'axe found accessibility violations',
    ).toEqual([])

    // FR-11/FR-13/SR-2. Posted directly rather than by clicking a button,
    // because the whole point of the control is that it does not depend on the
    // UI having hidden anything: this is the request a page that forgot would
    // make, and a page nobody has written yet cannot be made to hide it.
    const blockedPortal = await page.request.post('/portal/methods')
    expect(blockedPortal.status()).toBe(403)
    expect(await blockedPortal.text()).toContain('read-only support session')

    // Not just the portal. A staff-subject session browses /admin, and the
    // block is about the session rather than about which shell it is in.
    expect((await page.request.post('/admin/tenants')).status()).toBe(403)

    // FR-14: persistent. It survives navigation within the session rather than
    // being a one-off flash on the screen the session started on.
    await page.goto('/portal/statements')
    await expect(page.getByTestId('impersonation-banner')).toBeVisible()

    // WCAG 1.4.10. The banner is a new sticky element at the top of every page
    // of a session, which is the exact shape B-116 proved is invisible until
    // measured — a nested scroll region there would push the document wide.
    await page.setViewportSize({ width: 320, height: 800 })
    await expect(page.getByTestId('impersonation-banner')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflow, 'the impersonation banner scrolls the portal sideways at 320px').toBe(false)

    // FR-5: one click back, no re-login, because the real identity was never
    // discarded.
    await page.getByRole('button', { name: 'Return to my account' }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByTestId('impersonation-banner')).toHaveCount(0)

    // And the block lifted with the session rather than merely stopping being
    // displayed — the owner's own authority is intact.
    expect((await page.request.post('/admin/tenants')).status()).not.toBe(403)

    // FR-19 (B-092). The session that just finished is on the oversight record,
    // with the reason that was typed to start it. Asserted here rather than in
    // its own test because it costs no extra session against SR-7's throttle,
    // and because a record that only holds sessions nobody walked would be
    // asserting the wrong thing.
    await page.goto('/admin/impersonation')
    await expect(page.getByRole('cell', { name: reason })).toBeVisible()
  })

  test('an owner can force-end somebody else’s running session (FR-18)', async ({
    page,
    browser,
  }, testInfo) => {
    // Two contexts, because the requirement genuinely needs two people: while a
    // session is running, /admin renders as the SUBJECT, so the impersonator
    // cannot reach the oversight screen to end their own. `page` is the
    // overseer; `driver` is the one being overseen.
    const driverContext = await browser.newContext({ storageState: OWNER_STATE })
    const driver = await driverContext.newPage()

    try {
      // Project-unique, and here it is not cosmetic: both projects run in
      // parallel against one database, so "Running right now" legitimately
      // contains the OTHER project's session as well. Ending the first card on
      // the page would reach across and kill it — the tests would then fail
      // each other in a way that reads like a broken force-end.
      const reason = `E2E ${testInfo.project.name} — force end`
      const refusal = await startSession(driver, reason)
      test.skip(
        refusal !== null && /support sessions in the last hour/.test(refusal),
        'SR-7 throttle reached — see the note at the top of this file',
      )
      expect(refusal, 'the session was refused for a reason other than the throttle').toBeNull()
      await expect(driver.getByTestId('impersonation-banner')).toBeVisible()

      await page.goto('/admin/impersonation')
      // Located by the reason, which is the only field that distinguishes two
      // sessions the same owner started against the same tenant.
      const card = page.locator('li').filter({ hasText: reason })
      await expect(card).toHaveCount(1)
      await card.getByRole('button', { name: 'End this session' }).click()

      // Wait for the end to actually land before asking the other context to
      // prove it. Clicking and immediately navigating `driver` is a race the
      // first draft lost: the assertion ran against a session that was still
      // running, and reported the force-end as broken.
      await expect(card).toHaveCount(0)

      // FR-18 says "immediately", and §6.1's argument for keeping the state in a
      // row rather than in the token is exactly this: there is nothing to wait
      // out. The driver's very next request re-reads the row, finds it ended,
      // and drops them back to their own account.
      await driver.goto('/portal')
      await expect(driver).toHaveURL(/\/admin$/)
      await expect(driver.getByTestId('impersonation-banner')).toHaveCount(0)
    } finally {
      await driverContext.close()
    }
  })
})
