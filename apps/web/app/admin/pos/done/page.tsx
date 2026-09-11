import Link from 'next/link'
import { requireStaffActor } from '@/lib/rbac/session'
import { counterReceipt } from '@/lib/admin/pos'
import { formatCents } from '@/lib/format'
import { FocusedHeading, PrintButton } from '@/components/admin/receipt-controls'

export const metadata = {
  title: 'Receipt',
  robots: { index: false, follow: false },
}

// B-281. Where cash, check and money order land after the counter takes them —
// the paper half of the counter, which had a flash message and nothing to hand
// over. The card path has its own screen (`card/done`), which waits on a webhook
// this money never needs.
//
// Printed with the admin header and nav hidden (`print:hidden` on both) and the
// controls below hidden with them; what is left is text in a table.

const METHOD_LABEL = { cash: 'Cash', check: 'Check', money_order: 'Money order' } as const

function formatReceivedAt(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

const ROW_HEADER = 'py-2 pr-4 text-left align-top font-medium'
const CELL = 'py-2 text-right align-top tabular-nums'

export default async function CounterReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>
}) {
  const { payment: paymentId } = await searchParams
  const actor = await requireStaffActor()
  const receipt = paymentId ? await counterReceipt(actor, paymentId) : null

  if (!receipt) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Receipt</h1>
        <p className="text-sm text-pretty">
          We couldn&apos;t find that receipt. Check today&apos;s payments before taking the payment
          again — it may already be recorded.
        </p>
        <Link href="/admin/pos/summary" className="text-sm underline underline-offset-2">
          Today&apos;s payments
        </Link>
      </div>
    )
  }

  const paidBy = receipt.checkNumber
    ? `${METHOD_LABEL[receipt.method]} #${receipt.checkNumber}`
    : METHOD_LABEL[receipt.method]

  return (
    <div className="flex max-w-lg flex-col gap-6 print:max-w-none">
      <FocusedHeading className="text-lg font-semibold">
        Receipt #{receipt.receiptNumber}
      </FocusedHeading>

      {receipt.changeCents > 0 && (
        <p className="text-base font-medium print:hidden">
          Change due: {formatCents(receipt.changeCents)}
        </p>
      )}

      {/* A reprint of a check that later bounced must not read as money in hand. */}
      {receipt.status !== 'succeeded' && (
        <p role="note" className="border-input rounded-md border p-3 text-sm text-pretty">
          This payment was later marked {receipt.status.replace(/_/g, ' ')}.
        </p>
      )}

      <table className="w-full text-sm">
        <caption className="pb-2 text-left font-medium">
          {receipt.facilityName} — payment received
        </caption>
        <tbody>
          <tr className="border-b">
            <th scope="row" className={ROW_HEADER}>Received from</th>
            <td className="py-2 text-right align-top">{receipt.tenantName}</td>
          </tr>
          <tr className="border-b">
            <th scope="row" className={ROW_HEADER}>Date</th>
            <td className="py-2 text-right align-top">
              {formatReceivedAt(receipt.receivedAt, receipt.timezone)}
            </td>
          </tr>
          <tr className="border-b">
            <th scope="row" className={ROW_HEADER}>Paid by</th>
            <td className="py-2 text-right align-top">{paidBy}</td>
          </tr>
          {receipt.credits.map((credit) => (
            <tr key={credit.leaseId} className="border-b">
              <th scope="row" className={ROW_HEADER}>Unit {credit.unitNumber}</th>
              <td className={CELL}>{formatCents(credit.amountCents)}</td>
            </tr>
          ))}
          <tr className="border-b">
            <th scope="row" className={ROW_HEADER}>Amount paid</th>
            <td className={`${CELL} font-medium`}>{formatCents(receipt.amountCents)}</td>
          </tr>
          {receipt.tenderedCents !== null && (
            <>
              <tr className="border-b">
                <th scope="row" className={ROW_HEADER}>Cash tendered</th>
                <td className={CELL}>{formatCents(receipt.tenderedCents)}</td>
              </tr>
              <tr className="border-b">
                <th scope="row" className={ROW_HEADER}>Change</th>
                <td className={CELL}>{formatCents(receipt.changeCents)}</td>
              </tr>
            </>
          )}
          <tr className="border-b">
            <th scope="row" className={ROW_HEADER}>
              {receipt.balanceCents < 0 ? 'Credit on account' : 'Balance now'}
            </th>
            <td className={CELL}>{formatCents(Math.abs(receipt.balanceCents))}</td>
          </tr>
          {receipt.takenBy && (
            <tr>
              <th scope="row" className={ROW_HEADER}>Taken by</th>
              <td className="py-2 text-right align-top">{receipt.takenBy}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-4 text-sm print:hidden">
        <PrintButton />
        <Link href="/admin/pos" className="underline underline-offset-2">
          Back to POS
        </Link>
        <Link href="/admin/pos/summary" className="underline underline-offset-2">
          Today&apos;s payments
        </Link>
        <Link href={`/admin/tenants/${receipt.tenantId}`} className="underline underline-offset-2">
          {receipt.tenantName}&apos;s account
        </Link>
      </div>
    </div>
  )
}
