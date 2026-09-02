import Link from 'next/link'
import { requireStaffActor } from '@/lib/rbac/session'
import { chargeableLease } from '@/lib/admin/pos'
import { paymentReceipt } from '@/lib/portal/payment'
import { formatCents } from '@/lib/format'

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
// cannot read a payment belonging to somebody else's lease.

export default async function CounterCardDonePage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string; lease?: string }>
}) {
  const { payment: paymentId, lease: leaseId } = await searchParams
  const actor = await requireStaffActor()

  const lease = leaseId ? await chargeableLease(actor, leaseId) : null
  const receipt = lease && paymentId ? await paymentReceipt(lease.tenantId, paymentId) : null

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
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">
        {receipt.status === 'succeeded'
          ? 'Payment taken'
          : receipt.status === 'failed'
            ? 'That card was declined'
            : 'Payment sent'}
      </h1>

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
          card, or take cash or a check.
        </p>
      )}

      <dl className="border-input flex flex-col gap-2 rounded-lg border p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Amount</dt>
          <dd className="font-medium tabular-nums">{formatCents(receipt.amountCents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Tenant</dt>
          <dd>
            {lease.tenantName} — unit {lease.unitNumber}
          </dd>
        </div>
        {receipt.status === 'succeeded' && receipt.balanceCents !== null && (
          <div className="flex justify-between gap-4 border-t pt-2 font-medium">
            <dt>Balance now</dt>
            <dd className="tabular-nums">{formatCents(Math.max(receipt.balanceCents, 0))}</dd>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/admin/pos" className="underline underline-offset-2">
          Back to POS
        </Link>
        <Link href="/admin/pos/summary" className="underline underline-offset-2">
          Today&apos;s payments
        </Link>
        <Link
          href={`/admin/tenants/${lease.tenantId}`}
          className="underline underline-offset-2"
        >
          {lease.tenantName}&apos;s account
        </Link>
      </div>
    </div>
  )
}
