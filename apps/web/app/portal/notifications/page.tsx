import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminForm } from '@/components/admin/form'
import { requireTenantActor } from '@/lib/rbac/session'
import { currentPreferences, NOTIFICATION_CATEGORIES, smsConsentView } from '@/lib/portal/notifications'
import { MARKETING_SMS_DISCLOSURE } from '@/lib/checkout/details'
import { revokeSmsAction, setMarketingSmsAction, setPreferencesAction } from './actions'
import { ScrollRegion } from '@/components/ui/scroll-region'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await getLocale()), 'notif.title') }
}

// PRD 05 CN-13 (B-074). "As Tara, I control my channels in the portal."
//
// Three categories, two channels — the exact grid the AC names. Legally
// significant mail (delinquency stages, lien supplements, rate increases) is
// deliberately NOT here: it is email-mandatory and cannot be toggled off, so
// it is described rather than offered as a control (AC's own instruction —
// "the UI says so").

function formatWhen(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export default async function NotificationsPage() {
  const actor = await requireTenantActor()
  const [grid, consent, marketingSms] = await Promise.all([
    currentPreferences(actor.tenantId),
    smsConsentView(actor.tenantId),
    smsConsentView(actor.tenantId, 'marketing_sms'),
  ])
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">{t('notif.title')}</h1>

      <section aria-labelledby="grid-heading" className="flex flex-col gap-3">
        <h2 id="grid-heading" className="font-medium">
          {t('notif.gridHeading')}
        </h2>
        <AdminForm action={setPreferencesAction} label={t('notif.regionLabel')} className="flex flex-col gap-4">
          <ScrollRegion aria-label={t('notif.regionLabel')}>
            <table className="w-full min-w-md border-collapse text-sm">
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">{t('notif.colCategory')}</th>
                  <th scope="col" className="py-2 pr-4">{t('notif.colEmail')}</th>
                  <th scope="col" className="py-2 pr-4">{t('notif.colText')}</th>
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_CATEGORIES.map((category) => (
                  <tr key={category.key} className="border-input border-b">
                    <th scope="row" className="py-3 pr-4 text-left font-normal align-top">
                      <span className="font-medium">{t(category.labelKey)}</span>
                      <p className="text-muted-foreground text-xs text-pretty">
                        {t(category.descriptionKey)}
                      </p>
                    </th>
                    <td className="py-3 pr-4 align-top">
                      <input
                        type="checkbox"
                        name={`${category.key}:email`}
                        value="yes"
                        defaultChecked={grid[category.key].email}
                        aria-label={t('notif.byEmail', { category: t(category.labelKey) })}
                      />
                    </td>
                    <td className="py-3 pr-4 align-top">
                      <input
                        type="checkbox"
                        name={`${category.key}:sms`}
                        value="yes"
                        defaultChecked={grid[category.key].sms}
                        aria-label={t('notif.byText', { category: t(category.labelKey) })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <button
            type="submit"
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
          >
            {t('notif.savePreferences')}
          </button>
        </AdminForm>
        <p className="text-muted-foreground max-w-prose text-xs text-pretty">
          {t('notif.mandatoryNote')}
        </p>
      </section>

      <section aria-labelledby="sms-consent-heading" className="flex flex-col gap-3">
        <h2 id="sms-consent-heading" className="font-medium">
          {t('notif.smsHeading')}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          {t('notif.smsIntroBefore')}{' '}
          <Link href="/messaging-policy" className="underline underline-offset-4">
            {t('notif.smsPolicyLink')}
          </Link>
          .
        </p>
        {consent.state ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('notif.status')}</dt>
            <dd>{consent.state === 'granted' ? t('notif.granted') : t('notif.revoked')}</dd>
            {consent.capturedAt && (
              <>
                <dt className="text-muted-foreground">{t('notif.asOf')}</dt>
                <dd>{formatWhen(consent.capturedAt, locale)}</dd>
              </>
            )}
            {consent.source && (
              <>
                <dt className="text-muted-foreground">{t('notif.recordedFrom')}</dt>
                <dd>{consent.source.replace(/_/g, ' ')}</dd>
              </>
            )}
            {consent.disclosureVersion && (
              <>
                <dt className="text-muted-foreground">{t('notif.disclosureVersion')}</dt>
                <dd>{consent.disclosureVersion}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t('notif.neverAskedSms')}
          </p>
        )}

        {consent.state === 'granted' && (
          <AdminForm action={revokeSmsAction} label={t('notif.turnOffTexts')} className="flex flex-col gap-2">
            <p className="text-muted-foreground max-w-prose text-xs text-pretty">
              {t('notif.stopNote')}
            </p>
            <button
              type="submit"
              className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
            >
              {t('notif.turnOffTexts')}
            </button>
          </AdminForm>
        )}
      </section>

      {/* D-51 (B-123). Its own section, below the account-text one and
          deliberately not folded into it: the two are different permissions
          with different law behind them, and a single "texts" switch would
          make turning promotions off cost somebody their gate code. */}
      <section aria-labelledby="marketing-sms-heading" className="flex flex-col gap-3">
        <h2 id="marketing-sms-heading" className="font-medium">
          {t('notif.marketingHeading')}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          {t('notif.marketingIntro')}
        </p>

        {marketingSms.state ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('notif.status')}</dt>
            <dd>
              {marketingSms.state === 'granted'
                ? t('notif.marketingGranted')
                : t('notif.marketingRevoked')}
            </dd>
            {marketingSms.capturedAt && (
              <>
                <dt className="text-muted-foreground">{t('notif.asOf')}</dt>
                <dd>{formatWhen(marketingSms.capturedAt, locale)}</dd>
              </>
            )}
            {marketingSms.source && (
              <>
                <dt className="text-muted-foreground">{t('notif.recordedFrom')}</dt>
                <dd>{marketingSms.source.replace(/_/g, ' ')}</dd>
              </>
            )}
            {marketingSms.disclosureVersion && (
              <>
                <dt className="text-muted-foreground">{t('notif.disclosureVersion')}</dt>
                <dd>{marketingSms.disclosureVersion}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t('notif.neverAskedMarketing')}
          </p>
        )}

        <AdminForm
          action={setMarketingSmsAction}
          label={t('notif.marketingHeading')}
          className="flex flex-col gap-2"
        >
          {/* The disclosure is shown HERE, at the point of granting, not only
              at checkout — express written consent is consent to the words the
              person was actually shown, and a bare "on" switch is consent to
              nothing in particular. The version recorded is this text's. */}
          <p className="text-muted-foreground max-w-prose text-xs text-pretty">
            {MARKETING_SMS_DISCLOSURE}
          </p>
          <input
            type="hidden"
            name="marketingSms"
            value={marketingSms.state === 'granted' ? 'no' : 'yes'}
          />
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
          >
            {marketingSms.state === 'granted'
              ? t('notif.turnOffMarketing')
              : t('notif.turnOnMarketing')}
          </button>
        </AdminForm>
      </section>

      <Link href="/portal" className="text-sm underline underline-offset-4">
        {t('paypg.backToAccount')}
      </Link>
    </div>
  )
}
