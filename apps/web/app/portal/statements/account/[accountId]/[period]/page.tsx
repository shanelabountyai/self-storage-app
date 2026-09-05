import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenantActor } from '@/lib/rbac/session'
import { portalAccountsFor } from '@/lib/billing/accounts'
import { leaseStatement } from '@/lib/billing/statements'
import { parseStatementPeriod, statementPeriodSegment } from '@/lib/billing/statement-period'
import { formatCents } from '@/lib/format'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, plural, translate, type Dictionary, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export const metadata: Metadata = { title: 'Account statement' }

// B-256 / PRD 01 §12, US-705. One business account, one month, for the payer.
//
// A summary OVER the per-unit statements rather than a replacement for them,
// which is the whole reason it can exist at all: `Invoice` is per lease and
// stays that way (D-118, because a Texas lien attaches to the goods in one
// unit and a §59 notice names one unit), so the consolidated document is an
// addition and never the record. Every row links to the unit's own statement,
// which is the one an accountant, a dispute or a lien file actually needs.
//
// Each figure comes from `leaseStatement` — the same function the per-unit page
// renders — so a row here and the page it links to cannot disagree. It throws
// rather than returning a statement that does not reconcile, and that is left
// to throw: a consolidated total built on a broken per-unit one would be a
// second wrong number rather than a caught error.

/// What the month did to the balance, in words rather than a sign. A bare
/// "-$129.00" in a column of money reads as an amount owed with a typo — the
/// same reason the dashboard spells out "in credit" rather than negating a
/// figure.
function movement(openingCents: number, closingCents: number, dict: Dictionary): string {
  const change = closingCents - openingCents
  if (change === 0) return translate(dict, 'astmt.noChange')
  return change > 0
    ? translate(dict, 'astmt.added', { amount: formatCents(change) })
    : translate(dict, 'astmt.cleared', { amount: formatCents(-change) })
}

export default async function AccountStatementPage({
  params,
}: {
  params: Promise<{ accountId: string; period: string }>
}) {
  const { accountId, period } = await params
  const actor = await requireTenantActor()
  const locale = await getLocale()
  const dict = dictionaryFor(locale)

  const parsed = parseStatementPeriod(period)
  if (!parsed) notFound()

  // Authorization and lookup in one call: `portalAccountsFor` returns only
  // accounts this tenant may reach, so an account id in the URL that is
  // somebody else's comes back as nothing rather than as a month of their
  // money.
  //
  // B-258. `payable` is tested too, so this stays the PAYER's document. An
  // authorized member sees the account card and its total; this page is a row
  // per unit naming that unit's renter, and every row links to that renter's
  // own full financial history — which is a wider disclosure than sight of an
  // account, and its own decision rather than a side effect of this one.
  //
  // `includeEndedLeases`, because this is the bookkeeping document rather than
  // the Pay button: a unit the company moved out of in April was still on the
  // account in March, and a March statement that dropped it would not add up to
  // the March row on the list this page was reached from.
  const account = (
    await portalAccountsFor(actor.tenantId, { includeEndedLeases: true })
  ).find((row) => row.id === accountId && row.payable)
  if (!account) notFound()

  const statements = await Promise.all(
    account.units.map((unit) =>
      leaseStatement({ leaseId: unit.leaseId, year: parsed.year, month: parsed.month }),
    ),
  )

  // Three columns, not five, and the middle one is the DIFFERENCE rather than
  // `totals.chargedCents` beside `totals.paidCents`. A statement's six totals
  // (charged, paid, credited, refunded, written off, adjusted) do not compose
  // into a start-plus-charges-minus-payments row: a month with a write-off or a
  // refund on it would print four figures that do not reach the fifth, on a
  // screen whose entire job is adding up. `reconciles` guarantees
  // opening + movement = closing and nothing else, so that is what is shown,
  // and the per-unit statement one click away carries the full split.
  const total = statements.reduce(
    (sum, statement) => ({
      opening: sum.opening + statement.openingBalanceCents,
      closing: sum.closing + statement.closingBalanceCents,
    }),
    { opening: 0, closing: 0 },
  )
  const label = statements[0]?.label ?? period
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/portal/statements" className="underline underline-offset-4">
          {t('sv.allStatements')}
        </Link>
      </p>

      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">
          {t('astmt.heading', { account: account.name, label })}
        </h1>
        <p className="text-muted-foreground text-sm">
          {plural(dict, account.units.length, 'astmt.unitsOne', 'astmt.unitsOther', {
            facility: account.facilityName,
          })}
        </p>
        <p className="text-muted-foreground text-sm">{SITE.name}</p>
      </header>

      {/* A real table with a row header per unit (1.3.1 A): "Unit 12" has to
          stay attached to its four figures when the row is read one cell at a
          time. `formatCents` throughout — a column of money is checked by
          eye, and a row reading "$129" beside one reading "$20.00" is harder
          to check than one where every figure carries its cents. */}
      <div className="border-input overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="px-4 pt-4 text-left font-medium">
            {t('astmt.caption', { account: account.name, label })}
          </caption>
          <thead>
            <tr className="text-left">
              <th scope="col" className="px-4 py-2 font-medium">
                {t('astmt.colUnit')}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t('astmt.colOwedStart')}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t('astmt.colChange')}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t('astmt.colOwedEnd')}
              </th>
            </tr>
          </thead>
          <tbody>
            {statements.map((statement) => (
              <tr key={statement.leaseId} className="border-t">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <Link
                    href={`/portal/statements/${statement.leaseId}/${statementPeriodSegment(statement.year, statement.month)}`}
                    className="underline underline-offset-4"
                  >
                    {t('dash.unitNumber', { unit: statement.unitNumber })}
                  </Link>
                  <span className="text-muted-foreground block text-xs">
                    {statement.tenantName}
                  </span>
                </th>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCents(statement.openingBalanceCents)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {movement(statement.openingBalanceCents, statement.closingBalanceCents, dict)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCents(statement.closingBalanceCents)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t">
              <th scope="row" className="px-4 py-2 pb-4 text-left font-medium">
                {t('astmt.allUnits')}
              </th>
              <td className="px-4 py-2 pb-4 text-right font-medium tabular-nums">
                {formatCents(total.opening)}
              </td>
              <td className="px-4 py-2 pb-4 text-right font-medium tabular-nums">
                {movement(total.opening, total.closing, dict)}
              </td>
              <td className="px-4 py-2 pb-4 text-right font-medium tabular-nums">
                {formatCents(total.closing)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-muted-foreground text-xs text-pretty">
        {t('astmt.note', { facility: account.facilityName })}
      </p>
    </div>
  )
}
