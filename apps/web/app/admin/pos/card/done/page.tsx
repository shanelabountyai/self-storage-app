import Link from 'next/link'
import { requireStaffActor } from '@/lib/rbac/session'
import { chargeableAccount, chargeableLease, counterReceipt } from '@/lib/admin/pos'
import { paymentReceipt } from '@/lib/portal/payment'
import { formatCents } from '@/lib/format'
import { CounterReceiptTable } from '@/components/admin/counter-receipt-table'
import { FocusedHeading, PrintButton } from '@/components/admin/receipt-controls'

export const metadata = {
  title: 'Card payment',
  robots: { index: false, follow: false },
}

// B-230. Where the Payment Element lands after a card taken at the counter.
//
// Reads our own `Payment` row rather than asking Stripe, the same as the
// tenant's own receipt does and for the same reason (§7.3): the webhook is
// what marks a payment succeeded, and a screen that read Stripe directly would
// show a staffer a settled payment the ledger still disagrees with.
//
// `chargeableLease` is what authorises this — it checks `payments:take` at the
// LEASE's facility — and it is also where the tenant id comes from, so
// `paymentReceipt`'s own tenant scoping still holds and a payment id in a URL
// cannot read a payment belonging to somebody else's lease. For a business
// account (B-320) the same holds through `chargeableAccount`, whose tenant is
// the payer the card was charged to.
//
// B-320. Once the webhook has settled it, the receipt is the cash receipt's
// table and Print control, read by the same `counterReceipt` from the same
// `paymentCredits` — never a second rendering of the same money.

export default async function CounterCardDonePage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string; lease?: string; account?: string }>
}) {
  const { payment: paymentId, lease: leaseId, account: accountId } = await searchParams
  const actor = await requireStaffActor()

  const lease = accountId
    ? await chargeableAccount(actor, accountId)
    : leaseId
      ? await chargeableLease(actor, leaseId)
      : null
  const receipt = lease && paymentId ? await paymentReceipt(lease.tenantId, paymentId) : null
  const printable =
    receipt?.status === 'succeeded' && paymentId ? await counterReceipt(actor, paymentId) : null

  if (!lease || !receipt) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Card payment</h1>
        <p className="text-sm text-pretty">
          We couldn&apos;t find that payment. Check today&apos;s payments before taking it again —
          it may already be recorded.
        </p>
        <Link href="/admin/pos/summary" className="text-sm underline underline-offset-2">
          Today&apos;s payments
        </Link>
      </div>
    )
  }

  return (
    <div className="flex max-w-lg flex-col gap-6 print:max-w-none">
      {/* Focus follows the outcome here as it does on the cash receipt (2.4.3):
          the Element's Pay button that had it was on the page this replaced. */}
      <FocusedHeading className="text-lg font-semibold">
        {receipt.status === 'succeeded'
          ? 'Payment taken'
          : receipt.status === 'failed'
            ? 'That card was declined'
            : 'Payment sent'}
      </FocusedHeading>

      {/* `role="status"` and `role="alert"` rather than plain paragraphs: this
          page is reached by a client-side navigation from the Element, so the
          outcome is a mutation a screen reader is otherwise never told about
          (4.1.3). */}
      {(receipt.status === 'pending' || receipt.status === 'processing') && (
        <p role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
          Taken by the card network. We are still confirming it here — the balance and the gate
          update within a minute or two. Do not take it again.
        </p>
      )}

      {receipt.status === 'failed' && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900"
        >
          {receipt.failureReason ?? 'The card was declined.'} Nothing has been charged. Try another
          card, or take cash or a check.{' '}
          {/* B-344. Back to the same subject and amount, so a retry is one
              click rather than finding the tenant again (SC 2.4.4). */}
          <Link
            href={`/admin/pos/card?${lease.accountId ? `account=${encodeURIComponent(lease.accountId)}` : `lease=${encodeURIComponent(lease.leaseId)}`}&amount=${(receipt.amountCents / 100).toFixed(2)}`}
            className="font-medium underline underline-offset-2"
          >
            Try another card for {formatCents(receipt.amountCents)}
          </Link>
        </p>
      )}

      {printable ? (
        <CounterReceiptTable receipt={printable} />
      ) : (
        <dl className="border-input flex flex-col gap-2 rounded-lg border p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-medium tabular-nums">{formatCents(receipt.amountCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{lease.accountId ? 'Payer' : 'Tenant'}</dt>
            <dd>
              {lease.tenantName} — {lease.subject}
            </dd>
          </div>
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm print:hidden">
        {printable && <PrintButton />}
        <Link href="/admin/pos" className="underline underline-offset-2">
          Back to POS
        </Link>
        <Link href="/admin/pos/summary" className="underline underline-offset-2">
          Today&apos;s payments
        </Link>
        {lease.accountId ? (
          <Link
            href={`/admin/billing/accounts/${lease.accountId}`}
            className="underline underline-offset-2"
          >
            {lease.accountName} account
          </Link>
        ) : (
          <Link href={`/admin/tenants/${lease.tenantId}`} className="underline underline-offset-2">
            {lease.tenantName}&apos;s account
          </Link>
        )}
      </div>
    </div>
  )
}
