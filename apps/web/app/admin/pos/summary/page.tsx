import Link from 'next/link'
import { prisma } from '@storage/db'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { dailyPaymentsSummary } from '@/lib/admin/pos'
import { formatCents } from '@/lib/format'

export const metadata = { title: 'Daily payments' }

// PRD 02 §4.8 US-32's daily summary, printable as a deposit slip.
//
// A read over `Payment` and nothing more — no drawer session, no float, no
// over/short. Those are B-078 (D-1), and building a "close-out" here that did
// not reconcile against a counted drawer would look like accountability
// without being it.

function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export default async function DailyPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">Daily payments</h1>
        <p className="text-muted-foreground text-sm">Choose a single facility in the switcher above.</p>
      </div>
    )
  }

  const facility = await facilityTimezone(selected.facility.id)
  const businessDate =
    date ?? new Intl.DateTimeFormat('en-CA', { timeZone: facility.timezone }).format(new Date())
  const summary = await dailyPaymentsSummary(actor, selected.facility.id, businessDate)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-lg font-semibold">Daily payments</h1>
        <Link href="/admin/pos" className="text-sm underline underline-offset-2">
          ← Back to POS
        </Link>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-2 print:hidden">
        <label htmlFor="date" className="flex flex-col gap-1 text-sm">
          Business day
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={businessDate}
            className="border-input bg-background h-9 rounded-md border px-2"
          />
        </label>
        <button
          type="submit"
          className="border-input hover:bg-accent inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
        >
          Show
        </button>
      </form>

      {/* The printable part. `print:hidden` above keeps the controls off the
          slip; everything below is what goes in the envelope with the bag. */}
      <section aria-labelledby="slip-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="slip-heading" className="font-medium">
            {summary.facilityName} — {summary.businessDate}
          </h2>
          <p className="text-muted-foreground text-sm">
            {summary.rows.length} payment{summary.rows.length === 1 ? '' : 's'} ·{' '}
            {formatCents(summary.totalCents)} total
          </p>
        </div>

        {summary.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No payments taken on this day.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <caption className="sr-only">Totals by payment method</caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-2 font-medium">Method</th>
                  <th scope="col" className="py-2 text-right font-medium">Count</th>
                  <th scope="col" className="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.totalsByMethod.map((total) => (
                  <tr key={total.method} className="border-b">
                    <td className="py-2 capitalize">{total.method.replace('_', ' ')}</td>
                    <td className="py-2 text-right tabular-nums">{total.count}</td>
                    <td className="py-2 text-right tabular-nums">{formatCents(total.totalCents)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2">All methods</td>
                  <td className="py-2 text-right tabular-nums">{summary.rows.length}</td>
                  <td className="py-2 text-right tabular-nums">{formatCents(summary.totalCents)}</td>
                </tr>
              </tbody>
            </table>

            <table className="w-full text-sm">
              <caption className="sr-only">
                Every payment taken on {summary.businessDate}, with who took it
              </caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-2 font-medium">Receipt</th>
                  <th scope="col" className="py-2 font-medium">Time</th>
                  <th scope="col" className="py-2 font-medium">Tenant</th>
                  <th scope="col" className="py-2 font-medium">Method</th>
                  <th scope="col" className="py-2 font-medium">Check #</th>
                  <th scope="col" className="py-2 font-medium">Taken by</th>
                  <th scope="col" className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row) => (
                  <tr key={row.paymentId} className="border-b">
                    <td className="py-2 tabular-nums">{row.receiptNumber ?? '—'}</td>
                    <td className="py-2">{formatTime(row.receivedAt, facility.timezone)}</td>
                    <td className="py-2">{row.tenantName}</td>
                    <td className="py-2 capitalize">{row.method.replace('_', ' ')}</td>
                    <td className="py-2">{row.checkNumber ?? '—'}</td>
                    {/* Blank for an online card payment, which had no one
                        behind a counter — not a missing attribution. */}
                    <td className="py-2">{row.staffName ?? 'Online'}</td>
                    <td className="py-2 text-right tabular-nums">{formatCents(row.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  )
}

async function facilityTimezone(facilityId: string): Promise<{ timezone: string }> {
  return prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { timezone: true },
  })
}
