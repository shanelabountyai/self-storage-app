import type { Metadata } from 'next'
import { listParts, recurringParts } from '@storage/core/pricing'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { portalDashboardForTenant, type PortalLeaseSummary } from '@/lib/portal/dashboard'
import { formatCalendarDate, formatRate } from '@/lib/format'
import { GateCodePanel } from '@/components/portal/gate-code-panel'
import { currentImpersonation } from '@/lib/impersonation/context'

export const metadata: Metadata = { title: 'My account' }

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

function PayNowButton({ lease }: { lease: PortalLeaseSummary }) {
  return (
    <Link
      href={`/portal/pay?lease=${lease.leaseId}`}
      className="bg-primary text-primary-foreground mt-2 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
    >
      Pay {formatRate(lease.balanceCents)} now
    </Link>
  )
}

function LeaseCard({ lease, impersonated }: { lease: PortalLeaseSummary; impersonated: boolean }) {
  const owesMoney = lease.balanceCents > 0
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
          {lease.facilityName} — Unit {lease.unitNumber}
        </h2>
        <p className="text-muted-foreground text-sm">
          <span aria-hidden="true">
            {lease.widthFt}×{lease.lengthFt}
          </span>
          <span className="sr-only">
            {lease.widthFt} foot by {lease.lengthFt} foot
          </span>{' '}
          · {formatRate(lease.monthlyRateCents)}/mo
        </p>
      </div>

      {owesMoney && lease.accessSuspended && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900">
          <p>
            Your account is past due. Your gate code won&apos;t open the gate until the balance is
            paid. Pay your full balance of <strong>{formatRate(lease.balanceCents)}</strong> and
            your gate code starts working again, usually within a couple of minutes.
          </p>
          <PayNowButton lease={lease} />
          <p className="mt-2">
            Or call{' '}
            <a href={telHref} className="underline underline-offset-4">
              {lease.facilityPhone}
            </a>{' '}
            to pay by phone.
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
            <strong>{formatRate(lease.settlingCents)}</strong> is on its way from your bank. Bank
            payments take about four business days to clear. Your balance updates when it arrives,
            and you won&apos;t be charged a late fee while it&apos;s in transit.
          </p>
        </div>
      )}
      {owesMoney && !lease.accessSuspended && (
        <div className="border-input rounded-md border p-3 text-sm text-pretty">
          <p>
            You have a balance of <strong>{formatRate(lease.balanceCents)}</strong>.
          </p>
          <PayNowButton lease={lease} />
          <p className="mt-2">
            Or call{' '}
            <a href={telHref} className="underline underline-offset-4">
              {lease.facilityPhone}
            </a>{' '}
            to pay by phone.
          </p>
        </div>
      )}

      {/* B-142 / PRD 01 §4.7 US-709, US-702. "Did that go through" is the one
          question a tenant returns to answer — used to be two taps deep
          behind the "Manage" disclosure. */}
      {lease.pendingTransfer && (
        <div className="border-input rounded-md border p-3 text-sm text-pretty">
          <p>
            You asked to move to <strong>Unit {lease.pendingTransfer.toUnitNumber}</strong> on{' '}
            {formatDueDate(lease.pendingTransfer.transferDate)}. We&apos;re
            holding it until{' '}
            {formatExpiry(lease.pendingTransfer.expiresAt, lease.facilityTimezone)}.{' '}
            <Link href="/portal/transfer" className="underline underline-offset-4">
              Manage this request
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
              <strong>Your payment plan has ended</strong> because a payment was missed. The full
              balance above is due now, and late fees and gate access go back to normal.{' '}
              <Link href="/portal/payment-plan" className="underline underline-offset-4">
                See the plan and what happened
              </Link>
              , or call {lease.facilityPhone}.
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
                  <strong>A payment on your plan is late.</strong>{' '}
                  {formatRate(lease.paymentPlan.late.amountCents)} was due on{' '}
                  {formatDueDate(lease.paymentPlan.late.dueDate)}. Your plan
                  carries on if you pay it by{' '}
                  <strong>
                    {formatDueDate(lease.paymentPlan.late.payByDate)}
                  </strong>
                  .{' '}
                  <Link
                    href={`/portal/pay?lease=${lease.leaseId}&amount=${lease.paymentPlan.late.amountCents / 100}`}
                    className="underline underline-offset-4"
                  >
                    Pay {formatRate(lease.paymentPlan.late.amountCents)} now
                  </Link>
                  , or call {lease.facilityPhone}.
                </p>
              )}
              {lease.paymentPlan.missed && (
                <p>
                  <strong>A payment on your plan was missed.</strong>{' '}
                  {formatRate(lease.paymentPlan.missed.amountCents)} was due on{' '}
                  {formatDueDate(lease.paymentPlan.missed.dueDate)}.{' '}
                  <Link
                    href={`/portal/pay?lease=${lease.leaseId}&amount=${lease.paymentPlan.missed.amountCents / 100}`}
                    className="underline underline-offset-4"
                  >
                    Pay {formatRate(lease.paymentPlan.missed.amountCents)} now
                  </Link>{' '}
                  to keep the plan, or call {lease.facilityPhone}.
                </p>
              )}
              <p>
                You&apos;re on a payment plan.{' '}
                {lease.paymentPlan.next ? (
                  <>
                    Your next payment is{' '}
                    <strong>{formatRate(lease.paymentPlan.next.amountCents)}</strong> on{' '}
                    {formatDueDate(lease.paymentPlan.next.dueDate)}.{' '}
                  </>
                ) : (
                  <>There are no payments left to make on it. </>
                )}
                <Link href="/portal/payment-plan" className="underline underline-offset-4">
                  See the full schedule
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
            You asked to move out on{' '}
            <strong>{formatDueDate(lease.pendingMoveOutDate)}</strong>.{' '}
            <Link href="/portal/move-out" className="underline underline-offset-4">
              Manage this request
            </Link>
            .
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Current balance</dt>
          {/* A negative ledger sum is a credit, not a debt of minus-something:
              formatRate would render it "$-39", which reads as an amount owed
              with a typo. Nothing writes a credit today (payments are capped
              at the balance), but a refund can, so it renders honestly. */}
          <dd className="font-medium">
            {lease.balanceCents < 0
              ? `${formatRate(-lease.balanceCents)} in credit`
              : formatRate(lease.balanceCents)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Next payment</dt>
          <dd className="font-medium">
            {formatRate(nextPaymentCents)} on {dueDate}
            {/* B-227 / US-301: a total nobody can decompose is one that stayed
                wrong for months without anybody noticing. The parts are listed
                from what is actually non-zero, so a lease with no protection
                plan does not claim one. */}
            <span className="text-muted-foreground block text-xs font-normal">
              {listParts(recurringParts(lease.recurring))}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Autopay</dt>
          <dd className="font-medium">
            {lease.autopayEnabled ? 'On' : 'Off'}{' '}
            <Link href="/portal/methods" className="font-normal underline underline-offset-4">
              Change
            </Link>
          </dd>
          {lease.autopayNeedsCard && (
            <p className="mt-1 text-sm text-pretty text-red-800">
              No card on file — nothing will be charged automatically.
            </p>
          )}
        </div>
      </dl>

      <div>
        <h3 className="text-muted-foreground text-sm">Gate code</h3>
        {lease.accessSuspended ? (
          <p className="mt-1 text-sm text-pretty">
            Access is suspended until the balance is paid. Call{' '}
            <a href={telHref} className="underline underline-offset-4">
              {lease.facilityPhone}
            </a>{' '}
            with questions.
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
            The gate code is hidden during a support session. The tenant sees it here.
          </p>
        ) : lease.gateCode ? (
          <GateCodePanel code={lease.gateCode} />
        ) : (
          <p className="mt-1 text-sm text-pretty">
            Your gate code isn&apos;t ready yet. Call{' '}
            <a href={telHref} className="underline underline-offset-4">
              {lease.facilityPhone}
            </a>{' '}
            and we&apos;ll get you in.
          </p>
        )}
      </div>
    </section>
  )
}

export default async function PortalHomePage() {
  const actor = await requireTenantActor()
  const [leases, impersonation] = await Promise.all([
    portalDashboardForTenant(actor.tenantId),
    currentImpersonation(),
  ])
  const impersonated = Boolean(impersonation)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">My account</h1>

      {leases.length === 0 ? (
        <p className="text-muted-foreground text-sm text-pretty">
          We don&apos;t see an active unit on this account yet.
        </p>
      ) : (
        leases.map((lease) => (
          <LeaseCard key={lease.leaseId} lease={lease} impersonated={impersonated} />
        ))
      )}
    </div>
  )
}
