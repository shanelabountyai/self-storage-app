import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@storage/db'
import { requireTenantActor } from '@/lib/rbac/session'
import { addressHistory, currentAddress } from '@/lib/portal/contact'
import { AdminForm, Field } from '@/components/admin/form'
import {
  requestEmailChangeAction,
  saveAddressAction,
  saveContactDetailsAction,
} from './actions'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export const metadata: Metadata = { title: 'Contact details' }

// PRD 01 US-706 / PRD 02 US-13. Three separate forms on purpose: saving a
// phone number should not require re-entering an address, and changing an
// email is a different act with a different outcome (a link, not a save).

const FIELD_CLASS = 'flex flex-col gap-1 text-sm'

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    date,
  )
}

export default async function ContactPage() {
  const actor = await requireTenantActor()
  const [tenant, address, history] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: actor.tenantId },
      select: {
        email: true,
        phone: true,
        altContactName: true,
        altContactPhone: true,
        altContactEmail: true,
      },
    }),
    currentAddress(actor.tenantId),
    addressHistory(actor.tenantId),
  ])
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">{t('cont.title')}</h1>

      <section aria-labelledby="details-heading" className="flex flex-col gap-3">
        <h2 id="details-heading" className="font-medium">
          {t('cont.phoneSection')}
        </h2>
        <AdminForm
          action={saveContactDetailsAction}
          label={t('cont.phoneSection')}
          className="flex flex-col gap-3"
        >
          <Field name="phone" label={t('cont.phone')} type="tel" defaultValue={tenant.phone ?? ''} className={FIELD_CLASS} />
          <Field
            name="altContactName"
            label={t('cont.altName')}
            defaultValue={tenant.altContactName ?? ''}
            className={FIELD_CLASS}
          />
          <Field
            name="altContactPhone"
            label={t('cont.altPhone')}
            type="tel"
            defaultValue={tenant.altContactPhone ?? ''}
            className={FIELD_CLASS}
          />
          <Field
            name="altContactEmail"
            label={t('cont.altEmail')}
            type="email"
            defaultValue={tenant.altContactEmail ?? ''}
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            className="bg-primary text-primary-foreground mt-1 inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
          >
            {t('cont.saveDetails')}
          </button>
        </AdminForm>
      </section>

      <section aria-labelledby="address-heading" className="flex flex-col gap-3">
        <h2 id="address-heading" className="font-medium">
          {t('cont.addressSection')}
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">
          {t('cont.addressIntro')}
        </p>
        <AdminForm action={saveAddressAction} label={t('cont.addressSection')} className="flex flex-col gap-3">
          <Field
            name="addressLine1"
            label={t('cont.address1')}
            defaultValue={address?.addressLine1 ?? ''}
            required
            className={FIELD_CLASS}
          />
          <Field
            name="addressLine2"
            label={t('cont.address2')}
            defaultValue={address?.addressLine2 ?? ''}
            className={FIELD_CLASS}
          />
          <Field name="city" label={t('cont.city')} defaultValue={address?.city ?? ''} required className={FIELD_CLASS} />
          <Field
            name="state"
            label={t('cont.state')}
            defaultValue={address?.state ?? ''}
            maxLength={2}
            required
            className={FIELD_CLASS}
          />
          <Field
            name="postalCode"
            label={t('cont.postalCode')}
            inputMode="numeric"
            defaultValue={address?.postalCode ?? ''}
            required
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            className="bg-primary text-primary-foreground mt-1 inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
          >
            {t('cont.saveAddress')}
          </button>
        </AdminForm>

        {history.length > 1 && (
          <details className="border-input rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">{t('cont.previousAddresses')}</summary>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {history.slice(1).map((row) => (
                <li key={row.id} className="text-muted-foreground">
                  {row.addressLine1}
                  {row.addressLine2 ? `, ${row.addressLine2}` : ''}, {row.city} {row.state}{' '}
                  {row.postalCode} — {t('cont.until', { date: formatWhen(row.createdAt) })}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="email-heading" className="flex flex-col gap-3">
        <h2 id="email-heading" className="font-medium">
          {t('cont.emailSection')}
        </h2>
        <p className="text-sm">
          {t('cont.emailIsBefore')} <strong>{tenant.email}</strong>. {t('cont.emailIsAfter')}
        </p>
        <p className="text-muted-foreground text-sm text-pretty">
          {t('cont.emailChangeIntro')}
        </p>
        <AdminForm action={requestEmailChangeAction} label={t('cont.changeEmailFormLabel')} className="flex flex-col gap-3">
          <Field
            name="email"
            label={t('cont.newEmail')}
            type="email"
            inputMode="email"
            required
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
          >
            {t('cont.sendConfirmation')}
          </button>
        </AdminForm>
      </section>

      <Link href="/portal" className="text-sm underline underline-offset-4">
        {t('paypg.backToAccount')}
      </Link>
    </div>
  )
}
