import { expect, test, type Page } from '@playwright/test'
import { prisma } from '../packages/db'
import { signInAsDemoOwner } from './sign-in'
import { assertNoAxeViolations, expectAnnounced, expectPreexisting } from './a11y-helpers'

// B-333 / PRD 02 §5.5 FR-25a, SC 4.1.3 Status Messages (AA), SC 2.4.3 Focus
// Order (A). The three corrections that succeed by REMOVING the form that
// should have announced them.
//
// B-303's void and write-off and B-304's acknowledgement all revalidate the
// route they were posted from, and in each case the success changes what that
// route renders: a voided invoice leaves `voidableInvoices` and takes its
// `<li>` with it, a written-off balance reaches zero and fails the
// `balanceCents > 0` gate, an acknowledged row switches branch to "Reviewed
// by …". The `role="status"` lived inside the form, so React unmounted it in
// the same commit that populated it — never an observable mutation, nothing
// announced — and focus fell from the submit to `<body>`.
//
// `expectPreexisting` is the assertion that can see it, and it only means
// something because the locator is captured BEFORE the press: a region
// fetched fresh afterwards passes even when the element was unmounted and
// remounted already carrying its text, which is the failure FR-20 exists to
// prevent. `{ focused: true }` is the second half — the words landing
// somewhere nobody's cursor is, is not an outcome.
//
// **The fixture is this spec's own, per B-120 discipline (1).** The demo seed
// reconciles everywhere by construction, so there is no seeded exception to
// drive the acknowledgement against — and every one of these three actions is
// destructive and not repeatable, so borrowing a demo lease would break the
// suite's second run rather than this one. Its own facility, its own tenants,
// its own leases, rebuilt from scratch in `beforeAll`.
//
// **The facility is reused rather than recreated, and that is B-185, not
// laziness.** All three actions write `audit_log`, which carries a RESTRICT
// foreign key to `facility` and a trigger refusing DELETE on itself — so once
// this fixture has been driven once, its facility can never be deleted by
// anything short of rebuilding the schema. Deleting it in `afterAll` would
// fail on the second run, for good, and read as a broken teardown. So the
// facility is found-or-created by a stable slug and the disposable rows below
// it are cleared at the start of every run instead.

const SLUG = 'e2e-b333-ledger-corrections'
const TENANT_EMAIL_DOMAIN = 'b333.example.com'

/// The three leases, one per action, so no test can leave another one's
/// fixture in a state it did not expect. Named rather than positional because
/// the acknowledgement test has to find its row by tenant name on a report
/// that lists every facility the owner can see.
const SUBJECTS = {
  void: { first: 'Vera', last: 'Voidable', unit: 'B333-V' },
  writeOff: { first: 'Wes', last: 'Writeoff', unit: 'B333-W' },
  acknowledge: { first: 'Anna', last: 'Acknowledged', unit: 'B333-A' },
} as const

type Built = { tenantId: string; leaseId: string }

/// Both Playwright projects run against the one real database and this fixture
/// is keyed by a fixed slug, so only one of them may drive it — the same
/// choice `admin-tasks.spec.ts` makes for its shared-database fixture. What is
/// measured here is an announcement and a focus target, neither of which is
/// viewport-dependent.
const ONE_PROJECT = 'owns a shared-database fixture — see the note at the top'

let fixture: Record<keyof typeof SUBJECTS, Built> | null = null

// Serial, and that is the fixture speaking rather than a preference.
// `fullyParallel` is on, so without this Playwright is free to hand these
// three tests to three workers — and `beforeAll` runs once per worker, so
// three of them would race to delete and rebuild the same rows by slug. One
// worker, one build, in order.
test.describe.configure({ mode: 'serial' })

