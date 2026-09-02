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
import { balanceBreakdownFor, reconciles } from '@/lib/portal/balance-breakdown'
import { restoreShortfallCents } from '@storage/core/access'
import { formatCents, formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'
import { PortalPayment } from '@/components/portal/portal-payment'
import { PayAmountForm } from '@/components/portal/pay-amount-form'

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
  const [setup, breakdown] = await Promise.all([
    startPortalPayment(actor.tenantId, lease, amountCents),
    balanceBreakdownFor(lease.leaseId, lease.facilityTimezone),
  ])

  // B-232. The itemisation comes off the same ledger read as the total, so this
  // holds by construction. It is checked anyway, and the lines are dropped
  // rather than shown if it fails: a bill that does not add up, on the screen
  // that then asks for the money, is worse than the bare total this replaced.
  const itemised = reconciles(breakdown, lease.balanceCents) ? breakdown.lines : []
  const shortfallCents = restoreShortfallCents({
    facilityBalanceCents: lease.facilityBalanceCents,
    restoreAtOrBelowCents: lease.restoreAtOrBelowCents,
  })
  const telHref = `tel:${phone.replace(/[^0-9+]/g, '')}`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Pay your balance</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {lease.facilityName} — Unit {lease.unitNumber}
        </p>
      </div>

      {/* 3.3.4 Error Prevention (Financial): what is being charged, stated
          before the control that charges it — and since B-232, what it is FOR.
          A real table with column headers rather than a visual list of rows
          (1.3.1): the association between "Late fee, assessed 6 October" and
          "$20.00" has to survive being read one cell at a time.

          `formatCents` here, not `formatRate`: this is a bill, and a column of
          figures in which one reads "$129" and the next "$20.00" is harder to
          check than one where every row carries its cents. */}
      <div className="border-input overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="px-4 pt-4 text-left font-medium">
            What you owe on unit {lease.unitNumber}
          </caption>
          <thead>
            <tr className="text-left">
              <th scope="col" className="px-4 py-2 font-medium">
                What
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                When
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          {itemised.length > 0 && (
            <tbody>
              {itemised.map((line, index) => (
                <tr key={`${line.label}-${index}`} className="border-t">
                  <td className="px-4 py-2">
                    {line.label}
                    {/* 2.4.4. The number to call about THIS charge, on the line
                        that carries it. A tenant who thinks a late fee is wrong
                        should not have to scroll past the pay button to find
                        out who to ask. */}
                    {line.disputable && (
                      <>
                        {' '}
                        <a
                          href={telHref}
                          className="text-muted-foreground whitespace-nowrap underline underline-offset-4"
                        >
                          Query this — {phone}
                        </a>
                      </>
                    )}
                  </td>
                  <td className="text-muted-foreground px-4 py-2 whitespace-nowrap">{line.on}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatCents(line.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          )}
          <tfoot>
            <tr className="border-t">
              <th scope="row" colSpan={2} className="px-4 py-2 text-left font-medium">
                Balance
              </th>
              <td className="px-4 py-2 text-right font-medium tabular-nums">
                {formatCents(lease.balanceCents)}
              </td>
            </tr>
            <tr className="border-t">
              <th scope="row" colSpan={2} className="px-4 py-2 pb-4 text-left text-base font-medium">
                Paying today
              </th>
              <td className="px-4 py-2 pb-4 text-right text-base font-medium tabular-nums">
                {formatCents(amountCents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* B-232 / D-16. What paying this buys, on the screen where the amount is
          chosen. Not a live region: it is server-rendered and present at load,
          so it needs no announcement — the one that CHANGES as somebody types
          is inside "Pay a different amount" below.

          `shortfallCents` is the facility-wide figure the gate rule actually
          reads, minus the facility's own restore threshold. Both were absent
          here: the portal restated D-16's DEFAULT of zero as though it were the
          rule, and read one lease's balance for a decision made across all of
          them. */}
      {lease.accessSuspended && (
        <p className="border-input rounded-lg border p-4 text-sm text-pretty">
          Your gate code is switched off.{' '}
          {amountCents >= shortfallCents ? (
            <>
              Paying <strong>{formatCents(amountCents)}</strong> turns it back on, usually
              within a couple of minutes.
            </>
          ) : (
            <>
              <strong>{formatCents(shortfallCents)}</strong> turns it back on — paying{' '}
              {formatCents(amountCents)} leaves it switched off.
            </>
          )}
        </p>
      )}

      {!checked.ok && checked.problem !== 'nothing_owed' && (
        <p role="alert" className="border-input rounded-md border p-3 text-sm text-pretty">
          {AMOUNT_PROBLEM_COPY[checked.problem]} We&apos;ve put your full balance back in for now.
        </p>
      )}

      <details className="border-input rounded-lg border p-4" open={Boolean(amount) && !checked.ok}>
        <summary className="cursor-pointer text-sm font-medium">Pay a different amount</summary>
        <PayAmountForm
          leaseId={lease.leaseId}
          amountCents={amountCents}
          facilityBalanceCents={lease.facilityBalanceCents}
          restoreAtOrBelowCents={lease.restoreAtOrBelowCents}
          accessSuspended={lease.accessSuspended}
        />
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
