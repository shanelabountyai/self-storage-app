import Link from 'next/link'
import { requireStaffActor } from '@/lib/rbac/session'
import { counterReceipt, PAYMENT_STATUS_LABEL } from '@/lib/admin/pos'
import { formatCents } from '@/lib/format'
import { CounterReceiptTable } from '@/components/admin/counter-receipt-table'
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
          This payment was later marked {PAYMENT_STATUS_LABEL[receipt.status]}.
        </p>
      )}

      <CounterReceiptTable receipt={receipt} />

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
