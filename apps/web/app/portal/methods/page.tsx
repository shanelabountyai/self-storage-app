import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import { autopayLeases, savedMethods } from '@/lib/portal/payment-methods'
import { nextBillingDate } from '@/lib/portal/dashboard'

import { formatCalendarDate, formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { chargePartsSentence } from '@/lib/pricing/charge-parts'
import { AdminForm } from '@/components/admin/form'
import { removeMethodAction, setAutopayAction, setDefaultMethodAction } from './actions'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await getLocale()), 'meth.title') }
}

// PRD 01 §4.7 US-704. Cards on file, which unit charges itself, and what the
// next charge will be.
//
// Changing any of this re-verifies who you are first (US-701) — actions.ts
// owns that gate, including why turning autopay OFF is deliberately not gated.

function formatCard(brand: string): string {
  return brand.charAt(0).toUpperCase() + brand.slice(1)
}

export default async function PaymentMethodsPage() {
  const actor = await requireTenantActor()
  const [methods, leases] = await Promise.all([
    savedMethods(actor.tenantId),
    autopayLeases(actor.tenantId),
  ])
  const hasMethod = Boolean(methods && methods.length > 0)
  const dict = dictionaryFor(await getLocale())
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">{t('meth.title')}</h1>

      <section aria-labelledby="cards-heading" className="flex flex-col gap-3">
        <h2 id="cards-heading" className="font-medium">
          {t('meth.cardsOnFile')}
        </h2>

        {methods === null ? (
          // Distinct from "no cards": we could not ask, so we do not claim.
          <p className="border-input rounded-lg border p-4 text-sm text-pretty">
            {t('meth.cannotShowCards')}{' '}
            <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
              {SITE.phone.display}
            </a>{' '}
            {t('meth.cannotShowCardsAfter')}
          </p>
        ) : methods.length === 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            {t('meth.noCardSaved')}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {methods.map((method) => (
              <li key={method.id} className="border-input rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {t('meth.cardEnding', { brand: formatCard(method.brand), last4: method.last4 })}
                    {method.isDefault && (
                      <span className="text-muted-foreground ml-2 font-normal">
                        {t('meth.isDefault')}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {t('meth.expires', {
                      month: String(method.expMonth).padStart(2, '0'),
                      year: method.expYear,
                    })}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {!method.isDefault && (
                    <AdminForm
                      action={setDefaultMethodAction}
                      label={t('meth.useCardLabel', { last4: method.last4 })}
                    >
                      <input type="hidden" name="methodId" value={method.id} />
                      <button
                        type="submit"
                        className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                      >
                        {t('meth.useThisCard')}
                      </button>
                    </AdminForm>
                  )}
                  <AdminForm
                    action={removeMethodAction}
                    label={t('meth.removeCardLabel', { last4: method.last4 })}
                  >
                    <input type="hidden" name="methodId" value={method.id} />
                    <button
                      type="submit"
                      className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                    >
                      {t('meth.remove')}
                    </button>
                  </AdminForm>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground text-sm text-pretty">
          {t('meth.addACard')}{' '}
          <a href={`tel:${SITE.phone.href}`} className="underline underline-offset-4">
            {SITE.phone.display}
          </a>
          .
        </p>
      </section>

      <section aria-labelledby="autopay-heading" className="flex flex-col gap-3">
        <h2 id="autopay-heading" className="font-medium">
          {t('meth.autopayHeading')}
        </h2>

        {leases.length === 0 ? (
          <p className="text-muted-foreground text-sm text-pretty">
            {t('meth.noActiveUnit')}
          </p>
        ) : (
          leases.map((lease) => {
            const next = nextBillingDate(lease.billingDay, new Date())
            return (
              <div key={lease.leaseId} className="border-input rounded-lg border p-4">
                <p className="text-sm font-medium">
                  {t('meth.unitHeading', {
                    facility: lease.facilityName,
                    unit: lease.unitNumber,
                  })}
                </p>

                {/* §4.6: the amount and the date, next to the control that
                    turns it on — not behind a link. */}
                <p className="text-muted-foreground mt-1 text-sm text-pretty">
                  {lease.autopayEnabled ? (
                    <>
                      {t('meth.autopayOnBefore')}{' '}
                      <strong>{formatRate(lease.monthlyChargeCents)}</strong>{' '}
                      {/* B-227 / US-301. The figure states what it contains.
                          It was rent plus protection with the tax on rent
                          missing, so it was LOWER than what autopay actually
                          took — and this is the sentence a tenant screenshots
                          when the two do not match. */}
                      {/* B-260 found a real defect here, and it is B-228's
                          exactly. This read `new Intl.DateTimeFormat('en-US',
                          …)` with NO `timeZone`, and `nextBillingDate` returns
                          a calendar day held at UTC midnight — so in every US
                          timezone it rendered the day BEFORE. Reproduced in
                          America/Chicago: this screen said "October 14" for a
                          charge the dashboard, one tap away, dated "October
                          15", about the same money on the same lease.
                          `formatCalendarDate` pins UTC, which is what every
                          other calendar day in this product is formatted
                          with. */}
                      {t('meth.autopayOnAfter', {
                        parts: chargePartsSentence(dict, lease.chargeParts),
                        day: lease.billingDay,
                        next: formatCalendarDate(next, { month: 'long', day: 'numeric' }),
                      })}
                    </>
                  ) : (
                    <>
                      {t('meth.autopayOff', {
                        amount: formatRate(lease.monthlyChargeCents),
                        parts: chargePartsSentence(dict, lease.chargeParts),
                        day: lease.billingDay,
                      })}
                    </>
                  )}
                </p>

                {lease.autopayEnabled && !hasMethod && (
                  <p role="alert" className="mt-2 text-sm text-pretty text-red-800">
                    {t('meth.noCardWarning')}
                  </p>
                )}

                <AdminForm
                  action={setAutopayAction}
                  label={t('meth.autopayFormLabel', { unit: lease.unitNumber })}
                  className="mt-3"
                >
                  <input type="hidden" name="leaseId" value={lease.leaseId} />
                  <input type="hidden" name="enabled" value={lease.autopayEnabled ? 'no' : 'yes'} />
                  <button
                    type="submit"
                    className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                  >
                    {lease.autopayEnabled ? t('meth.turnOff') : t('meth.turnOn')}
                  </button>
                </AdminForm>
              </div>
            )
          })
        )}
      </section>

      <Link href="/portal" className="text-sm underline underline-offset-4">
        {t('paypg.backToAccount')}
      </Link>
    </div>
  )
}
