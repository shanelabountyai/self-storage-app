import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import {
  MIN_PAYMENT_CENTS,
  payableLease,
  startPortalPayment,
  validatePaymentAmount,
  prepayCeilingFor,
  type AmountProblem,
} from '@/lib/portal/payment'
import { formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'
import { PortalPayment } from '@/components/portal/portal-payment'

export const metadata: Metadata = { title: 'Pay your balance' }

// PRD 01 §4.7 US-703. Pay the balance in ≤3 taps: "Pay $X" on the dashboard
// lands here with the full balance already prepared, and confirming in the
// Payment Element is the second tap. Paying a different amount adds one.
//
// The amount travels in the query string rather than a Server Action so the
// whole flow still works with JavaScript disabled (§6.2) up to the Element
// itself, which is Stripe's and needs JS by nature — that case falls back to
// the phone number, same as everywhere else money is involved.

const AMOUNT_PROBLEM_COPY: Record<AmountProblem, string> = {
  not_a_number: 'Enter an amount like 75 or 75.50.',
  below_minimum: `The smallest payment we can take online is ${formatRate(MIN_PAYMENT_CENTS)}.`,
  above_balance: 'That is more than you owe. Enter your balance or less.',
  // B-225. Paying ahead is supported now, so this refusal is about a LIMIT
  // rather than about the tenant having done something wrong — and it must not
  // read like "enter your balance or less", which would be false.
  above_prepay_ceiling:
    'That is much more than a year of rent. Call the office and we will take it over the phone.',
  nothing_owed: 'There is nothing to pay right now.',
}

function CallInstead({ phone }: { phone: string }) {
  const href = `tel:${phone.replace(/[^0-9+]/g, '')}`
  return (
    <p className="border-input rounded-lg border p-4 text-sm text-pretty">
      We can&apos;t take card payments online just now. Call{' '}
      <a href={href} className="font-medium underline underline-offset-4">
        {phone}
      </a>{' '}
      and we will take your payment over the phone.
    </p>
  )
}

export default async function PortalPayPage({
  searchParams,
}: {
  searchParams: Promise<{ lease?: string; amount?: string }>
}) {
  const { lease: leaseId, amount } = await searchParams
  const actor = await requireTenantActor()

  const lease = leaseId ? await payableLease(actor.tenantId, leaseId) : null
  if (!lease) {
    // Same message whether the lease does not exist or belongs to someone
    // else — there is nothing to tell apart from the outside.
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Pay your balance</h1>
        <p className="text-sm text-pretty">We couldn&apos;t find that unit on your account.</p>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          Back to my account
        </Link>
      </div>
    )
  }

  const phone = lease.facilityPhone ?? SITE.phone.display

  if (lease.balanceCents <= 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Pay your balance</h1>
        <p className="text-sm text-pretty">
          You&apos;re all paid up on unit {lease.unitNumber} — there&apos;s nothing to pay right now.
        </p>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          Back to my account
        </Link>
      </div>
    )
  }

  // No amount in the URL means "the whole balance", which is what the
  // dashboard button asks for and what almost everyone wants.
  const requested = amount ?? String(lease.balanceCents / 100)
  // B-225. Money paid past the balance is banked as credit on account and spent
  // on the next invoice raised. Until this row it was refused outright, with a
  // comment promising prepayment "comes back with B-044" — B-044 shipped
  // without it, and the refusal became the reason the product would not take
  // money a tenant was trying to give it.
  const checked = validatePaymentAmount(
    requested,
    lease.balanceCents,
    prepayCeilingFor(lease),
  )
  const amountCents = checked.ok ? checked.amountCents : lease.balanceCents
  const setup = await startPortalPayment(actor.tenantId, lease, amountCents)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Pay your balance</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {lease.facilityName} — Unit {lease.unitNumber}
        </p>
      </div>

      {/* 3.3.4 Error Prevention (Financial): what is being charged, stated
          before the control that charges it. */}
      <dl className="border-input rounded-lg border p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt>Balance</dt>
          <dd className="tabular-nums">{formatRate(lease.balanceCents)}</dd>
        </div>
        <div className="mt-2 flex justify-between gap-4 border-t pt-2 text-base font-medium">
          <dt>Paying today</dt>
          <dd className="tabular-nums">{formatRate(amountCents)}</dd>
        </div>
      </dl>

      {!checked.ok && checked.problem !== 'nothing_owed' && (
        <p role="alert" className="border-input rounded-md border p-3 text-sm text-pretty">
          {AMOUNT_PROBLEM_COPY[checked.problem]} We&apos;ve put your full balance back in for now.
        </p>
      )}

      <details className="border-input rounded-lg border p-4" open={Boolean(amount) && !checked.ok}>
        <summary className="cursor-pointer text-sm font-medium">Pay a different amount</summary>
        <form method="GET" className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="lease" value={lease.leaseId} />
          <label className="flex flex-col gap-1 text-sm">
            Amount in dollars
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={(amountCents / 100).toFixed(2)}
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
          >
            Update amount
          </button>
        </form>
      </details>

      <section aria-labelledby="card-heading">
        <h2 id="card-heading" className="font-medium">
          Card details
        </h2>
        {setup.available ? (
          <PortalPayment
            clientSecret={setup.clientSecret}
            customerSessionSecret={setup.customerSessionSecret}
            returnUrl={`${process.env.AUTH_URL ?? 'http://localhost:3000'}/portal/pay/done?payment=${setup.paymentId}`}
            amountLabel={formatRate(amountCents)}
          />
        ) : (
          <div className="mt-3">
            <CallInstead phone={phone} />
          </div>
        )}
      </section>

      <Link href="/portal" className="text-sm underline underline-offset-4">
        Back to my account
      </Link>
    </div>
  )
}
