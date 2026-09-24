import Link from 'next/link'
import { DataTable } from '@/components/ui/data-table'
import { getAdminActor } from '@/lib/admin/context'
import { ledgerExceptionsFor } from '@/lib/admin/ledger'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { formatCents } from '@/lib/format'
import { ScrollRegion } from '@/components/ui/scroll-region'
import { AcknowledgeExceptionForm } from '@/components/admin/acknowledge-exception-form'
import { AnnounceRegion } from '@/components/admin/announce'
import { can } from '@/lib/rbac/authorize'

export const metadata = { title: 'Ledger exceptions' }

// PRD 02 US-24 (B-277). Leases whose ledger balance the invoices do not back.
//
// The delinquency engine cures on the ledger balance, so a lease on this list
// can be a tenant who has paid and is still overlocked and still on the
// ladder — and the lien-notice gate refuses it until the two agree, which is
// correct and is not changed here. The repair is a person's: an adjustment on
// that lease's ledger, or a corrected invoice.
//
// **B-303 built both.** From B-277 until then this sentence was a promise the
// product could not keep — every writer of `ledgerEntry.create` was an
// automated path and there was no staff form, so the only way to clear a row on
// this screen was a database client. The tenant's name links to the ledger, and
// the correction is posted from there.

export const dynamic = 'force-dynamic'

function signedCents(cents: number): string {
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents)
}

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

export default async function LedgerExceptionsPage() {
  const actor = await getAdminActor()

  if (!hasPermissionAnywhere(actor, ['reports:financial'])) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have access to financial reports.
      </p>
    )
  }

  const exceptions = await ledgerExceptionsFor(actor)
  const reviewed = exceptions.filter((row) => row.acknowledgement !== null).length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ledger exceptions</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Leases where the ledger balance is not what the invoices say is owed. The delinquency
          ladder reads the ledger, so a balance here that the invoices do not back keeps chasing a
          tenant, and no lien notice can be generated for the lease until the two agree. Checked as
          this page loaded; the hourly job raises a task at any facility with one.
        </p>
        <p className="text-muted-foreground mt-2 max-w-prose text-sm text-pretty">
          Open a tenant&apos;s ledger to post the correction. It needs manual-credit authority and
          the amount counts against your limit, and every correction is recorded with your name and
          a reason. Where a lease genuinely cannot be repaired, mark it reviewed: it stays on this
          list, and the daily task stops naming it until the difference changes.
        </p>
      </div>

      <nav aria-label="Related reports" className="flex flex-wrap gap-3">
        <Link
          href="/admin/reports/delinquency"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          Delinquency aging
        </Link>
        <Link
          href="/admin/reports"
          className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
        >
          All reports
        </Link>
      </nav>

      {/* B-333 / SC 4.1.3, 2.4.3. Acknowledging a row switches the cell's
          branch below — the form is replaced by "Reviewed by …" — so the
          `role="status"` inside `AdminForm` was unmounted in the same commit
          that wrote the message, and focus fell from the submit to `<body>`,
          at the top of a table of up to a facility's worth of rows. The
          region has to live where the row cannot take it: above the table. */}
      <AnnounceRegion>
      {exceptions.length === 0 ? (
        <p className="text-sm">
          Every lease at the facilities you can see reconciles to its invoices.
        </p>
      ) : (
        <ScrollRegion aria-label="Ledger exceptions">
          <DataTable className="min-w-4xl">
            <caption className="sr-only">
              Leases whose ledger balance disagrees with their invoices, largest difference first
              within each facility
              {reviewed > 0 ? `; ${reviewed} of ${exceptions.length} already reviewed` : ''}
            </caption>
            <DataTable.Head>
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Tenant
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Facility
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Unit
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Ledger balance
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Invoices outstanding
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Difference
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Likely cause
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Reviewed
                </th>
              </tr>
            </DataTable.Head>
            <tbody>
              {exceptions.map((row) => (
                <DataTable.Row key={row.leaseId} className="border-input border-b">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <Link
                      href={`/admin/tenants/${row.tenantId}/ledger/${row.leaseId}`}
                      className="underline underline-offset-2"
                    >
                      {row.tenantName}
                    </Link>
                  </th>
                  <td className="px-3 py-2">{row.facilityName}</td>
                  <td className="px-3 py-2">{row.unitNumber}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCents(row.ledgerBalanceCents)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCents(row.invoiceOutstandingCents)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {signedCents(row.reconciliation.differenceCents)}
                  </td>
                  <td className="px-3 py-2 text-pretty">{row.reconciliation.explanation}</td>
                  {/* B-304. Never hidden, and never colour alone (1.4.1): the
                      word "Reviewed" and the name carry it. The row stays
                      because the ledger still disagrees — this only stops the
                      daily task naming it. */}
                  <td className="px-3 py-2 text-pretty">
                    {row.acknowledgement ? (
                      <>
                        <span className="font-medium">Reviewed</span> by{' '}
                        {row.acknowledgement.by} on {formatWhen(row.acknowledgement.at)}
                        <span className="text-muted-foreground block text-xs">
                          {row.acknowledgement.note}
                        </span>
                      </>
                    ) : can(actor, 'credits:manual', row.facilityId) ? (
                      <AcknowledgeExceptionForm
                        leaseId={row.leaseId}
                        tenantName={row.tenantName}
                        unitNumber={row.unitNumber}
                      />
                    ) : (
                      <span className="text-muted-foreground">Not reviewed</span>
                    )}
                  </td>
                </DataTable.Row>
              ))}
            </tbody>
          </DataTable>
        </ScrollRegion>
      )}
      </AnnounceRegion>
    </div>
  )
}
