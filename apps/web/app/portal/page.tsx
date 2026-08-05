import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { portalDashboardForTenant, type PortalLeaseSummary } from '@/lib/portal/dashboard'
import { formatRate } from '@/lib/format'
import { GateCodePanel } from '@/components/portal/gate-code-panel'

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

function LeaseCard({ lease }: { lease: PortalLeaseSummary }) {
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
  const leases = await portalDashboardForTenant(actor.tenantId)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">My account</h1>

      {leases.length === 0 ? (
        <p className="text-muted-foreground text-sm text-pretty">
          We don&apos;t see an active unit on this account yet.
        </p>
      ) : (
        leases.map((lease) => <LeaseCard key={lease.leaseId} lease={lease} />)
      )}
    </div>
  )
}
