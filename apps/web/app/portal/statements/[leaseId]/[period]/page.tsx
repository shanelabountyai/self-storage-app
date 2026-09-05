import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenantActor } from '@/lib/rbac/session'
import { leaseStatement, tenantMayViewLease } from '@/lib/billing/statements'
import { StatementView } from '@/components/statement-view'
import { parseStatementPeriod } from '@/lib/billing/statement-period'
import { SITE } from '@/lib/site-config'

export const metadata: Metadata = { title: 'Statement' }

// PRD 01 US-705 (B-102). One lease, one month, for the tenant it belongs to.

export default async function StatementPage({
  params,
}: {
  params: Promise<{ leaseId: string; period: string }>
}) {
  const { leaseId, period } = await params
  const actor = await requireTenantActor()

  const parsed = parseStatementPeriod(period)
  if (!parsed) notFound()

  // Checked before anything is read. A statement is a full month of somebody's
  // financial history and the lease id is in the URL — an unscoped read here
  // would hand one tenant another's.
  if (!(await tenantMayViewLease(actor.tenantId, leaseId))) notFound()

  const statement = await leaseStatement({ leaseId, year: parsed.year, month: parsed.month })

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/portal/statements" className="underline underline-offset-4">
          ← All statements
        </Link>
      </p>

      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Statement — {statement.label}</h1>
        <p className="text-muted-foreground text-sm">
          Unit {statement.unitNumber} · {statement.facilityName}
        </p>
        <p className="text-muted-foreground text-sm">
          {statement.tenantName} · {SITE.name}
        </p>
      </header>

      <StatementView statement={statement} />

      <p className="text-muted-foreground text-xs text-pretty">
        Dates are shown in {statement.facilityName}&apos;s local time. Use your browser&apos;s print
        option to save or print this statement.
      </p>
    </div>
  )
}
