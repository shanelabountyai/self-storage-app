import { expect, test } from '@playwright/test'
import { prisma } from '../packages/db'
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
  // indistinguishable from a broken control.
  //
  // B-221 gave it a fixture it owns. It used to take the first card on
  // `/admin/tasks` and `test.skip` when there were none, which meant it
  // asserted NOTHING: the freshly seeded demo raises no tasks, so the skip was
  // the normal outcome and had been for the test's whole life. When a queue
  // finally was not empty it FAILED, and the reason was in the catalog rather
  // than in a race — `overlock_apply` requires `["note", "photo_reference"]`,
  // the only type in the catalog that requires more than a note. This test
  // fills the note alone, so on that card the empty second field failed the
  // browser's own `required` check, the form never submitted, and the server
  // refusal it waits for could not arrive. `element(s) not found`, five
  // seconds, at the alert.
  //
  // So it now creates one `insurance_proof_review` task — a type that requires
  // only a note, and that nothing else in this suite raises — reaches it by
  // the `?type=` filter the queue already supports, and deletes it afterwards.
  // B-120 discipline (1): a fixture nothing else asserts against. The action
  // stays safe to repeat, because a refused submission changes nothing.
  // a11y-state: /admin/tasks | completion refused
  const REFUSAL_TASK_TYPE = 'insurance_proof_review'
  let refusalTaskId = ''
  let refusalFacilityId = ''
  let refusalMarker = ''

  test.beforeAll(async ({}, testInfo) => {
    // One project only, for the reason the returned-mail test above gives:
    // both projects share the one real demo database.
    if (testInfo.project.name !== 'desktop-chrome') return

    // Any demo lease will do — the subject only has to resolve to something a
    // human could read. Ordered so the choice is the same on every run.
    const lease = await prisma.lease.findFirst({
      where: { facility: { slug: { startsWith: 'demo-' } } },
      orderBy: { id: 'asc' },
      select: { id: true, facilityId: true },
    })
    if (!lease) return

    // Per WORKER, not per run. `beforeAll` runs once in each worker that
    // picks up a test from this file, and `Task` is unique on
    // (type, entityId, businessDate) — that is the queue's idempotency
    // guarantee doing its job, and it made the first version of this fixture
    // fail with `Unique constraint failed` the moment two workers raced it.
    // A different business date per worker gives each one its own row, and
    // the marker below is how the test finds the row that belongs to it.
    refusalFacilityId = lease.facilityId
    refusalMarker = `B-221 refusal fixture, worker ${testInfo.workerIndex}`
    const task = await prisma.task.create({
      data: {
        facilityId: lease.facilityId,
        type: REFUSAL_TASK_TYPE,
        entityType: 'Lease',
        entityId: lease.id,
        // `lte: today` is the queue's filter, so anything in the past shows.
        businessDate: new Date(Date.now() - (testInfo.workerIndex + 1) * 86_400_000),
        status: 'open',
        // B-169's field, and it renders on the card — which is what makes one
        // worker's fixture distinguishable from another's on screen.
        detail: refusalMarker,
      },
      select: { id: true },
    })
    refusalTaskId = task.id
  })

  test.afterAll(async () => {
    if (!refusalTaskId) return
    // `Task` carries no append-only trigger and `audit_log` does not reference
    // it, so this really is reclaimable — unlike a facility (B-185).
    await prisma.task.deleteMany({ where: { id: refusalTaskId } })
  })

  // B-233. `assignTask` shipped in B-095 with tests and no caller, so both
  // queues rendered "Unassigned" as a fact nobody could act on and "my day" was
  // the facility's day. Driven against the SAME per-worker fixture the refusal
  // test owns — assignment does not gate completion, so the two do not
  // interfere, and this one puts the task back the way it found it.
  //
  // B-120 discipline (2): the round trip is idempotent per run, and the test
  // self-heals rather than failing if a previous run died holding the claim —
  // it gives back first and then takes it, so the starting state does not
  // matter.
  // a11y-state: /admin/tasks | task claimed
  test('a task can be claimed and given back, and the claim is announced', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'owns a shared-database fixture — see note')
    expect(refusalTaskId, 'the fixture task was created').not.toBe('')

    await page.goto('/admin')
    await page.getByLabel('Switch facility').selectOption(refusalFacilityId)
    await page.getByRole('button', { name: 'Switch', exact: true }).click()

    await page.goto(`/admin/tasks?type=${REFUSAL_TASK_TYPE}`)
    const card = page.locator('li').filter({ hasText: refusalMarker })
    await expect(card, "this worker's fixture is on the queue").toHaveCount(1)

    // Left held by a run that died mid-test: hand it back before starting.
    const giveBack = card.getByRole('button', { name: /^Give back/ })
    if (await giveBack.count()) {
      await giveBack.click()
      await expect(card.getByText('Unassigned')).toBeVisible()
    }

    // Captured BEFORE the submit — the region has to pre-exist the event it
    // reports (FR-20), which is the whole reason `AnnounceRegion` exists.
    const region = page.locator('p[role="status"][tabindex="-1"]')
    await expectPreexisting(region)

    // The accessible name carries the card's own subject, not a bare verb
    // repeated once per row (2.4.6, 4.1.3).
    const take = card.getByRole('button', { name: new RegExp(`^Take this: .*Insurance`, 'i') })
    await expect(take).toBeVisible()
    await take.click()

    await expect(card.getByText('Assigned to you')).toBeVisible()
    await expectAnnounced(region, /You took:/s, { focused: true })

    // The filter the claim exists for: Mine now contains it, and the list's
    // new length is stated in words rather than silently re-rendered.
    await page.goto(`/admin/tasks?type=${REFUSAL_TASK_TYPE}&assignee=mine`)
    await expect(page.locator('li').filter({ hasText: refusalMarker })).toHaveCount(1)
    await expect(page.getByText(/Showing \d+ tasks? assigned to you\./)).toBeVisible()

    await assertNoAxeViolations(page)

    // Put it back, so a re-run starts where this one did.
    await page
      .locator('li')
      .filter({ hasText: refusalMarker })
      .getByRole('button', { name: /^Give back/ })
      .click()
    await expect(page.getByText(/Showing 0 tasks assigned to you\./)).toBeVisible()
  })

  test('a refused completion says why, rather than re-rendering identically', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'owns a shared-database fixture — see note')
    expect(refusalTaskId, 'the fixture task was created').not.toBe('')

    // The queue is per-facility, so put the context on the fixture's facility
    // rather than hoping the default lands there.
    await page.goto('/admin')
    await page.getByLabel('Switch facility').selectOption(refusalFacilityId)
    await page.getByRole('button', { name: 'Switch', exact: true }).click()

    await page.goto(`/admin/tasks?type=${REFUSAL_TASK_TYPE}`)
    // Filtered to the type AND to this worker's own marker: another worker's
    // fixture is in the same queue, and taking "the first card" is the habit
    // that made this test unreliable in the first place.
    const cards = page
      .locator('li')
      .filter({ has: page.getByRole('button', { name: /^Complete/ }) })
      .filter({ hasText: refusalMarker })
    await expect(cards, "this worker's fixture is on the queue").toHaveCount(1)

    const card = cards.first()

    // A whitespace-only note passes the input's `required` attribute (which
    // only checks non-empty) but fails the server's `missingProofFields`
    // (which trims) — the way to reach the server round trip without
    // fighting native HTML5 validation in a real browser. This type requires
    // the note and nothing else, so there is no second empty field to stop
    // the submission before it leaves the browser.
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

    // The task is still open — nothing was silently completed. Asserted on the
    // marked card rather than on the type's label, which every worker's
    // fixture shares and which resolved to three elements when it was.
    await expect(cards, 'the task is still open — nothing was silently completed').toHaveCount(1)

    // B-184 (T3). FR-24 in as many words: no axe scan ran after an invalid
    // submit on any admin or portal form, `AdminForm`'s error summary
    // included, until this row.
    await assertNoAxeViolations(page)
  })
})
