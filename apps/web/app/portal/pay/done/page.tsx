import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { paymentReceipt } from '@/lib/portal/payment'
import { formatCents, formatRate } from '@/lib/format'
import { ScrollRegion } from '@/components/ui/scroll-region'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, LOCALE_TAG, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: translate(dictionaryFor(await getLocale()), 'rcpt.title'),
    // A receipt keyed to one payment has no business in an index.
    robots: { index: false, follow: false },
  }
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

function formatWhen(date: Date, tag: string): string {
  return new Intl.DateTimeFormat(tag, {
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
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  if (!receipt) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t('rcpt.title')}</h1>
        <p className="text-sm text-pretty">{t('rcpt.notFound')}</p>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          {t('paypg.backToAccount')}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">
        {receipt.status === 'succeeded'
          ? t('rcpt.received')
          : receipt.status === 'failed'
            ? t('rcpt.failed')
            : receipt.status === 'processing'
              ? t('rcpt.processing')
              : t('rcpt.sent')}
      </h1>

      {receipt.status === 'pending' && (
        <p role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
          {t('rcpt.pendingBody')}
        </p>
      )}

      {/* B-103. A bank debit is a genuinely different wait: days, not minutes.
          Sharing the `pending` copy would tell somebody to expect their balance
          to move "within a minute or two" and then leave them watching it for
          four days. */}
      {receipt.status === 'processing' && (
        <p role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
          {t('rcpt.processingBody')}
        </p>
      )}

      {receipt.status === 'failed' && (
        /* B-295: no `role="alert"`. The receipt is loaded already failed; the
           decline happened before this document existed, so nothing here just
           changed (B-245). The Stripe decline mirror in `portal-payment.tsx`
           keeps its alert — that one fills after a press and takes focus. */
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900">
          {/* B-260: Stripe's own decline reason is passed through as it
              arrives — it is the processor's message about this card, not our
              copy, and the Element that produced it is already localised. */}
          {receipt.failureReason ?? t('rcpt.cardDeclined')} {t('rcpt.failedAfter')}{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>
          .
        </p>
      )}

      <dl className="border-input flex flex-col gap-2 rounded-lg border p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{t('rcpt.amount')}</dt>
          <dd className="font-medium tabular-nums">{formatRate(receipt.amountCents)}</dd>
        </div>
        {receipt.credits.length === 1 && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('rcpt.unit')}</dt>
            <dd>
              {t('rcpt.unitValue', {
                facility: receipt.facilityName,
                unit: receipt.credits[0].unitNumber,
              })}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{t('rcpt.date')}</dt>
          <dd>{formatWhen(receipt.receivedAt, LOCALE_TAG[locale])}</dd>
        </div>
        {receipt.status === 'succeeded' && receipt.balanceCents !== null && (
          <div className="flex justify-between gap-4 border-t pt-2 font-medium">
            <dt>{t('rcpt.balanceNow')}</dt>
            <dd className="tabular-nums">{formatRate(Math.max(receipt.balanceCents, 0))}</dd>
          </div>
        )}
      </dl>

      {/* B-278. A payment that settled several units says what each one got.
          A real table (1.3.1) with the total in its own row, so the parts and
          the sum are related in markup rather than only by position. */}
      {receipt.credits.length > 1 && (
        <ScrollRegion
          aria-label={t('rcpt.creditsCaption', { facility: receipt.facilityName })}
          className="border-input rounded-lg border"
        >
          <table className="w-full text-sm">
            <caption className="px-4 pt-4 text-left font-medium">
              {t('rcpt.creditsCaption', { facility: receipt.facilityName })}
            </caption>
            <thead>
              <tr className="text-left">
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('rcpt.unit')}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t('rcpt.amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {receipt.credits.map((credit) => (
                <tr key={credit.leaseId} className="border-t">
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    {credit.unitNumber}
                  </th>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatCents(credit.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <th scope="row" className="px-4 py-2 text-left">
                  {t('rcpt.total')}
                </th>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCents(receipt.credits.reduce((sum, credit) => sum + credit.amountCents, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </ScrollRegion>
      )}

      <Link href="/portal" className="text-sm underline underline-offset-4">
        {t('paypg.backToAccount')}
      </Link>
    </div>
  )
}
