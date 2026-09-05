import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import {
  MIN_PAYMENT_CENTS,
  payableAccount,
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
import { dictionaryFor, translate, type Dictionary, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await getLocale()), 'paypg.title') }
}

// PRD 01 §4.7 US-703. Pay the balance in ≤3 taps: "Pay $X" on the dashboard
// lands here with the full balance already prepared, and confirming in the
// Payment Element is the second tap. Paying a different amount adds one.
//
// The amount travels in the query string rather than a Server Action so the
// whole flow still works with JavaScript disabled (§6.2) up to the Element
// itself, which is Stripe's and needs JS by nature — that case falls back to
// the phone number, same as everywhere else money is involved.

// B-260: keys, not sentences. `below_minimum` interpolates the minimum, which
// is why this is resolved through `translate` at render rather than being a
// map of finished strings built once at module load — the old template literal
// baked `MIN_PAYMENT_CENTS` in at import time, which was fine for one language
// and is not for two.
//
// B-225's note still applies to `above_prepay_ceiling`: it is a refusal about a
// LIMIT rather than about the tenant having done something wrong, and it must
// not read like "enter your balance or less", which would be false.
const AMOUNT_PROBLEM_KEYS: Record<AmountProblem, MessageKey> = {
  not_a_number: 'amt.notANumber',
  below_minimum: 'amt.belowMinimum',
  above_balance: 'amt.aboveBalance',
  above_prepay_ceiling: 'amt.abovePrepayCeiling',
  nothing_owed: 'amt.nothingOwed',
}

function CallInstead({ phone, dict }: { phone: string; dict: Dictionary }) {
  const href = `tel:${phone.replace(/[^0-9+]/g, '')}`
  return (
    <p className="border-input rounded-lg border p-4 text-sm text-pretty">
      {translate(dict, 'paypg.callInstead')}{' '}
      <a href={href} className="font-medium underline underline-offset-4">
        {phone}
      </a>{' '}
      {translate(dict, 'paypg.callInsteadAfter')}
    </p>
  )
}

