import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { formatRate } from '@/lib/format'
import { checkPayLink } from '@/lib/portal/pay-links'
import { paymentReceipt } from '@/lib/portal/payment'
import { SITE } from '@/lib/site-config'

export const metadata: Metadata = {
  title: 'Payment receipt',
  // A receipt keyed to one payment has no business in an index.
  robots: { index: false, follow: false },
}

// PRD 05 CN-4 (B-051). Where Stripe returns a tenant who paid through a link.
//
// The token is re-checked here rather than trusted from the redirect: this URL
// is where a browser lands after leaving our origin, and treating "you got here
// from Stripe" as authorisation would let anyone with a payment id read a
// receipt. `paymentReceipt` is scoped to the tenant on top of that, so both the
// link and the payment have to belong to the same person.
export const dynamic = 'force-dynamic'

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export default async function PayLinkDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ payment?: string }>
}) {
  const { token } = await params
  const { payment: paymentId } = await searchParams

  const link = await checkPayLink(token)
  if (!link.ok) redirect('/login?from=/portal&reason=pay_link_expired')

  const receipt = paymentId ? await paymentReceipt(link.tenantId, paymentId) : null

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="bg-background focus:ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
      >
        Skip to main content
      </a>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8">
        {!receipt ? (
          <>
            <h1 className="text-xl font-semibold">Payment receipt</h1>
            <p className="text-sm text-pretty">We couldn&apos;t find that payment.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">
              {receipt.status === 'succeeded'
                ? 'Payment received'
                : receipt.status === 'failed'
                  ? 'That payment did not go through'
                  : 'Payment received — still confirming'}
            </h1>

            <dl className="border-input rounded-lg border p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt>Amount</dt>
                <dd className="tabular-nums">{formatRate(receipt.amountCents)}</dd>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <dt>When</dt>
                <dd>{formatWhen(receipt.receivedAt)}</dd>
              </div>
              {receipt.unitNumber && (
                <div className="mt-2 flex justify-between gap-4">
                  <dt>Unit</dt>
                  <dd>
                    {receipt.unitNumber}
                    {receipt.facilityName ? ` — ${receipt.facilityName}` : ''}
                  </dd>
                </div>
              )}
              {receipt.balanceCents !== null && receipt.status === 'succeeded' && (
                <div className="mt-2 flex justify-between gap-4 border-t pt-2 font-medium">
                  <dt>Balance now</dt>
                  <dd className="tabular-nums">{formatRate(receipt.balanceCents)}</dd>
                </div>
              )}
            </dl>

            {receipt.status === 'pending' && (
              <p className="text-sm text-pretty">
                Your bank has taken the payment and we are waiting for final confirmation. Nothing
                further is needed from you — a receipt will follow by email.
              </p>
            )}
            {receipt.status === 'failed' && (
              <p className="text-sm text-pretty">
                {receipt.failureReason
                  ? 'Your bank declined the payment. That is usually a temporary block or a limit, not anything wrong with your account here.'
                  : 'The payment was not completed.'}{' '}
                You can try again on this page, or call {SITE.phone.display}.
              </p>
            )}
          </>
        )}

        <p className="text-muted-foreground text-sm text-pretty">
          To see your lease, gate code or full payment history,{' '}
          <a href="/login" className="underline underline-offset-4">
            sign in to your account
          </a>
          .
        </p>
      </main>
    </div>
  )
}
