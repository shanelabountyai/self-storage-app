import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { portalDashboardForTenant, type PortalLeaseSummary } from '@/lib/portal/dashboard'
import { formatRate } from '@/lib/format'
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

function formatDueDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'long', day: 'numeric' }).format(date)
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
  const nextPaymentCents = lease.monthlyRateCents + lease.protectionCents
  const dueDate = formatDueDate(lease.nextDueDate, lease.facilityTimezone)
  const telHref = `tel:${lease.facilityPhone.replace(/[^0-9+]/g, '')}`

  return (
    <section className="border-input flex flex-col gap-4 rounded-lg border p-4">
      {owesMoney && lease.accessSuspended && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900">
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
        <div role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
          <p>
            <strong>{formatRate(lease.settlingCents)}</strong> is on its way from your bank. Bank
            payments take about four business days to clear. Your balance updates when it arrives,
            and you won&apos;t be charged a late fee while it&apos;s in transit.
          </p>
        </div>
      )}
      {owesMoney && !lease.accessSuspended && (
        <div role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
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
        <div role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
          <p>
            You asked to move to <strong>Unit {lease.pendingTransfer.toUnitNumber}</strong> on{' '}
            {formatDueDate(lease.pendingTransfer.transferDate, lease.facilityTimezone)}. We&apos;re
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
          nothing here is carried by colour. The region is server-rendered and
          present at page load rather than inserted on change (4.1.3 AA). */}
      {lease.paymentPlan && (
        <div role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
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
              {lease.paymentPlan.missed && (
                <p>
                  <strong>A payment on your plan was missed.</strong>{' '}
                  {formatRate(lease.paymentPlan.missed.amountCents)} was due on{' '}
                  {formatDueDate(lease.paymentPlan.missed.dueDate, lease.facilityTimezone)}. Pay it
                  to keep the plan, or call {lease.facilityPhone}.
                </p>
              )}
              <p>
                You&apos;re on a payment plan.{' '}
                {lease.paymentPlan.next ? (
                  <>
                    Your next payment is{' '}
                    <strong>{formatRate(lease.paymentPlan.next.amountCents)}</strong> on{' '}
                    {formatDueDate(lease.paymentPlan.next.dueDate, lease.facilityTimezone)}.{' '}
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
        <div role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
          <p>
            You asked to move out on{' '}
            <strong>{formatDueDate(lease.pendingMoveOutDate, lease.facilityTimezone)}</strong>.{' '}
            <Link href="/portal/move-out" className="underline underline-offset-4">
              Manage this request
            </Link>
            .
          </p>
        </div>
      )}

      <div>
        <h2 className="font-medium">
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
            <p role="alert" className="mt-1 text-sm text-pretty text-red-800">
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