export default async function PortalPayPage({
  searchParams,
}: {
  searchParams: Promise<{ lease?: string; account?: string; amount?: string }>
}) {
  const { lease: leaseId, account: accountId, amount } = await searchParams
  const actor = await requireTenantActor()
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  // B-256. One unit, or a whole business account. `account` wins if both are
  // present — a link carries one or the other, and picking the larger subject
  // can only ever offer to settle MORE than was asked for, never less than the
  // tenant thought they were paying.
  const lease = accountId
    ? await payableAccount(actor.tenantId, accountId)
    : leaseId
      ? await payableLease(actor.tenantId, leaseId)
      : null
  if (!lease) {
    // Same message whether the lease does not exist or belongs to someone
    // else — there is nothing to tell apart from the outside.
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t('paypg.title')}</h1>
        <p className="text-sm text-pretty">
          {t(accountId ? 'paypg.notFoundAccount' : 'paypg.notFoundUnit')}
        </p>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          {t('paypg.backToAccount')}
        </Link>
      </div>
    )
  }

  const phone = lease.facilityPhone ?? SITE.phone.display

  if (lease.balanceCents <= 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t('paypg.title')}</h1>
        <p className="text-sm text-pretty">
          {lease.account
            ? t('paypg.allPaidAccount', { name: lease.account.name })
            : t('paypg.allPaidUnit', { unit: lease.unitNumber })}
        </p>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          {t('paypg.backToAccount')}
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
  //
  // B-256. No prepayment ceiling on an ACCOUNT payment, which means overpayment
  // is refused there exactly as it was everywhere before B-225. Credit on
  // account is derived at tenant x facility (B-225) and a business account's
  // payer typically holds no lease at that facility at all — so money paid past
  // the account's balance would bank credit against the payer, where none of
  // the three jobs that spend credit would ever reach it, and the units it was
  // meant for would still read as owing. Paying ahead on an account needs an
  // owner decision about whose credit it is; until then the screen refuses it
  // and says to call, which is what `above_balance` already says.
  const checked = validatePaymentAmount(
    requested,
    lease.balanceCents,
    lease.account ? 0 : prepayCeilingFor(lease),
  )
  const amountCents = checked.ok ? checked.amountCents : lease.balanceCents
  const [setup, breakdown] = await Promise.all([
    startPortalPayment(actor.tenantId, lease, amountCents),
    // An account's bill is its units, not one lease's ledger — itemising the
    // anchor lease would print one unit's charges under a total covering
    // eleven.
    lease.account
      ? Promise.resolve({ lines: [], totalCents: 0 })
      : balanceBreakdownFor(lease.leaseId, lease.facilityTimezone),
  ])

  // B-232. The itemisation comes off the same ledger read as the total, so this
  // holds by construction. It is checked anyway, and the lines are dropped
  // rather than shown if it fails: a bill that does not add up, on the screen
  // that then asks for the money, is worse than the bare total this replaced.
  const itemised =
    !lease.account && reconciles(breakdown, lease.balanceCents) ? breakdown.lines : []
  const shortfallCents = restoreShortfallCents({
    facilityBalanceCents: lease.facilityBalanceCents,
    restoreAtOrBelowCents: lease.restoreAtOrBelowCents,
  })
  const telHref = `tel:${phone.replace(/[^0-9+]/g, '')}`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t('paypg.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {lease.account
            ? t('paypg.subheadAccount', {
                facility: lease.facilityName,
                account: lease.account.name,
              })
            : t('paypg.subheadUnit', {
                facility: lease.facilityName,
                unit: lease.unitNumber,
              })}
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
            {lease.account
              ? t('paypg.captionAccount', { account: lease.account.name })
              : t('paypg.captionUnit', { unit: lease.unitNumber })}
          </caption>
          <thead>
            <tr className="text-left">
              <th scope="col" className="px-4 py-2 font-medium">
                {t(lease.account ? 'paypg.colUnit' : 'paypg.colWhat')}
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                {t(lease.account ? 'paypg.colRentedBy' : 'paypg.colWhen')}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t('paypg.colAmount')}
              </th>
            </tr>
          </thead>
          {/* B-256. An account's bill is its UNITS. The per-unit balances are
              the same ledger sums the account card added up, so the rows and
              the total below cannot disagree — the itemisation of a single
              lease is a different question and is asked, per unit, on that
              unit's own statement. */}
          {lease.account && (
            <tbody>
              {lease.account.units.map((unit) => (
                <tr key={unit.leaseId} className="border-t">
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    {unit.unitNumber}
                  </th>
                  <td className="text-muted-foreground px-4 py-2">{unit.tenantName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatCents(unit.balanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          )}
          {itemised.length > 0 && (
            <tbody>
              {itemised.map((line, index) => (
                <tr key={`${line.label ?? 'late-fee'}-${index}`} className="border-t">
                  <td className="px-4 py-2">
                    {/* B-260: a generated label comes from the dictionary, a
                        stored one is printed as the billing engine wrote it —
                        translating a recorded invoice line would make this
                        screen disagree with the statement it itemises. */}
                    {line.lateFee ? t('paypg.lateFeeAssessed', { on: line.on }) : line.label}
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
                          {t('paypg.queryThis', { phone })}
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
                {t('paypg.balance')}
              </th>
              <td className="px-4 py-2 text-right font-medium tabular-nums">
                {formatCents(lease.balanceCents)}
              </td>
            </tr>
            <tr className="border-t">
              <th scope="row" colSpan={2} className="px-4 py-2 pb-4 text-left text-base font-medium">
                {t('paypg.payingToday')}
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
          {t('paypg.gateOff')}{' '}
          {amountCents >= shortfallCents ? (
            <>
              {t('paypg.gateOnBefore')} <strong>{formatCents(amountCents)}</strong>{' '}
              {t('paypg.gateOnAfter')}
            </>
          ) : (
            <>
              <strong>{formatCents(shortfallCents)}</strong> {t('paypg.gateShortBefore')}{' '}
              {formatCents(amountCents)} {t('paypg.gateShortAfter')}
            </>
          )}
        </p>
      )}

      {!checked.ok && checked.problem !== 'nothing_owed' && (
        <p role="alert" className="border-input rounded-md border p-3 text-sm text-pretty">
          {t(AMOUNT_PROBLEM_KEYS[checked.problem], {
            min: formatRate(MIN_PAYMENT_CENTS),
          })}{' '}
          {t('paypg.balanceRestored')}
        </p>
      )}

      <details className="border-input rounded-lg border p-4" open={Boolean(amount) && !checked.ok}>
        <summary className="cursor-pointer text-sm font-medium">{t('paypg.payDifferent')}</summary>
        <PayAmountForm
          subject={
            lease.account
              ? { field: 'account', id: lease.account.id }
              : { field: 'lease', id: lease.leaseId }
          }
          amountCents={amountCents}
          facilityBalanceCents={lease.facilityBalanceCents}
          restoreAtOrBelowCents={lease.restoreAtOrBelowCents}
          accessSuspended={lease.accessSuspended}
        />
      </details>

      <section aria-labelledby="card-heading">
        <h2 id="card-heading" className="font-medium">
          {t('paypg.cardDetails')}
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
            <CallInstead phone={phone} dict={dict} />
          </div>
        )}
      </section>

      <Link href="/portal" className="text-sm underline underline-offset-4">
        {t('paypg.backToAccount')}
      </Link>
    </div>
  )
}
