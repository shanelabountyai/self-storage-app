import type { Metadata } from 'next'
import { restoreShortfallCents } from '@storage/core/access'
import { recurringParts } from '@storage/core/pricing'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { portalDashboardForTenant, type PortalLeaseSummary } from '@/lib/portal/dashboard'
import { portalAccountsFor, type PortalAccount } from '@/lib/billing/accounts'
import { formatCalendarDate, formatCents, formatRate } from '@/lib/format'
import { GateCodePanel } from '@/components/portal/gate-code-panel'
import { currentImpersonation } from '@/lib/impersonation/context'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, plural, translate, type Dictionary, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { chargePartsSentence } from '@/lib/pricing/charge-parts'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await getLocale()), 'dash.title') }
}

// PRD 01 §4.7 US-702, §6.5, §6.8.1. "What do I owe, when is it due, what's my
// gate code" in one glance. The past-due banner and the gate panel's
// suspended state are both display-only (lib/portal/dashboard.ts's own
// comment) — this page never decides delinquency, it only renders whatever
// LedgerEntry/AccessGrant already say.
//
// "Pay now" goes to /portal/pay with the full balance already prepared, so
// paying is two taps from here (US-703's ≤3, and §6.5's ≤2 for the past-due
// banner). Autopay is shown read-only — toggling it is B-036.

// B-228. Every date this renders is a CALENDAR day held as UTC midnight — the
// billing anniversary from `nextBillingDate`'s `Date.UTC`, a `@db.Date`
// move-out day, a transfer day parsed from `yyyy-mm-dd`, an installment date a
// staffer typed. It used to take `lease.facilityTimezone`, which shifted every
// one of them a day early in every US zone: the plan card said an installment
// was due 14 October while the schedule one tap away said the 15th, and "Next
// payment due" named the day before the anniversary the invoice actually
// carries. There is no time in these values to convert — see
// `formatCalendarDate`. The timezone belongs on `formatExpiry` below, which
// formats a real instant.
function formatDueDate(date: Date): string {
  return formatCalendarDate(date, { month: 'long', day: 'numeric' })
}

// B-142. Absolute facility-local date and time — the hold expiry is never a
// countdown (PRD 01 §6.8.1).
function formatExpiry(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date)
}

function PayNowButton({ lease, dict }: { lease: PortalLeaseSummary; dict: Dictionary }) {
  return (
    <Link
      href={`/portal/pay?lease=${lease.leaseId}`}
      className="bg-primary text-primary-foreground mt-2 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
    >
      {translate(dict, 'dash.payNow', { amount: formatRate(lease.balanceCents) })}
    </Link>
  )
}

