import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { PortalPayment } from '@/components/portal/portal-payment'
import { formatCents, formatRate } from '@/lib/format'
import { dictionaryFor, translate, type Locale, type MessageKey } from '@/lib/i18n'
import { attributePayment, checkPayLink, payLinkLocale } from '@/lib/portal/pay-links'
import {
  AMOUNT_PROBLEM_KEYS,
  MIN_PAYMENT_CENTS,
  payableLease,
  startPortalPayment,
  validatePaymentAmount,
} from '@/lib/portal/payment'
import { SITE } from '@/lib/site-config'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  return { title: translate(dictionaryFor(await payLinkLocale(token)), 'paypg.title') }
}

// PRD 05 CN-4 (B-051). The one-tap pay screen a reminder links to.
//
// Outside `/portal` on purpose — see the note at the top of lib/portal/
// pay-links.ts. This route grants access to this screen and nothing else: no
// gate code, no other unit, no contact details, no way to remove a card. The
// middleware matcher covers `/admin/*` and `/portal/*` and deliberately not
// this, because there is no session here to check.
//
// `force-dynamic` matters more than usual: this page renders a balance and a
// PaymentIntent, and a cached copy would show one tenant's figures to the next
// visitor. (Next 16's route-handler caching bit this project once already —
// see B-014's note.)
export const dynamic = 'force-dynamic'

// B-283. In the language of the tenant the link was minted for — the reminder
// that carried it was written in that language — and with no toggle, because
// the answer comes from the record rather than from the visitor.
//
// B-225: `above_prepay_ceiling` is unreachable here. A pay link is raised for a
// SPECIFIC balance and sent to somebody who may not be the tenant, so it passes
// no prepayment ceiling and keeps the blanket "more than you owe" refusal.

export default async function PayLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ amount?: string }>
}) {
  const { token } = await params
  const { amount } = await searchParams

  const link = await checkPayLink(token)
  if (!link.ok) {
    // CN-4: "an expired link lands on the portal login with the payment screen
    // as post-login destination — never a dead end." Expired, revoked and
    // never-existed all land in the same place, so nothing can be enumerated.
    redirect('/login?from=/portal&reason=pay_link_expired')
  }

  const lease = await payableLease(link.tenantId, link.leaseId)
  if (!lease) redirect('/login?from=/portal&reason=pay_link_expired')

  const locale = await payLinkLocale(token)
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(dict, key, vars)

  const phone = lease.facilityPhone ?? SITE.phone.display

  if (lease.balanceCents <= 0) {
    // CN-4's "balance as of page load, not as of send". A tenant who paid at
    // the counter this morning must not be shown a bill from Tuesday.
    return (
      <Shell locale={locale}>
        <h1 className="text-xl font-semibold">{t('plink.nothingToPay')}</h1>
        <p className="text-sm text-pretty">
          {t('plink.paidUp', { unit: lease.unitNumber, facility: lease.facilityName })}
        </p>
        <p className="text-muted-foreground text-sm text-pretty">
          {t('chrome.questionsCall')} {phone}.
        </p>
      </Shell>
    )
  }

  const requested = amount ?? String(lease.balanceCents / 100)
  const checked = validatePaymentAmount(requested, lease.balanceCents)
  const amountCents = checked.ok ? checked.amountCents : lease.balanceCents
  const setup = await startPortalPayment(link.tenantId, lease, amountCents)

  // CN-4's attribution, recorded when the attempt is raised rather than when it
  // succeeds: "this link produced an attempt" and "this link produced money"
  // are different questions and PRD 05 §7 wants both.
  if (setup.available) await attributePayment(link.payLinkId, setup.paymentId)

  return (
    <Shell locale={locale}>
      <div>
        <h1 className="text-xl font-semibold">{t('paypg.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('paypg.subheadUnit', { facility: lease.facilityName, unit: lease.unitNumber })}
        </p>
      </div>

      {/* 3.3.4: what is being charged, stated before the control that charges it. */}
      <dl className="border-input rounded-lg border p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt>{t('plink.balanceToday')}</dt>
          <dd className="tabular-nums">{formatRate(lease.balanceCents)}</dd>
        </div>
        <div className="mt-2 flex justify-between gap-4 border-t pt-2 text-base font-medium">
          <dt>{t('plink.payingNow')}</dt>
          <dd className="tabular-nums">{formatRate(amountCents)}</dd>
        </div>
      </dl>

      {!checked.ok && checked.problem !== 'nothing_owed' && (
        <p role="alert" className="border-input rounded-md border p-3 text-sm text-pretty">
          {t(AMOUNT_PROBLEM_KEYS[checked.problem], { min: formatCents(MIN_PAYMENT_CENTS) })}{' '}
          {t('paypg.balanceRestored')}
        </p>
      )}

      <details className="border-input rounded-lg border p-4" open={Boolean(amount) && !checked.ok}>
        <summary className="cursor-pointer text-sm font-medium">{t('paypg.payDifferent')}</summary>
        {/* GET, so this still works with JavaScript off (§6.2). */}
        <form method="GET" className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('amtform.label')}
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={(amountCents / 100).toFixed(2)}
              className="border-input bg-background h-9 rounded-md border px-2"
            />
          </label>
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
          >
            {t('amtform.update')}
          </button>
        </form>
      </details>

      <section aria-labelledby="card-heading">
        <h2 id="card-heading" className="font-medium">
          {t('paypg.cardDetails')}
        </h2>
        {setup.available ? (
          <PortalPayment
            clientSecret={setup.clientSecret}
            customerSessionSecret={setup.customerSessionSecret}
            returnUrl={`${process.env.AUTH_URL ?? 'http://localhost:3000'}/pay/${token}/done?payment=${setup.paymentId}`}
            amountLabel={formatRate(amountCents)}
          />
        ) : (
          <p className="border-input mt-3 rounded-lg border p-4 text-sm text-pretty">
            {t('paypg.callInstead')}{' '}
            <a href={`tel:${phone.replace(/[^0-9+]/g, '')}`} className="font-medium underline underline-offset-4">
              {phone}
            </a>{' '}
            {t('paypg.callInsteadAfter')}
          </p>
        )}
      </section>

      <p className="text-muted-foreground text-sm text-pretty">
        {t('plink.onlyThisScreen')}{' '}
        <a href="/login" className="underline underline-offset-4">
          {t('plink.signIn')}
        </a>
        .
      </p>
    </Shell>
  )
}

/// A standalone shell: this page is outside the portal layout, so it carries
/// its own skip link and landmark rather than inheriting one — and its own
/// `LocaleProvider`, without which the Payment Element and its button (client
/// components) fall back to English under a Spanish page.
function Shell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const dict = dictionaryFor(locale)
  return (
    <LocaleProvider locale={locale} dict={dict}>
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="bg-background focus:ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
      >
        {translate(dict, 'chrome.skipToMain')}
      </a>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8">
        {children}
      </main>
    </div>
    </LocaleProvider>
  )
}
