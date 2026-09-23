import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminActor } from '@/lib/admin/context'
import { leaseLedger } from '@/lib/admin/ledger'
import { formatCents } from '@/lib/format'
import { ScrollRegion } from '@/components/ui/scroll-region'
import { LedgerCorrections } from '@/components/admin/ledger-corrections'

export const metadata = { title: 'Tenant ledger' }

// PRD 02 US-24 (B-049). One chronological ledger per lease.
//
// Every charge, tax, payment, credit, refund and write-off, in the order it
// happened, with the running balance down the right. Not one figure is computed
// here — the running balance, the totals and the reconciliation all come from
// @storage/core/billing (the same rule D-25 set for metrics).

const KIND_LABELS: Record<string, string> = {
  charge: 'Charge',
  payment: 'Payment',
  credit: 'Credit',
  refund: 'Refund',
  adjustment: 'Adjustment',
  write_off: 'Write-off',
}

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

export default async function LedgerPage({
  params,
}: {
  params: Promise<{ tenantId: string; leaseId: string }>
}) {
  const { tenantId, leaseId } = await params
  const actor = await getAdminActor()
  const ledger = await leaseLedger(actor, leaseId)
  if (!ledger || ledger.tenantId !== tenantId) notFound()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">
            Ledger — unit {ledger.unitNumber}, {ledger.facilityName}
          </h1>
          <p className="text-muted-foreground text-sm">{ledger.tenantName}</p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link
            href={`/admin/tenants/${tenantId}/ledger/${leaseId}/ledger.csv`}
            className="underline underline-offset-2"
          >
            Export CSV
          </Link>
          <Link
            href={`/admin/tenants/${tenantId}/ledger/${leaseId}/statements`}
            className="underline underline-offset-2"
          >
            Monthly statements
          </Link>
          <Link href={`/admin/tenants/${tenantId}`} className="underline underline-offset-2">
            Back to tenant
          </Link>
        </div>
      </div>

      {/* US-24's AC, on the screen rather than in a document. A discrepancy is
          stated plainly with its cause, because a manager who sees one needs to
          know whether it is expected before they ring anyone. Never colour
          alone (1.4.1) — the heading word carries it. */}
      <section
        aria-labelledby="reconcile-heading"
        className={
          ledger.reconciliation.reconciles
            ? 'border-input rounded-lg border p-4'
            : 'rounded-lg border-2 border-warning-border bg-warning-bg p-4 text-warning-fg'
        }
      >
        <h2 id="reconcile-heading" className="text-sm font-medium">
          {ledger.reconciliation.reconciles ? 'Reconciled' : 'Does not reconcile'}
        </h2>
        <p className="mt-1 text-sm text-pretty">{ledger.reconciliation.explanation}</p>
        {!ledger.reconciliation.reconciles && (
          <p className="mt-1 text-sm tabular-nums">
            Difference: {formatCents(ledger.reconciliation.differenceCents)}
          </p>
        )}
        {/* B-303. Until this, the answer to "so what do I do about it" was a
            database client: the exception report named the remedy and nothing
            in the product could carry it out. */}
        {!ledger.reconciliation.reconciles && !ledger.canCorrect && (
          <p className="mt-1 text-sm text-pretty">
            Correcting this needs manual-credit authority. Ask a manager.
          </p>
        )}
      </section>

      {ledger.canCorrect && (
        <section
          aria-labelledby="corrections-heading"
          className="border-input flex flex-col gap-3 rounded-lg border p-4"
        >
          <h2 id="corrections-heading" className="text-sm font-medium">
            Corrections
          </h2>
          <LedgerCorrections
            tenantId={tenantId}
            leaseId={leaseId}
            unitLabel={`unit ${ledger.unitNumber}`}
            differenceCents={ledger.reconciliation.differenceCents}
            balanceCents={ledger.totals.balanceCents}
            balance={formatCents(ledger.totals.balanceCents)}
            difference={formatCents(ledger.reconciliation.differenceCents)}
            voidableInvoices={ledger.voidableInvoices.map((invoice) => ({
              id: invoice.id,
              number: invoice.number,
              outstanding: formatCents(invoice.outstandingCents),
              period: formatWhen(invoice.periodStart),
              rebill: invoice.rebillCents === null ? null : formatCents(invoice.rebillCents),
              rebillIsSame: invoice.rebillCents === invoice.outstandingCents,
            }))}
          />
        </section>
      )}

      <section aria-labelledby="totals-heading">
        <h2 id="totals-heading" className="sr-only">
          Totals
        </h2>
        <dl className="border-input grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-3">
          <div className="flex justify-between gap-4">
            <dt>Charged</dt>
            <dd className="tabular-nums">{formatCents(ledger.totals.chargedCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Paid</dt>
            <dd className="tabular-nums">{formatCents(ledger.totals.paidCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Credited</dt>
            <dd className="tabular-nums">{formatCents(ledger.totals.creditedCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Refunded</dt>
            <dd className="tabular-nums">{formatCents(ledger.totals.refundedCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Written off</dt>
            <dd className="tabular-nums">{formatCents(ledger.totals.writtenOffCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 font-medium">
            <dt>Balance</dt>
            <dd className="tabular-nums">{formatCents(ledger.totals.balanceCents)}</dd>
          </div>
        </dl>
      </section>

      {ledger.lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing has been posted to this lease yet.</p>
      ) : (
        <ScrollRegion aria-label="Lease ledger">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Every entry on this lease in date order, with the running balance
            </caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 font-medium">Date</th>
                <th scope="col" className="py-2 font-medium">Type</th>
                <th scope="col" className="py-2 font-medium">Description</th>
                <th scope="col" className="py-2 font-medium">Invoice</th>
                <th scope="col" className="py-2 text-right font-medium">Amount</th>
                <th scope="col" className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.lines.map((line) => (
                <tr key={line.id} className="border-b">
                  <td className="py-2 whitespace-nowrap">{formatWhen(line.occurredAt)}</td>
                  <td className="py-2">{KIND_LABELS[line.kind] ?? line.kind}</td>
                  <td className="py-2">{line.description}</td>
                  <td className="py-2 tabular-nums">{line.invoiceNumber ?? '—'}</td>
                  <td className="py-2 text-right tabular-nums">{formatCents(line.amountCents)}</td>
                  <td className="py-2 text-right tabular-nums">{formatCents(line.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </div>
  )
}
