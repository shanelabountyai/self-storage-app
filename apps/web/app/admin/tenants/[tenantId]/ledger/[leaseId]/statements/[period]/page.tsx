import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminActor } from '@/lib/admin/context'
import { leaseStatement, staffStatementsForLease } from '@/lib/billing/statements'
import { parseStatementPeriod } from '@/lib/billing/statement-period'
import { StatementView } from '@/components/statement-view'

export const metadata = { title: 'Statement' }

export default async function StaffStatementPage({
  params,
}: {
  params: Promise<{ tenantId: string; leaseId: string; period: string }>
}) {
  const { tenantId, leaseId, period } = await params
  const actor = await getAdminActor()

  const parsed = parseStatementPeriod(period)
  if (!parsed) notFound()

  // Same gate as the ledger, checked before the statement is built: this is the
  // same money seen a different way, and a different URL must not be a way
  // around the ledger's own facility scoping.
  const allowed = await staffStatementsForLease(actor, leaseId)
  if (!allowed || allowed.tenantId !== tenantId) notFound()

  const statement = await leaseStatement({ leaseId, year: parsed.year, month: parsed.month })

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm">
        <Link
          href={`/admin/tenants/${tenantId}/ledger/${leaseId}/statements`}
          className="underline underline-offset-2"
        >
          ← All statements
        </Link>
      </p>

      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Statement — {statement.label}</h1>
        <p className="text-muted-foreground text-sm">
          {statement.tenantName} · Unit {statement.unitNumber} · {statement.facilityName}
        </p>
      </header>

      <StatementView statement={statement} />
    </div>
  )
}
