import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { paymentReceipt } from '@/lib/portal/payment'
import { formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'

export const metadata: Metadata = {
  title: 'Payment receipt',
  // A receipt keyed to one payment has no business in an index.
  robots: { index: false, follow: false },
}

// PRD 01 §4.7 US-703 — "instant receipt". Instant on screen; the emailed
// receipt (§4.8's payment-receipt row) is B-050's, along with the rest of the
// payment lifecycle notices.
//
// This screen reads our own Payment row, not Stripe. The webhook is what marks
// a payment succeeded (§7.3 — the ledger is the tenant-facing source of truth),
// and it can still be in flight when the browser lands here a second after
// confirming. So there are three real states, and the pending one says exactly
// that rather than claiming a payment that has not been recorded yet.

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export default async function PaymentDonePage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>
}) {
  const { payment: paymentId } = await searchParams
  const actor = await requireTenantActor()
  const receipt = paymentId ? await paymentReceipt(actor.tenantId, paymentId) : null

  if (!receipt) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Payment receipt</h1>
        <p className="text-sm text-pretty">We couldn&apos;t find that payment on your account.</p>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          Back to my account
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">
        {receipt.status === 'succeeded'
          ? 'Payment received'
          : receipt.status === 'failed'
            ? 'That payment didn’t go through'
            : receipt.status === 'processing'
              ? 'Bank payment on its way'
              : 'Payment sent'}
      </h1>

      {receipt.status === 'pending' && (
        <p role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
          Your bank has taken it. We&apos;re still confirming it on our side — your balance updates
          within a minute or two, and there&apos;s nothing else for you to do.
        </p>
      )}

      {/* B-103. A bank debit is a genuinely different wait: days, not minutes.
          Sharing the `pending` copy would tell somebody to expect their balance
          to move "within a minute or two" and then leave them watching it for
          four days. */}
      {receipt.status === 'processing' && (
        <p role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
          Your bank payment has been submitted. Bank payments take about four business days to
          clear — your balance updates when it arrives, and you won&apos;t be charged a late fee
          while it&apos;s on its way. There&apos;s nothing else for you to do.
        </p>
      )}

      {receipt.status === 'failed' && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900">
          {receipt.failureReason ?? 'The card was declined.'} Nothing has been charged. You can try
          another card, or call{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>
          .
        </p>
      )}

      <dl className="border-input flex flex-col gap-2 rounded-lg border p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Amount</dt>
          <dd className="font-medium tabular-nums">{formatRate(receipt.amountCents)}</dd>
        </div>
        {receipt.unitNumber && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Unit</dt>
            <dd>
              {receipt.facilityName} — {receipt.unitNumber}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Date</dt>
          <dd>{formatWhen(receipt.receivedAt)}</dd>
        </div>
        {receipt.status === 'succeeded' && receipt.balanceCents !== null && (
          <div className="flex justify-between gap-4 border-t pt-2 font-medium">
            <dt>Balance now</dt>
            <dd className="tabular-nums">{formatRate(Math.max(receipt.balanceCents, 0))}</dd>
          </div>
        )}
      </dl>

      <Link href="/portal" className="text-sm underline underline-offset-4">
        Back to my account
      </Link>
    </div>
  )
}
