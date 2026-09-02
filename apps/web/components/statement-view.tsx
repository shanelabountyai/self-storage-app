import { formatCents } from '@/lib/format'
import type { LeaseStatement } from '@/lib/billing/statements'
import { ScrollRegion } from '@/components/ui/scroll-region'

// PRD 01 US-705 (B-102). The statement itself, rendered once and used by both
// the tenant portal and the admin.
//
// Shared deliberately rather than duplicated: staff answer "can you send me my
// March statement?" by looking at the same document the tenant is looking at,
// and two implementations of a financial summary is two chances for them to
// disagree in front of somebody's accountant.
//
// Semantic HTML, not a PDF — B-023's standing decision (see
// lib/documents/render.ts): no JavaScript PDF library available here emits
// TAGGED PDFs, and an untagged statement is the accessibility failure PRD 01
// §6.8.1 names explicitly. The browser's own print dialogue makes a paper copy.

const TYPE_LABELS: Record<string, string> = {
  charge: 'Charge',
  payment: 'Payment',
  credit: 'Credit',
  refund: 'Refund',
  adjustment: 'Adjustment',
  write_off: 'Written off',
}

function formatDay(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(date)
}

export function StatementView({ statement }: { statement: LeaseStatement }) {
  return (
    <>
      <dl className="border-input grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border p-4 text-sm">
        <dt>Balance at the start of {statement.label}</dt>
        <dd className="text-right font-medium">{formatCents(statement.openingBalanceCents)}</dd>
        <dt>Charged this month</dt>
        <dd className="text-right">{formatCents(statement.totals.chargedCents)}</dd>
        <dt>Paid this month</dt>
        <dd className="text-right">{formatCents(statement.totals.paidCents)}</dd>
        {statement.totals.creditedCents !== 0 && (
          <>
            <dt>Credits</dt>
            <dd className="text-right">{formatCents(statement.totals.creditedCents)}</dd>
          </>
        )}
        {statement.totals.refundedCents !== 0 && (
          <>
            <dt>Refunded to you</dt>
            <dd className="text-right">{formatCents(statement.totals.refundedCents)}</dd>
          </>
        )}
        {statement.totals.writtenOffCents !== 0 && (
          <>
            <dt>Written off</dt>
            <dd className="text-right">{formatCents(statement.totals.writtenOffCents)}</dd>
          </>
        )}
        <dt className="font-medium">Balance at the end of {statement.label}</dt>
        <dd className="text-right font-medium">{formatCents(statement.closingBalanceCents)}</dd>
      </dl>

      <section aria-labelledby="lines-heading" className="flex flex-col gap-3">
        <h2 id="lines-heading" className="font-medium">
          Everything in this month
        </h2>

        {statement.lines.length === 0 ? (
          // Said out loud rather than rendering an empty table. A month with no
          // activity is a legitimate answer for a bookkeeper, and a blank space
          // reads as a page that failed to load.
          <p className="text-muted-foreground text-sm text-pretty">
            Nothing was charged or paid on this unit in {statement.label}.
          </p>
        ) : (
          <ScrollRegion aria-label="Statement">
            <table className="w-full min-w-lg text-left text-sm">
              <caption className="sr-only">
                Charges and payments for unit {statement.unitNumber} in {statement.label}
              </caption>
              <thead>
                <tr className="border-input border-b">
                  <th scope="col" className="py-2 pr-4 font-medium">Date</th>
                  <th scope="col" className="py-2 pr-4 font-medium">What it was</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Type</th>
                  <th scope="col" className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((line, index) => (
                  <tr key={`${line.occurredAt.getTime()}-${index}`} className="border-input border-b">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {formatDay(line.occurredAt, statement.facilityTimezone)}
                    </td>
                    <td className="py-2 pr-4">{line.description}</td>
                    <td className="text-muted-foreground py-2 pr-4">
                      {TYPE_LABELS[line.type] ?? line.type}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {/* Signed as the ledger stores it, so the column adds up
                          to the movement between the two balances above. A
                          column of unsigned numbers would look tidier and would
                          not reconcile, which is the one thing a statement has
                          to do. */}
                      {formatCents(line.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

    </>
  )
}
