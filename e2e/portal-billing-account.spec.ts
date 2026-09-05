import { expect, test } from '@playwright/test'
import { signInAsBusinessMember, signInAsBusinessPayer } from './sign-in'
import { assertNoAxeViolations } from './a11y-helpers'
import { DEMO_BUSINESS_ACCOUNT_NAME } from '../apps/web/scripts/demo-credentials'

// B-256 / PRD 01 §12. The payer's own portal.
//
// Casey Contractor holds no lease, so signing in as them lands on a dashboard
// whose entire content is the account card — which is exactly the shape this
// row is about, and the reason a separate sign-in exists rather than reusing
// Dana's.
//
// **Shared-fixture discipline (B-120).** This spec mutates nothing: it reads
// the dashboard, opens the pay screen and opens a statement, and never
// confirms a payment. It also depends on the account OWING something, which is
// a state and therefore has to be one nothing else moves — so the seed keeps
// the account off `DEMO_POS_TENANT_EMAIL`'s unit and on two units no spec
// takes money against. That is not a precaution: B-090e had the POS unit on
// the account, and two consecutive sweeps walked the total from $86.00 owed to
// $39.00 in credit, at which point the card correctly stops offering a Pay
// button and everything below fails.
//
// What is asserted about the money is still a RELATIONSHIP, not a figure — the
// total offered equals the sum of the rows listed, credits subtracting —
// because that holds at any balance and is the claim that matters: the card
// and the screen that takes the money must not disagree.

/// The first "$1,234" or "$1,234.56" in a string, as cents.
///
/// Both forms appear on purpose: `formatRate` drops ".00" on a whole-dollar
/// figure (a Pay button reads "Pay $161 now") and `formatCents` never does (a
/// column of money reads "$161.00"). A matcher that demanded the cents would
/// silently return null on the button and compare nothing.
function centsIn(text: string | null): number | null {
  const match = text?.match(/\$([\d,]+)(\.\d{2})?/)
  if (!match) return null
  const cents = Math.round(Number(`${match[1].replace(/,/g, '')}${match[2] ?? ''}`) * 100)
  // "$75.00 in credit" is a NEGATIVE balance written in words rather than with
  // a minus sign — the dashboard's own convention, because "-$75" in a column
  // of money reads as an amount owed with a typo. A matcher that took the
  // figure at face value would make a credit add to the total it subtracts
  // from, which is the one arithmetic error this test exists to catch.
  return /in credit/.test(text ?? '') ? -cents : cents
}

