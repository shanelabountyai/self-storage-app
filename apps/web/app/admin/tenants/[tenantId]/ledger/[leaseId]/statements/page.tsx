import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminActor } from '@/lib/admin/context'
import { staffStatementsForLease } from '@/lib/billing/statements'
import { statementPeriodSegment } from '@/lib/billing/statement-period'

export const metadata = { title: 'Statements' }

// PRD 01 US-705 (B-102), staff side. "Can you send me my March statement?" is
// a phone call, and answering it should not require impersonating the tenant.

export default async function StaffStatementsPage({
  params,
}: {
  params: Promise<{ tenantId: string; leaseId: string }>
}) {
  const { tenantId, leaseId } = await params
  const actor = await getAdminActor()

  const result = await staffStatementsForLease(actor, leaseId)
  if (!result || result.tenantId !== tenantId) notFound()

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <p className="text-sm">
        <Link
          href={`/admin/tenants/${tenantId}/ledger/${leaseId}`}
          className="underline underline-offset-2"
        >
          ← Ledger
        </Link>
      </p>

      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Statements</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          The same month-by-month document the tenant sees in their portal. Months with no activity
          are listed too — a gap in a numbered list reads as a missing document.
        </p>
      </header>

      {result.months.length === 0 ? (
        <p className="text-muted-foreground text-sm">This lease has no statement months yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {result.months.map((month) => (
            <li key={`${month.year}-${month.month}`}>
              <Link
                href={`/admin/tenants/${tenantId}/ledger/${leaseId}/statements/${statementPeriodSegment(month.year, month.month)}`}
                className="border-input hover:bg-accent flex min-h-11 items-center justify-between gap-2 rounded-lg border p-4 text-sm"
              >
                <span className="font-medium">{month.label}</span>
                <span className="text-muted-foreground">View</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
