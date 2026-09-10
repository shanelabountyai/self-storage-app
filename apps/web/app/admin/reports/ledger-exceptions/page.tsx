import Link from 'next/link'
import { getAdminActor } from '@/lib/admin/context'
import { ledgerExceptionsFor } from '@/lib/admin/ledger'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { formatCents } from '@/lib/format'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Ledger exceptions' }

// PRD 02 US-24 (B-277). Leases whose ledger balance the invoices do not back.
//
// The delinquency engine cures on the ledger balance, so a lease on this list
// can be a tenant who has paid and is still overlocked and still on the
// ladder — and the lien-notice gate refuses it until the two agree, which is
// correct and is not changed here. The repair is a person's: an adjustment on
// that lease's ledger, or a corrected invoice. This screen only finds them.

export const dynamic = 'force-dynamic'

function signedCents(cents: number): string {
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents)
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Ledger exceptions</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Leases where the ledger balance is not what the invoices say is owed. The delinquency
          ladder reads the ledger, so a balance here that the invoices do not back keeps chasing a
          tenant, and no lien notice can be generated for the lease until the two agree. Checked as
          this page loaded; the hourly job raises a task at any facility with one.
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

      {exceptions.length === 0 ? (
        <p className="text-sm">
          Every lease at the facilities you can see reconciles to its invoices.
        </p>
      ) : (
        <ScrollRegion aria-label="Ledger exceptions">
          <table className="w-full min-w-4xl border-collapse text-sm">
            <caption className="sr-only">
              Leases whose ledger balance disagrees with their invoices, largest difference first
              within each facility
            </caption>
            <thead>
              <tr className="border-input border-b text-left">
                <th scope="col" className="py-2 pr-4">
                  Tenant
                </th>
                <th scope="col" className="py-2 pr-4">
                  Facility
                </th>
                <th scope="col" className="py-2 pr-4">
                  Unit
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Ledger balance
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Invoices outstanding
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Difference
                </th>
                <th scope="col" className="py-2 pr-4">
                  Likely cause
                </th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((row) => (
                <tr key={row.leaseId} className="border-input border-b">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">
                    <Link
                      href={`/admin/tenants/${row.tenantId}/ledger/${row.leaseId}`}
                      className="underline underline-offset-2"
                    >
                      {row.tenantName}
                    </Link>
                  </th>
                  <td className="py-2 pr-4">{row.facilityName}</td>
                  <td className="py-2 pr-4">{row.unitNumber}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(row.ledgerBalanceCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatCents(row.invoiceOutstandingCents)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {signedCents(row.reconciliation.differenceCents)}
                  </td>
                  <td className="py-2 pr-4 text-pretty">{row.reconciliation.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </div>
  )
}