test.describe('a correction announces itself outside the form it removes (B-333)', () => {
  // Both Playwright projects run against the one real database and this
  // fixture is keyed by a fixed slug, so only one of them may drive it — the
  // same choice `admin-tasks.spec.ts` makes for its shared-database fixture.
  // What is measured here is an announcement and a focus target, neither of
  // which is viewport-dependent.
  test.beforeEach(async ({ page }) => {
    await signInAsDemoOwner(page)
  })

  test.beforeAll(async ({}, testInfo) => {
    // One project only. Both Playwright projects run against the one real
    // database, and this fixture is keyed by a fixed slug — the same reason
    // `admin-tasks.spec.ts` pins its shared-database fixture to one project.
    if (testInfo.project.name !== 'desktop-chrome') return

    const facility = await prisma.facility.upsert({
      where: { slug: SLUG },
      update: {},
      create: {
        name: 'E2E — Ledger corrections',
        slug: SLUG,
        addressLine1: '1 Correction Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
      },
      select: { id: true },
    })
    const facilityId = facility.id

    // Cleared in dependency order: `LedgerEntry` is `onDelete: Restrict` on
    // both its invoice and its lease, so nothing above it can go first. The
    // acknowledgement is keyed on the lease and has to release it too.
    await prisma.ledgerExceptionAcknowledgement.deleteMany({
      where: { lease: { facilityId } },
    })
    await prisma.ledgerEntry.deleteMany({ where: { facilityId } })
    await prisma.invoice.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { email: { endsWith: TENANT_EMAIL_DOMAIN } } })

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${SLUG}`, widthFt: 10, lengthFt: 10 },
    })

    const build = async (
      key: keyof typeof SUBJECTS,
      shape: { rentCents: number; withLedgerCharge: boolean },
    ): Promise<Built> => {
      const subject = SUBJECTS[key]
      const tenant = await prisma.tenant.create({
        data: {
          email: `${key}@${TENANT_EMAIL_DOMAIN}`,
          firstName: subject.first,
          lastName: subject.last,
        },
        select: { id: true },
      })
      const unit = await prisma.unit.create({
        data: { facilityId, unitTypeId: unitType.id, number: subject.unit },
        select: { id: true },
      })
      const lease = await prisma.lease.create({
        data: {
          facilityId,
          tenantId: tenant.id,
          unitId: unit.id,
          status: 'active',
          startDate: new Date('2026-01-01'),
          billingDay: 1,
          monthlyRateCents: shape.rentCents,
        },
        select: { id: true },
      })

      const invoice = await prisma.invoice.create({
        data: {
          facilityId,
          leaseId: lease.id,
          number: `B333-${key}`,
          status: 'open',
          kind: 'rent',
          issueDate: new Date('2026-09-01'),
          dueDate: new Date('2026-09-01'),
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-10-01'),
          subtotalCents: shape.rentCents,
          totalCents: shape.rentCents,
          amountPaidCents: 0,
        },
        select: { id: true },
      })

      // The charge the invoice raised, or deliberately not it.
      //
      // WITH the entry the lease reconciles: ledger balance equals invoice
      // outstanding, which is what the void and write-off screens need — and
      // a write-off needs `balanceCents > 0` or its form never renders at
      // all. WITHOUT it the lease is `reconcile`'s second shape, "an invoice
      // raised without its ledger charge", which is what puts a row on the
      // exception report for the acknowledgement to act on.
      if (shape.withLedgerCharge) {
        await prisma.ledgerEntry.create({
          data: {
            facilityId,
            leaseId: lease.id,
            invoiceId: invoice.id,
            type: 'charge',
            amountCents: shape.rentCents,
            description: 'Rent — September 2026',
            occurredAt: new Date('2026-09-01'),
          },
        })
      }

      return { tenantId: tenant.id, leaseId: lease.id }
    }

    // Every amount is well inside the regional role's $250 manual-credit
    // limit, so `authorize` is not what these tests measure.
    fixture = {
      void: await build('void', { rentCents: 15_000, withLedgerCharge: true }),
      writeOff: await build('writeOff', { rentCents: 9_900, withLedgerCharge: true }),
      acknowledge: await build('acknowledge', { rentCents: 7_500, withLedgerCharge: false }),
    }
  })

  // No `afterAll`. The rows stay until the next run's `beforeAll` clears them,
  // because the acknowledgement test's own row is the only evidence that the
  // action landed, and because the facility cannot be reclaimed anyway (see
  // the note at the top). The cost is one facility and three leases resident
  // in `storage_test`'s `public` schema between runs, which `db:reset-test`
  // clears with everything else.

  /// The page-level region `AnnounceRegion` mounts: empty at idle, `sr-only`
  /// rather than `display:none` so it is in the accessibility tree before it
  /// has anything to say, and focusable so the announcement can take focus
  /// from the control that has just been unmounted.
  function announceRegion(page: Page) {
    return page.locator('p[role="status"][tabindex="-1"]')
  }

  // a11y-state: /admin/tenants/[tenantId]/ledger/[leaseId] | invoice voided
  test('voiding an invoice announces outside the list item it removes', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', ONE_PROJECT)
    expect(fixture, 'the fixture was built').not.toBeNull()
    const { tenantId, leaseId } = fixture!.void

    await page.goto(`/admin/tenants/${tenantId}/ledger/${leaseId}`)
    const item = page.locator('li').filter({ hasText: 'Invoice B333-void' })
    await expect(item, 'the voidable invoice is offered').toHaveCount(1)

    // Captured before the press, and asserted empty: a region that arrives
    // already populated is the failure, not the fix.
    const region = announceRegion(page)
    await expectPreexisting(region)

    await item.getByLabel('Reason').selectOption('billing_error')
    await item.getByRole('button', { name: /^Void/ }).click()

    // The `<li>` — and with it the form, and the old in-form region — is gone.
    await expect(item).toHaveCount(0)

    // B-327/B-328's re-bill sentence, which is the one line that tells a
    // manager what the void does NEXT, and which nobody sighted or otherwise
    // ever saw before this row.
    await expectAnnounced(region, /Invoice B333-void voided.*bills it again at the current rate/s, {
      focused: true,
    })

    await assertNoAxeViolations(page, { state: 'invoice voided' })
  })

  // a11y-state: /admin/tenants/[tenantId]/ledger/[leaseId] | balance written off
  test('writing off a balance announces outside the form it removes', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', ONE_PROJECT)
    expect(fixture, 'the fixture was built').not.toBeNull()
    const { tenantId, leaseId } = fixture!.writeOff

    await page.goto(`/admin/tenants/${tenantId}/ledger/${leaseId}`)
    const form = page.getByRole('form', { name: /^Write off the balance/ })
    await expect(form, 'the lease owes something, so the form is offered').toHaveCount(1)

    const region = announceRegion(page)
    await expectPreexisting(region)

    await form.getByLabel('Reason').selectOption('uncollectible')
    await form.getByRole('button', { name: /^Write off the balance/ }).click()

    // The balance is zero, so the form fails its own gate and unmounts.
    await expect(form).toHaveCount(0)
    await expectAnnounced(region, /\$99\.00 written off/s, { focused: true })

    await assertNoAxeViolations(page, { state: 'balance written off' })
  })

  // a11y-state: /admin/reports/ledger-exceptions | exception acknowledged
  test('acknowledging an exception announces above the table, naming the lease', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', ONE_PROJECT)
    expect(fixture, 'the fixture was built').not.toBeNull()

    await page.goto('/admin/reports/ledger-exceptions')
    const row = page.getByRole('row').filter({ hasText: 'Anna Acknowledged' })
    await expect(row, 'the non-reconciling lease is on the report').toHaveCount(1)

    const region = announceRegion(page)
    await expectPreexisting(region)

    await row.getByLabel(/^What you found/).fill('Pre-B-257 split payment; cannot be traced.')
    await row.getByRole('button', { name: /^Mark reviewed/ }).click()

    // The cell switches branch, so the form — and the region that was inside
    // it — is gone, while the row itself stays: an acknowledgement is not a
    // repair, and B-304 keeps the lease visible on the report deliberately.
    await expect(row.getByRole('button', { name: /^Mark reviewed/ })).toHaveCount(0)
    await expect(row.getByText('Reviewed')).toBeVisible()

    // Named, because "this lease" has no antecedent once the message is read
    // from above a table that can carry a facility's worth of rows.
    await expectAnnounced(region, /Recorded for Anna Acknowledged, unit B333-A\./s, {
      focused: true,
    })

    await assertNoAxeViolations(page, { state: 'exception acknowledged' })
  })
})