test.describe('signed in as the business account payer', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsBusinessPayer(page)
  })

  // a11y-state: /portal | business account card
  //
  // B-256. The portal route loop scans `/portal` as Dana, who holds units and
  // pays for no account — so the account card, its units table and its one Pay
  // button were markup no scan had ever seen.
  test('the dashboard is one account card, and its total is the units under it', async ({
    page,
  }) => {
    await page.goto('/portal')
    await expect(page.getByRole('main')).toBeVisible()

    const card = page.getByRole('region', { name: DEMO_BUSINESS_ACCOUNT_NAME })
    await expect(card).toBeVisible()

    // The payer holds no lease of their own, so the account's is the ONLY Pay
    // button in the page body — the whole defect this row fixes was eleven of
    // them. Scoped to `main` because the portal nav carries its own (B-239),
    // which is a different control pointing at a lease.
    const payLinks = page.getByRole('main').getByRole('link', { name: /^Pay \$/ })
    await expect(payLinks).toHaveCount(1)

    // The one claim that has to hold at any balance: the total offered is the
    // sum of the rows shown under it. A card that asked for a different figure
    // than it itemised would be the same class of defect as B-257.
    //
    // A relationship rather than a figure, because the account's balance is
    // genuinely shared state — `admin-pos.spec.ts` takes real money against its
    // FIRST unit by design, so at the time of writing this asserts $161.00 owed
    // on one unit against $75.00 of credit on the other. That is the case worth
    // having: a credit has to SUBTRACT from the total, and a card that added it
    // would ask a payer for money they had already handed over.
    const balances = await card.locator('tbody tr td:last-child').allTextContents()
    expect(balances.length).toBeGreaterThan(0)
    const listed = balances.reduce((sum, text) => sum + (centsIn(text) ?? 0), 0)
    expect(centsIn(await payLinks.textContent())).toBe(listed)

    // D-119, stated on the card because the opposite is the natural assumption.
    await expect(card).toContainText(/Autopay is set up per unit/)

    await assertNoAxeViolations(page)
  })

  // a11y-state: /portal/pay | business account
  //
  // B-256. `/portal/pay` is scanned by `portal.spec.ts` for ONE lease. The
  // account subject renders a different bill — a unit-by-unit table instead of
  // a ledger itemisation — under the same total and the same Payment Element.
  test('the Pay button opens one screen for the whole account', async ({ page }) => {
    await page.goto('/portal')
    const payLink = page.getByRole('main').getByRole('link', { name: /^Pay \$/ })
    const offered = centsIn(await payLink.textContent())
    await payLink.click()
    await page.waitForURL(/\/portal\/pay\?account=/)

    await expect(page.getByRole('heading', { level: 1, name: 'Pay your balance' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText(DEMO_BUSINESS_ACCOUNT_NAME)

    // The figure carried across from the card, on the row that says what is
    // being charged (3.3.4 Error Prevention (Financial)).
    const payingToday = page.getByRole('row', { name: /Paying today/ })
    expect(centsIn(await payingToday.textContent())).toBe(offered)

    await assertNoAxeViolations(page)
  })

  test('a month of the account is one page over every unit on it', async ({ page }) => {
    await page.goto('/portal/statements')
    const group = page.getByRole('region', { name: new RegExp(DEMO_BUSINESS_ACCOUNT_NAME) })
    await expect(group).toBeVisible()

    await group.getByRole('link').first().click()
    await page.waitForURL((url) => url.pathname.startsWith('/portal/statements/account/'))
    await expect(page.getByRole('main')).toBeVisible()

    // A summary OVER the per-unit statements, never instead of them: every row
    // is a link into the unit's own document, which is the record a dispute or
    // a lien file needs.
    await expect(page.getByRole('rowheader', { name: 'All units' })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Unit / }).first()).toBeVisible()

    await assertNoAxeViolations(page)
  })
})

// B-258 / PRD 01 §12. The other half of the same card: somebody who may SEE the
// account and may not pay it.
//
// Robin Bookkeeper holds no lease and is not the payer, so their portal is the
// read-only account card and nothing else — the exact state the row is about.
//
// **Shared-fixture discipline (B-120).** Mutates nothing: it reads the
// dashboard and asserts two absences. It depends on the membership existing,
// which is seeded state nothing in the suite removes — the one spec that
// removes a member is the unit suite's, against its own fixture.
test.describe('signed in as an authorized member of the business account', () => {
  // a11y-state: /portal | business account card, member
  test('sees the account and is offered nothing that pays it', async ({ page }) => {
    await signInAsBusinessMember(page)
    await page.goto('/portal')
    await expect(page.getByRole('main')).toBeVisible()

    const card = page.getByRole('region', { name: DEMO_BUSINESS_ACCOUNT_NAME })
    await expect(card).toBeVisible()
    // The units and their money are there — sight of the account is the point.
    await expect(card.locator('tbody tr')).not.toHaveCount(0)

    // No Pay button anywhere on the page — the body's and the NAV's, which the
    // payer's own test has to exclude and this one must not: the nav link
    // (B-239) reads `owingLeases`, and a member owes nothing and pays nothing,
    // so its absence is part of the boundary rather than incidental.
    //
    // Anchored `/^Pay \$/` rather than `/Pay/`: the nav also carries "Payment
    // methods", which a member legitimately keeps — they have a card of their
    // own if they ever rent a unit.
    await expect(page.getByRole('link', { name: /^Pay \$/ })).toHaveCount(0)

    // Said in words rather than by an absent control, so the person who was
    // told they now have access does not read the missing button as a bug.
    await expect(card).toContainText(/is the payer/)

    // The renters' names are the payer's disclosure, not a member's, and the
    // whole column goes rather than its cells emptying.
    await expect(card.getByRole('columnheader', { name: 'Rented by' })).toHaveCount(0)

    // The account's statements stay the payer's: no link is offered, and the
    // statements screen itself has nothing on it for a member.
    await expect(card.getByRole('link', { name: /Statements for this account/ })).toHaveCount(0)

    await assertNoAxeViolations(page, { state: 'business account card, member' })
  })
})
