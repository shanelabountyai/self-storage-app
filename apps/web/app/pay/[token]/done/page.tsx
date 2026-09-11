import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { formatCents, formatRate } from '@/lib/format'
import { ScrollRegion } from '@/components/ui/scroll-region'
import { dictionaryFor, LOCALE_TAG, translate, type Locale, type MessageKey } from '@/lib/i18n'
import { checkPayLink, payLinkLocale } from '@/lib/portal/pay-links'
import { paymentReceipt } from '@/lib/portal/payment'
import { SITE } from '@/lib/site-config'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  return {
    title: translate(dictionaryFor(await payLinkLocale(token)), 'rcpt.title'),
    // A receipt keyed to one payment has no business in an index.
    robots: { index: false, follow: false },
  }
}

// PRD 05 CN-4 (B-051). Where Stripe returns a tenant who paid through a link.
//
// The token is re-checked here rather than trusted from the redirect: this URL
// is where a browser lands after leaving our origin, and treating "you got here
// from Stripe" as authorisation would let anyone with a payment id read a
// receipt. `paymentReceipt` is scoped to the tenant on top of that, so both the
// link and the payment have to belong to the same person.
//
// B-283: in the tenant's language, the same as the pay screen before it.
export const dynamic = 'force-dynamic'

function formatWhen(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
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

  const locale = await payLinkLocale(token)
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(dict, key, vars)

  const receipt = paymentId ? await paymentReceipt(link.tenantId, paymentId) : null

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="bg-background focus:ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
      >
        {t('chrome.skipToMain')}
      </a>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8">
        {!receipt ? (
          <>
            <h1 className="text-xl font-semibold">{t('rcpt.title')}</h1>
            <p className="text-sm text-pretty">{t('plink.notFound')}</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">
              {receipt.status === 'succeeded'
                ? t('rcpt.received')
                : receipt.status === 'failed'
                  ? t('plink.failed')
                  : t('plink.confirming')}
            </h1>

            <dl className="border-input rounded-lg border p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt>{t('rcpt.amount')}</dt>
                <dd className="tabular-nums">{formatRate(receipt.amountCents)}</dd>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <dt>{t('paypg.colWhen')}</dt>
                <dd>{formatWhen(receipt.receivedAt, locale)}</dd>
              </div>
              {receipt.credits.length === 1 && (
                <div className="mt-2 flex justify-between gap-4">
                  <dt>{t('rcpt.unit')}</dt>
                  <dd>
                    {t('plink.unitValue', {
                      unit: receipt.credits[0].unitNumber,
                      facility: receipt.facilityName,
                    })}
                  </dd>
                </div>
              )}
              {receipt.balanceCents !== null && receipt.status === 'succeeded' && (
                <div className="mt-2 flex justify-between gap-4 border-t pt-2 font-medium">
                  <dt>{t('rcpt.balanceNow')}</dt>
                  <dd className="tabular-nums">{formatRate(receipt.balanceCents)}</dd>
                </div>
              )}
            </dl>

            {/* B-278. A link is minted for one lease, but the payment is
                allocated across every unit that owes, so it can settle several.
                Same table as the portal receipt. */}
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

            {receipt.status === 'pending' && (
              <p className="text-sm text-pretty">{t('plink.pendingBody')}</p>
            )}
            {receipt.status === 'failed' && (
              <p className="text-sm text-pretty">
                {receipt.failureReason ? t('plink.declined') : t('plink.notCompleted')}{' '}
                {t('plink.tryAgain', { phone: SITE.phone.display })}
              </p>
            )}
          </>
        )}

        <p className="text-muted-foreground text-sm text-pretty">
          {t('plink.fullHistory')}{' '}
          <a href="/login" className="underline underline-offset-4">
            {t('plink.signIn')}
          </a>
          .
        </p>
      </main>
    </div>
  )
}
