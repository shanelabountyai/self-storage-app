import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { statementsForTenant } from '@/lib/billing/statements'
import { statementPeriodSegment } from '@/lib/billing/statement-period'
import { formatCents } from '@/lib/format'

export const metadata: Metadata = { title: 'Statements' }

// PRD 01 US-705 (B-102). "Monthly statements."
//
// Persona P5 is the reason this is its own screen rather than a filter on the
// receipts list: the small-business tenant "needs receipts/statements for
// bookkeeping", and what a bookkeeper wants is one row per month per unit, not
// a chronological list of individual payments they have to bucket themselves.

export default async function StatementsPage() {
  const actor = await requireTenantActor()
  const statements = await statementsForTenant(actor.tenantId)

  // Grouped by lease so a tenant with three units gets three lists rather than
  // one interleaved column where every month appears three times.
  const byLease = new Map<string, typeof statements>()
  for (const statement of statements) {
    byLease.set(statement.leaseId, [...(byLease.get(statement.leaseId) ?? []), statement])
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Statements</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          A month-by-month record for each unit: what you owed at the start, everything charged and
          paid, and what was left at the end.
        </p>
        <p className="text-sm">
          <Link href="/portal/documents" className="underline underline-offset-4">
            Individual receipts and your agreement
          </Link>
        </p>
      </header>

      {statements.length === 0 && (
        <p className="text-muted-foreground text-sm text-pretty">
          You don&apos;t have any statements yet. Your first one appears at the end of your first
          month.
        </p>
      )}

      {[...byLease.values()].map((group) => (
        <section
          key={group[0].leaseId}
          aria-labelledby={`lease-${group[0].leaseId}`}
          className="flex flex-col gap-3"
        >
          <h2 id={`lease-${group[0].leaseId}`} className="font-medium">
            Unit {group[0].unitNumber}
            <span className="text-muted-foreground font-normal"> · {group[0].facilityName}</span>
          </h2>

          <ul className="flex flex-col gap-2">
            {group.map((statement) => (
              <li key={`${statement.year}-${statement.month}`}>
                {/* B-232. The closing balance on the row. The list was a month
                    label and the word "View", so finding the month a charge
                    appeared in meant opening statements one at a time — and
                    "View" is the least useful link text a screen-reader user
                    can meet in a list of twelve identical ones (2.4.4), which
                    the accessible name now fixes as a side effect of being
                    useful to everybody. */}
                <Link
                  href={`/portal/statements/${statement.leaseId}/${statementPeriodSegment(statement.year, statement.month)}`}
                  className="border-input hover:bg-accent flex min-h-11 items-center justify-between gap-2 rounded-lg border p-4 text-sm"
                >
                  <span className="font-medium">{statement.label}</span>
                  <span
                    className={`tabular-nums ${statement.closingBalanceCents > 0 ? 'font-medium text-red-800' : 'text-muted-foreground'}`}
                  >
                    {statement.closingBalanceCents > 0
                      ? `${formatCents(statement.closingBalanceCents)} owed at month end`
                      : statement.closingBalanceCents < 0
                        ? `${formatCents(-statement.closingBalanceCents)} in credit at month end`
                        : 'Settled'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
