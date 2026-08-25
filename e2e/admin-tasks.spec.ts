import { expect, test } from '@playwright/test'
import { signInAsDemoOwner } from './sign-in'
import { assertNoAxeViolations, expectAnnounced, expectPreexisting } from './a11y-helpers'

// PRD 02 §4.9 US-41 (B-095). "My day": the shared task queue every future
// admin queue (delinquency, field ops, failed payments) will read and write
// instead of inventing its own.

test.describe('tasks role gating', () => {
  test('redirects an unauthenticated visitor to /login', async ({ page }) => {
    await page.goto('/admin/tasks')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('signed in as the demo owner', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test('/admin/tasks has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/admin/tasks')
    await expect(page.getByRole('main')).toBeVisible()

    await assertNoAxeViolations(page)
  })

  test('flagging returned mail creates a task, and completing it clears the list', async ({ page }, testInfo) => {
    // Runs on one project only: mobile-chrome and desktop-chrome share the
    // same real demo database, and both hitting this shared tenant at once
    // is a genuine race (whichever completes first removes the task the
    // other is mid-way through asserting on) — not something to work around
    // with a retry, since the underlying action is real and not idempotent
    // in the way a page reload is.
    test.skip(testInfo.project.name !== 'desktop-chrome', 'shares real demo state with the other project — see note')

    // Exercises the real, already-reachable consumer (B-038's "Flag as
    // returned mail" button) end to end into the shared queue, then all the
    // way through completion — one test, not two, and deliberately so: a
    // `returned_mail_review` task is idempotent per (tenant, business day),
    // which is the correct guarantee (tests/tasks-db.test.ts asserts it
    // directly with disposable fixtures) but means this exact flag→task→
    // complete cycle can only be driven through the real UI once per
    // calendar day against this shared demo tenant. A second same-day run
    // finds nothing left to flag, because the button itself (B-038) hides
    // once `returnedMailAt` is set and does not reappear until a fresh
    // address is on file.
    await page.goto('/admin/tenants?q=dana@demo.example.com')
    await page.getByRole('link', { name: 'Dana Delinquent' }).click()
    await expect(page.getByRole('heading', { name: 'Dana Delinquent' })).toBeVisible()

    // A real wait (auto-retrying), not a one-shot isVisible() check — the
    // latter does not wait for the page to finish rendering and was skipping
    // this test even on a fresh, never-flagged tenant.
    const flagButton = page.getByRole('button', { name: 'Flag as returned mail' })
    const alreadyFlagged = await flagButton
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => false)
      .catch(() => true)
    test.skip(alreadyFlagged, 'already flagged earlier today by a previous run — see the note above')
    await flagButton.click()
    // `flagAddressReturnedAction` is a plain server-action form post, not the
    // AdminForm/FormState pattern — nothing here shows a success message to
    // wait on. The button itself disappearing once `returnedMailAt` is set
    // (B-038) is the real confirmation that the mutation and its
    // `revalidatePath` finished, and under load that took longer than the
    // click's own navigation wait, so the very next assertion (on
    // /admin/tasks) was sometimes racing ahead of it.
    await expect(flagButton).toHaveCount(0)

    await page.goto('/admin/tasks')
    const card = page.locator('li').filter({ hasText: 'Returned mail — contact info may be stale' }).first()
    // The flag-button guard above is necessary but not sufficient, and this is
    // the hole it leaves: `portal-contact.spec.ts` gives Dana a fresh address
    // of record, which clears `returnedMailAt` and brings the button back —
    // but the TASK is idempotent per (type, tenant, business day), so a second
    // flag on the same day correctly produces no new open row. Skipping here
    // rather than failing, because "already done today" is the designed
    // behaviour, not a regression. tests/tasks-db.test.ts asserts flag→task
    // directly against disposable fixtures, so a genuine break in creation is
    // caught there rather than only here.
    const alreadyCompletedToday = await card
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => false)
      .catch(() => true)
    test.skip(alreadyCompletedToday, 'a returned-mail task was already raised and completed today — see the note above')

    // B-115, UX review 2026-08-12 finding 9: the card used to say "Tenant"
    // where a tenant's name belongs. This is the one point in the suite where
    // a real Tenant-entityType task exists to check it against — the seeded
    // demo data carries none.
    await expect(card.getByRole('link', { name: 'Dana Delinquent' })).toBeVisible()

    // B-170. A real, visible <label> on the proof control — it used to be
    // labelled only by its placeholder, which vanishes the moment anything is
    // typed and is unavailable to speech input (3.3.2). Asserted here rather
    // than in a test of its own because this is the one point in the suite
    // where a task card is guaranteed to exist.
    await expect(card.getByLabel('Note')).toBeVisible()

    // B-184 (T4). Captured and checked BEFORE the submit, the same discipline
    // `expectPreexisting` applies everywhere else — this is the page-level
    // `AnnounceRegion` B-170 built, above the list, which is what survives the
    // `<li>` the completion removes.
    const region = page.locator('p[role="status"][tabindex="-1"]')
    await expectPreexisting(region)

    await card.getByPlaceholder('What did you do?').fill('Confirmed a current address on file.')
    await card.getByRole('button', { name: 'Complete' }).click()

    // The CARD is gone. Not `getByText(...)` on the whole page any more: since
    // B-170 the success message names the task it completed, so the subject
    // string is still on the page — in the announcement, which is the point.
    await expect(card).toHaveCount(0)

    // B-170. The outcome has to survive the card it reports on, and the focus
    // has to follow it there rather than fall to `<body>` — this message used
    // to be written into a `role="status"` INSIDE the `<li>` that the
    // completion removes, in the same commit, so it was never an observable
    // mutation and nothing was announced. B-184 (T4) is the one line that
    // would have caught that: the region isn't just present, it took focus.
    await expectAnnounced(region, /Task completed.*Returned mail/s, { focused: true })
  })

  // B-170. All four queues share `TaskCompleteForm`, and all four had the same
  // failure: the message was announced from a region INSIDE the card that the
  // completion removes, in the same commit — never an observable mutation, so
  // never announced. The fix is structural, and this is the structure: a live
  // region that is mounted and empty at load, above the list, on every queue
  // that renders the form. Read-only, and it does not depend on a task
  // existing, which is why it does not skip.
  for (const route of ['/admin/tasks', '/admin/delinquency', '/admin/walkthrough', '/admin/access/queue']) {
    test(`${route} mounts its completion live region before anything happens`, async ({ page }) => {
      await page.goto(route)
      await expect(page.getByRole('main')).toBeVisible()
      // The page-level region specifically: `AdminForm`'s own status paragraph
      // is not focusable, so `tabindex="-1"` picks out the one `AnnounceRegion`
      // renders and nothing else. Empty at load, and focusable so that the
      // announcement can take the focus the removed card gave up.
      const region = page.locator('p[role="status"][tabindex="-1"]')
      await expect(region).toHaveCount(1)
      await expect(region).toBeEmpty()
    })
  }

  // B-141. Before this, `completeTaskAction` discarded the service's
  // `{ ok: false, missingFields }` refusal: the button was pressed, the page
  // re-rendered identically, and the task stayed open with no explanation —
  // indistinguishable from a broken control. This is safe to run against any
  // open task and any number of times: a refused submission changes nothing.
  // a11y-state: /admin/tasks | completion refused
  test('a refused completion says why, rather than re-rendering identically', async ({ page }) => {
    await page.goto('/admin/tasks')
    const cards = page.locator('li').filter({ has: page.getByRole('button', { name: /^Complete/ }) })
    const count = await cards.count()
    test.skip(count === 0, 'nothing open today to exercise this against')

    const card = cards.first()
    const subject = await card.locator('p').first().innerText()

    // A whitespace-only note passes the input's `required` attribute (which
    // only checks non-empty) but fails the server's `missingProofFields`
    // (which trims) — the way to reach the server round trip without
    // fighting native HTML5 validation in a real browser.
    await card.getByPlaceholder('What did you do?').fill('   ')
    await card.getByRole('button', { name: /^Complete/ }).click()

    // Scoped to <main>: Next ships its own empty role="alert" route announcer
    // in the document, and an unscoped query matches that instead once it has
    // mounted (admin.spec.ts's settings test hit the same thing first).
    const alert = page.getByRole('main').getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(/note is required/i)
    // The summary receives focus (PRD 02 FR-19) rather than leaving the user
    // at the button with no idea anything happened.
    await expect(alert).toBeFocused()

    // The task is still open — nothing was silently completed.
    await expect(page.getByText(subject)).toBeVisible()

    // B-184 (T3). FR-24 in as many words: no axe scan ran after an invalid
    // submit on any admin or portal form, `AdminForm`'s error summary
    // included, until this row.
    await assertNoAxeViolations(page)
  })
})