function LeaseCard({
  lease,
  impersonated,
  dict,
}: {
  lease: PortalLeaseSummary
  impersonated: boolean
  dict: Dictionary
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  // B-256. The viewer is this unit's tenant (the dashboard reads their own
  // leases) — so `youArePayer` means they hold the unit AND pay for it through
  // their own business account, and the account card below already carries this
  // balance inside one total with one button. Two buttons for one debt is the
  // shape that gets it paid twice.
  const owesMoney = lease.balanceCents > 0 && !lease.billedTo?.youArePayer
  // B-227. Was `monthlyRateCents + protectionCents`, computed here — which left
  // the tax on rent out and understated the charge a tenant is about to see.
  // One shared reckoning now, the same one `/portal/methods` and the checkout
  // disclosure use.
  const nextPaymentCents = lease.recurring.totalCents
  const dueDate = formatDueDate(lease.nextDueDate)
  const telHref = `tel:${lease.facilityPhone.replace(/[^0-9+]/g, '')}`

  // B-244. The heading FIRST, and the section named by it.
  //
  // Everything below used to render above this `<h2>`: the access-suspension
  // alert, the settling-funds card, the balance and its Pay button, the pending
  // transfer, the payment-plan card and the pending move-out. On a tenant with
  // two units that put every money statement for the second unit UNDER the
  // first unit's heading in the document outline, because it was emitted before
  // its own — so "A payment on your plan is late. $306.23 was due on 15
  // September. Pay $306.23 now" had no programmatic tie to a unit, on the screen
  // where a tenant decides what to pay. The `<section>` was unnamed too, so it
  // was not exposed as a region either and there was no second mechanism to
  // fall back on (SC 1.3.1 A).
  //
  // The id is derived from `leaseId` rather than `useId` because this is a
  // server component, and a stable id from the data is better than a generated
  // one anyway.
  const headingId = `lease-${lease.leaseId}-heading`

  return (
    <section
      aria-labelledby={headingId}
      className="border-input flex flex-col gap-4 rounded-lg border p-4"
    >
      <div>
        <h2 id={headingId} className="font-medium">
          {t('dash.unitHeading', { facility: lease.facilityName, unit: lease.unitNumber })}
        </h2>
        <p className="text-muted-foreground text-sm">
          <span aria-hidden="true">
            {lease.widthFt}×{lease.lengthFt}
          </span>
          <span className="sr-only">
            {t('facility.footBy', { width: lease.widthFt, length: lease.lengthFt })}
          </span>{' '}
          · {formatRate(lease.monthlyRateCents)}
          {t('card.perMonth')}
        </p>
      </div>

      {/* B-256. Who else is billed for this unit. Said on the card rather than
          left to be discovered, because the alternative is a tenant paying a
          bill their employer has already paid — and the money then sits as
          credit rather than bouncing, so nothing tells either of them.

          It never REPLACES this tenant's own way of paying (B-090e: the person
          handing over cash at the counter for their own unit must not be
          refused because their employer usually pays), which is why the
          sentence is a fact and not an instruction. */}
      {lease.billedTo && (
        <div className="border-input rounded-md border p-3 text-sm text-pretty">
          {lease.billedTo.youArePayer ? (
            <p>{t('dash.billedToPayer', { account: lease.billedTo.accountName })}</p>
          ) : (
            <p>{t('dash.billedToOther', { account: lease.billedTo.accountName })}</p>
          )}
        </div>
      )}

      {owesMoney && lease.accessSuspended && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900">
          {/* B-232 / D-16. The number that actually reopens the gate.
              This said "Pay your full balance of $487.50" — hardcoding D-16's
              DEFAULT threshold of zero as though it were the rule, on one
              lease's balance. The rule is `balanceCents <= restoreAtOrBelow`,
              per facility, summed across every lease the tenant holds there,
              and D-16 stores the threshold precisely so it can be relaxed. A
              site that set $50 was demanding $487.50 for what $437.50 buys;
              a tenant with two units was told one unit's figure would do it.
              Where the threshold is 0 and there is one unit — every facility
              today — this reads exactly as it did. */}
          <p>
            {t('dash.pastDueBefore')}{' '}
            <strong>
              {formatRate(
                restoreShortfallCents({
                  facilityBalanceCents: lease.facilityBalanceCents,
                  restoreAtOrBelowCents: lease.restoreAtOrBelowCents,
                }),
              )}
            </strong>{' '}
            {t('dash.pastDueAfter')}
          </p>
          <PayNowButton lease={lease} dict={dict} />
          {/* B-232. One clause from a finding that otherwise stays declined: it
              describes what the office can already do under D-98's plan
              builder, and commits the product to no tenant-initiated request
              flow — that remains declined exactly as it was in the B-187–B-196
              block, and PRD 01 §9 still carries it as an open gap. */}
          <p className="mt-2">
            {t('dash.orCall')}{' '}
            <a href={telHref} className="underline underline-offset-4">
              {lease.facilityPhone}
            </a>{' '}
            {t('dash.orCallToPayOrSplit')}
          </p>
        </div>
      )}
      {/* B-103. Said BEFORE the balance panel, because a tenant who paid on the
          1st and sees "you have a balance" on the 3rd rings the office — and
          the answer is that their money is in transit, not that anything is
          wrong. Shown beside the balance rather than netted off it: the money
          has not arrived, and subtracting it would make this screen disagree
          with the ledger and with every staff screen. */}
      {lease.settlingCents > 0 && (
        <div className="border-input rounded-md border p-3 text-sm text-pretty">
          <p>
            <strong>{formatRate(lease.settlingCents)}</strong> {t('dash.settlingAfter')}
          </p>
        </div>
      )}
      {owesMoney && !lease.accessSuspended && (
        <div className="border-input rounded-md border p-3 text-sm text-pretty">
          <p>
            {t('dash.balanceBefore')} <strong>{formatRate(lease.balanceCents)}</strong>.
          </p>
          <PayNowButton lease={lease} dict={dict} />
          <p className="mt-2">
            {t('dash.orCall')}{' '}
            <a href={telHref} className="underline underline-offset-4">
              {lease.facilityPhone}
            </a>{' '}
            {t('dash.orCallToPay')}
          </p>
        </div>
      )}

      {/* B-142 / PRD 01 §4.7 US-709, US-702. "Did that go through" is the one
          question a tenant returns to answer — used to be two taps deep
          behind the "Manage" disclosure. */}
      {lease.pendingTransfer && (
        <div className="border-input rounded-md border p-3 text-sm text-pretty">
          <p>
            {t('dash.transferBefore')}{' '}
            <strong>
              {t('dash.unitNumber', { unit: lease.pendingTransfer.toUnitNumber })}
            </strong>{' '}
            {t('dash.transferOn')} {formatDueDate(lease.pendingTransfer.transferDate)}.{' '}
            {t('dash.transferHolding')}{' '}
            {formatExpiry(lease.pendingTransfer.expiresAt, lease.facilityTimezone)}.{' '}
            <Link href="/portal/transfer" className="underline underline-offset-4">
              {t('dash.manageRequest')}
            </Link>
            .
          </p>
        </div>
      )}
      {/* B-090 part 3 / PRD 01 §9. "Delinquency self-cure UX beyond banner
          (payment plans)" — before this a tenant on a plan had no way to see
          it existed short of calling the office.

          B-191 / PRD 05 CN-24. Two corrections, both towards saying more when
          things go wrong rather than less. The card used to VANISH the night
          the plan broke — the same hour collections resumed — and it called
          the first not-yet-paid installment "your next", which for a past-due
          one named a payment already failed on a date already gone.

          Everything that distinguishes the three states is a WORD (1.4.1 A);
          nothing here is carried by colour.

          B-245: this used to be a `role="status"`, defended by the sentence
          "the region is server-rendered and present at page load rather than
          inserted on change (4.1.3 AA)". That reasoning holds for a full
          document load and is FALSE for a client-side navigation: `LeaseCard`
          is inside the page component, so a `<Link>` back to `/portal`
          unmounts and remounts this subtree and React inserts the region
          ALREADY POPULATED — the one case `e2e/a11y.spec.ts` and
          `components/admin/form.tsx` both name as unreliable, and this page
          carried eight of them per lease, two of them assertive.

          None of them was a status message. This is page content: it is true
          when the page is drawn, it does not change while the tenant reads it,
          and it is reached by heading and document position. That is what it
          has now. **No announcement is asserted and none was observed** —
          the B-216 standard. */}
      {lease.paymentPlan && (
        <div className="border-input rounded-md border p-3 text-sm text-pretty">
          {lease.paymentPlan.status === 'broken' ? (
            <p>
              <strong>{t('dash.planEndedStrong')}</strong> {t('dash.planEndedBody')}{' '}
              <Link href="/portal/payment-plan" className="underline underline-offset-4">
                {t('dash.planSeeWhatHappened')}
              </Link>
              , {t('dash.orCallNumber', { phone: lease.facilityPhone })}
            </p>
          ) : (
            <>
              {/* B-210. Late is not missed. D-98 gives the tenant
                  `planGraceDays` to catch an installment up, and this card
                  called the day after a due date a missed payment — the plan is
                  alive, and the tenant who reads that it is not has no reason
                  to pay. The deadline is stated because "soon" is not a rule
                  somebody can keep, and the pay link carries the installment
                  amount rather than the whole arrears the plan exists to
                  replace (the same correction B-193 made on the plan page). */}
              {lease.paymentPlan.late && (
                <p>
                  <strong>{t('dash.planLateStrong')}</strong>{' '}
                  {t('dash.planLateBody', {
                    amount: formatRate(lease.paymentPlan.late.amountCents),
                    date: formatDueDate(lease.paymentPlan.late.dueDate),
                  })}{' '}
                  <strong>
                    {formatDueDate(lease.paymentPlan.late.payByDate)}
                  </strong>
                  .{' '}
                  <Link
                    href={`/portal/pay?lease=${lease.leaseId}&amount=${lease.paymentPlan.late.amountCents / 100}`}
                    className="underline underline-offset-4"
                  >
                    {t('dash.payNow', {
                      amount: formatRate(lease.paymentPlan.late.amountCents),
                    })}
                  </Link>
                  , {t('dash.orCallNumber', { phone: lease.facilityPhone })}
                </p>
              )}
              {lease.paymentPlan.missed && (
                <p>
                  <strong>{t('dash.planMissedStrong')}</strong>{' '}
                  {t('dash.planMissedBody', {
                    amount: formatRate(lease.paymentPlan.missed.amountCents),
                    date: formatDueDate(lease.paymentPlan.missed.dueDate),
                  })}{' '}
                  <Link
                    href={`/portal/pay?lease=${lease.leaseId}&amount=${lease.paymentPlan.missed.amountCents / 100}`}
                    className="underline underline-offset-4"
                  >
                    {t('dash.payNow', {
                      amount: formatRate(lease.paymentPlan.missed.amountCents),
                    })}
                  </Link>{' '}
                  {t('dash.planKeepIt', { phone: lease.facilityPhone })}
                </p>
              )}
              <p>
                {t('dash.onAPlan')}{' '}
                {lease.paymentPlan.next ? (
                  <>
                    {t('dash.planNextBefore')}{' '}
                    <strong>{formatRate(lease.paymentPlan.next.amountCents)}</strong>{' '}
                    {t('dash.planNextOn')} {formatDueDate(lease.paymentPlan.next.dueDate)}.{' '}
                  </>
                ) : (
                  <>{t('dash.planNoneLeft')} </>
                )}
                <Link href="/portal/payment-plan" className="underline underline-offset-4">
                  {t('dash.planSeeSchedule')}
                </Link>
                .
              </p>
            </>
          )}
        </div>
      )}
      {lease.pendingMoveOutDate && (
        <div className="border-input rounded-md border p-3 text-sm text-pretty">
          <p>
            {t('dash.moveOutBefore')}{' '}
            <strong>{formatDueDate(lease.pendingMoveOutDate)}</strong>.{' '}
            <Link href="/portal/move-out" className="underline underline-offset-4">
              {t('dash.manageRequest')}
            </Link>
            .
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-muted-foreground">{t('dash.currentBalance')}</dt>
          {/* A negative ledger sum is a credit, not a debt of minus-something:
              formatRate would render it "$-39", which reads as an amount owed
              with a typo. Nothing writes a credit today (payments are capped
              at the balance), but a refund can, so it renders honestly. */}
          <dd className="font-medium">
            {lease.balanceCents < 0
              ? t('dash.inCredit', { amount: formatRate(-lease.balanceCents) })
              : formatRate(lease.balanceCents)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('dash.nextPayment')}</dt>
          <dd className="font-medium">
            {t('dash.nextPaymentOn', { amount: formatRate(nextPaymentCents), date: dueDate })}
            {/* B-227 / US-301: a total nobody can decompose is one that stayed
                wrong for months without anybody noticing. The parts are listed
                from what is actually non-zero, so a lease with no protection
                plan does not claim one. */}
            <span className="text-muted-foreground block text-xs font-normal">
              {chargePartsSentence(dict, recurringParts(lease.recurring))}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('dash.autopay')}</dt>
          <dd className="font-medium">
            {lease.autopayEnabled ? t('dash.on') : t('dash.off')}{' '}
            <Link href="/portal/methods" className="font-normal underline underline-offset-4">
              {t('dash.change')}
            </Link>
          </dd>
          {lease.autopayNeedsCard && (
            <p className="mt-1 text-sm text-pretty text-red-800">
              {t('dash.autopayNeedsCard')}
            </p>
          )}
        </div>
      </dl>

      <div>
        <h3 className="text-muted-foreground text-sm">{t('dash.gateCode')}</h3>
        {lease.accessSuspended ? (
          <p className="mt-1 text-sm text-pretty">
            {t('dash.accessSuspended')}{' '}
            <a href={telHref} className="underline underline-offset-4">
              {lease.facilityPhone}
            </a>{' '}
            {t('dash.withQuestions')}
          </p>
        ) : impersonated ? (
          // PRD 09 FR-12 + SR-2 (B-091 part 2). "Revealing an unmasked gate
          // code" is on the permanent hard-block list because PRD 03 SR-2 makes
          // it a SEPARATE audited permission for staff — an impersonated portal
          // that rendered it would launder exactly that permission, and SR-4's
          // view-parity rule is a floor ("never more than the subject sees"),
          // not a licence to show anything the subject can.
          //
          // The code is withheld here rather than hidden in CSS: `GateCodePanel`
          // is a client component, so a `hidden` code would still be serialised
          // into the page and readable in the HTML source.
          <p className="mt-1 text-sm text-pretty">
            {t('dash.gateCodeHiddenImpersonation')}
          </p>
        ) : lease.gateCode ? (
          <GateCodePanel code={lease.gateCode} />
        ) : (
          <p className="mt-1 text-sm text-pretty">
            {t('dash.gateCodeNotReady')}{' '}
            <a href={telHref} className="underline underline-offset-4">
              {lease.facilityPhone}
            </a>{' '}
            {t('dash.gateCodeNotReadyAfter')}
          </p>
        )}
      </div>
    </section>
  )
}

// B-256 / PRD 01 §12. What a business account's PAYER came here for: one
// total and one button, instead of the eleven cards and eleven buttons the
// portal drew before this — because it rendered per lease and B-090e, which
// built the account, changed no portal file.
//
// The card states two things that are true and easy to assume wrongly, and
// both of them are about where money goes:
//
//   * A payment here is spread across the whole account in the facility's
//     allocation order, oldest first. It is NOT applied to a unit of the
//     payer's choosing, and has not been since B-048 for anyone holding two
//     units — B-090e widened the pool to the account and named this wording as
//     the thing this row owes.
//   * Autopay is untouched by the account (D-119). `chargeAutopay` charges
//     `lease.tenant.stripeDefaultPaymentMethodId`, so eleven units still
//     autopay from eleven employees' own cards; attaching a unit to an account
//     does not move the mandate, and a payer who assumed otherwise would find
//     out on a card that was never charged.
//
// **What the card deliberately does NOT carry is the gate code.** Paying for a
// unit is not authority to open it: a code is a physical access credential for
// somebody else's goods, and PRD 03 SR-2 makes revealing one a separately
// audited permission even for staff. It holds by construction rather than by a
// condition here — `GateCodePanel` renders only inside `LeaseCard`, and
// `portalDashboardForTenant` still reads `{ tenantId }` alone, so a lease the
// viewer merely pays for never reaches that component. Widening that query is
// what would break it.
function AccountCard({ account, dict }: { account: PortalAccount; dict: Dictionary }) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  const headingId = `account-${account.id}-heading`
  const owesMoney = account.balanceCents > 0
  // The same fallback `portalDashboardForTenant` gives a lease card: a facility
  // with no number of its own falls back to the site's, rather than the call
  // line silently disappearing (B-164's rule).
  const phone = account.facilityPhone ?? SITE.phone.display
  const telHref = `tel:${phone.replace(/[^0-9+]/g, '')}`

  return (
    <section
      aria-labelledby={headingId}
      className="border-input flex flex-col gap-4 rounded-lg border p-4"
    >
      <div>
        <h2 id={headingId} className="font-medium">
          {account.name}
        </h2>
        <p className="text-muted-foreground text-sm">
          {plural(dict, account.units.length, 'acct.summaryOne', 'acct.summaryOther', {
            facility: account.facilityName,
            rate: `${formatRate(account.monthlyRateCents)}${t('card.perMonth')}`,
          })}
        </p>
      </div>

      {/* B-258. A member is shown the same money and offered none of the
          buttons. Said in words rather than by an absent control: a screen that
          silently drops the Pay button reads as a bug to the person who was
          told they now have access to the account. */}
      {!account.payable ? (
        <div className="border-input rounded-md border p-3 text-sm text-pretty">
          <p>
            {owesMoney
              ? plural(dict, account.units.length, 'acct.owesOne', 'acct.owesOther', {
                  amount: formatRate(account.balanceCents),
                })
              : t('acct.nothingOwed')}
          </p>
          <p className="mt-2">
            {t('acct.memberNote', { payer: account.payerName })}{' '}
            <a href={telHref} className="underline underline-offset-4">
              {phone}
            </a>
            .
          </p>
        </div>
      ) : owesMoney ? (
        <div className="border-input rounded-md border p-3 text-sm text-pretty">
          <p>
            {plural(dict, account.units.length, 'acct.owesOne', 'acct.owesOther', {
              amount: formatRate(account.balanceCents),
            })}
          </p>
          <Link
            href={`/portal/pay?account=${account.id}`}
            className="bg-primary text-primary-foreground mt-2 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
          >
            {t('acct.payNow', { amount: formatRate(account.balanceCents) })}
          </Link>
          <p className="mt-2">{t('acct.allocationNote')}</p>
          <p className="mt-2">
            {t('dash.orCall')}{' '}
            <a href={telHref} className="underline underline-offset-4">
              {phone}
            </a>{' '}
            {t('dash.orCallToPay')}
          </p>
        </div>
      ) : (
        <p className="text-sm text-pretty">{t('acct.nothingOwed')}</p>
      )}

      {/* A real table, not a visual list: "Unit 12 — Dana Foreman" and "$200.00"
          have to stay associated when the row is read one cell at a time
          (1.3.1 A). `formatCents` rather than `formatRate` for the same reason
          the pay screen uses it — a column where one figure reads "$129" and
          the next "$20.00" is harder to check. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('acct.tableCaption', { account: account.name })}</caption>
          <thead>
            <tr className="text-left">
              <th scope="col" className="py-2 font-medium">
                {t('acct.colUnit')}
              </th>
              {/* B-258. The renters' names are the payer's to see, not a
                  member's — a member was added to see what the account owes.
                  The whole column goes rather than its cells emptying, so the
                  table a screen reader announces has three headers or two and
                  never a header with nothing under it. */}
              {account.payable && (
                <th scope="col" className="py-2 font-medium">
                  {t('acct.colRentedBy')}
                </th>
              )}
              <th scope="col" className="py-2 text-right font-medium">
                {t('acct.colBalance')}
              </th>
            </tr>
          </thead>
          <tbody>
            {account.units.map((unit) => (
              <tr key={unit.leaseId} className="border-input border-t">
                <th scope="row" className="py-2 text-left font-normal">
                  {unit.unitNumber}
                </th>
                {account.payable && (
                  <td className="text-muted-foreground py-2">{unit.tenantName}</td>
                )}
                <td className="py-2 text-right tabular-nums">
                  {unit.balanceCents < 0
                    ? t('dash.inCredit', { amount: formatCents(-unit.balanceCents) })
                    : formatCents(unit.balanceCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* D-119. Stated because the opposite is the natural assumption, and
          because the consequence of assuming it is a bill nobody paid. Only for
          the payer: to a member it is a paragraph about a payment method that is
          not theirs. B-258's statements gap is the same shape — the account's
          statements stay the payer's, so a member is not offered the link. */}
      {account.payable && (
        <>
          <p className="text-muted-foreground text-sm text-pretty">
            {t('acct.autopayNote')}
          </p>

          <p className="text-sm">
            <Link href="/portal/statements" className="underline underline-offset-4">
              {t('acct.statementsLink')}
            </Link>
          </p>
        </>
      )}
    </section>
  )
}

export default async function PortalHomePage() {
  const actor = await requireTenantActor()
  const [leases, accounts, impersonation, locale] = await Promise.all([
    portalDashboardForTenant(actor.tenantId),
    portalAccountsFor(actor.tenantId),
    currentImpersonation(),
    getLocale(),
  ])
  const impersonated = Boolean(impersonation)
  const dict = dictionaryFor(locale)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{translate(dict, 'dash.title')}</h1>

      {/* B-256. The units this tenant HOLDS come first, then the accounts they
          PAY FOR. That order because the first group is where their own gate
          code, plan and move-out live, and a payer who holds nothing simply
          starts at their account card. A payer whose own unit sits on their own
          account appears in both, which is deliberate — the lease card has the
          gate code, the account card has the money, and `billedTo` keeps the
          balance from being offered twice. */}
      {leases.length === 0 && accounts.length === 0 ? (
        <p className="text-muted-foreground text-sm text-pretty">
          {translate(dict, 'dash.noUnits')}
        </p>
      ) : (
        <>
          {leases.map((lease) => (
            <LeaseCard
              key={lease.leaseId}
              lease={lease}
              impersonated={impersonated}
              dict={dict}
            />
          ))}
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} dict={dict} />
          ))}
        </>
      )}
    </div>
  )
}
