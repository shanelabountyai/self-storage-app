import type { Metadata } from 'next'
import { AdminForm, Field } from '@/components/admin/form'
import { requireTenantActor } from '@/lib/rbac/session'
import { protectionForTenant } from '@/lib/protection/changes'
import { formatRate } from '@/lib/format'
import {
  cancelProtectionChangeAction,
  changeProtectionAction,
  submitProofAction,
} from './actions'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export const metadata: Metadata = { title: 'Protection and insurance' }

// PRD 01 US-705 (B-104). "Insurance/protection selection visible with option to
// change tier (takes effect next billing cycle) or submit proof of own
// insurance."
//
// The wording throughout says "protection plan" for what we sell and
// "insurance" for cover the tenant already holds. That is not pedantry — see
// lib/protection/plans.ts: selling actual insurance generally needs a licensed
// agent, which is why the industry sells a lease addendum instead, and copy
// that blurs the two is copy that claims something untrue.

function formatDay(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

export default async function ProtectionPage() {
  const actor = await requireTenantActor()
  const units = await protectionForTenant(actor.tenantId)
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{t('prot.title')}</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          {t('prot.intro')}
        </p>
      </header>

      {units.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('prot.noUnits')}</p>
      )}

      {units.map((unit) => (
        <section
          key={unit.leaseId}
          aria-labelledby={`unit-${unit.leaseId}`}
          className="border-input flex flex-col gap-4 rounded-lg border p-4"
        >
          <div>
            <h2 id={`unit-${unit.leaseId}`} className="font-medium">
              {t('dash.unitNumber', { unit: unit.unitNumber })}
              <span className="text-muted-foreground font-normal">
                {t('prot.unitFacility', { facility: unit.facilityName })}
              </span>
            </h2>
            <p className="mt-1 text-sm">
              {unit.currentPlanName ? (
                <>
                  {t('prot.youHaveBefore')} <strong>{unit.currentPlanName}</strong>{' '}
                  {t('prot.youHaveAfter', {
                    amount: formatRate(unit.currentPremiumCents),
                  })}
                </>
              ) : (
                <>{t('prot.ownInsurance')}</>
              )}
            </p>
          </div>

          {unit.waiver?.expired && (
            // Said loudly and BEFORE the forms. D-17 auto-enrols into the
            // facility's default tier when cover lapses, which means a charge
            // the tenant did not choose — telling them after that has happened
            // is how a defensible policy becomes a complaint.
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900">
              {t('prot.expired', { date: formatDay(unit.waiver.expiresAt!, locale) })}
            </p>
          )}

          {unit.pending && (
            <div role="status" className="border-input rounded-md border p-3 text-sm text-pretty">
              <p>
                {unit.pending.toPlanName
                  ? t('prot.pendingChange', {
                      plan: unit.pending.toPlanName,
                      amount: formatRate(unit.pending.toPremiumCents),
                      date: formatDay(unit.pending.effectiveFrom, locale),
                    })
                  : t('prot.pendingStop', {
                      date: formatDay(unit.pending.effectiveFrom, locale),
                    })}
              </p>
              <AdminForm
                action={cancelProtectionChangeAction}
                label={t('prot.callOffLabel')}
                className="mt-2"
              >
                <input type="hidden" name="changeId" value={unit.pending.id} />
                <button type="submit" className="text-sm underline underline-offset-4">
                  {t('prot.callOff')}
                </button>
              </AdminForm>
            </div>
          )}

          <AdminForm
            action={changeProtectionAction}
            label={t('prot.changeFormLabel', { unit: unit.unitNumber })}
            className="flex flex-col gap-3"
          >
            <input type="hidden" name="leaseId" value={unit.leaseId} />
            <Field
              name="tier"
              label={t('prot.levelOfCover')}
              as="select"
              defaultValue=""
              className="flex flex-col gap-1 text-sm"
            >
              <option value="">{t('prot.choose')}</option>
              {unit.plans.map((plan) => (
                <option key={plan.tier} value={plan.tier}>
                  {t('prot.planOption', {
                    name: plan.name,
                    coverage: formatRate(plan.coverageCents),
                    premium: formatRate(plan.premiumCents),
                  })}
                </option>
              ))}
              <option value="waiver">{t('prot.iHaveOwn')}</option>
            </Field>
            <button
              type="submit"
              className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
            >
              {t('prot.changeCover')}
            </button>
          </AdminForm>

          <details className="border-input rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t('prot.tellUsSummary')}
            </summary>
            <p className="text-muted-foreground mt-2 text-sm text-pretty">
              {t('prot.tellUsBody')}
            </p>
            <AdminForm
              action={submitProofAction}
              label={t('prot.proofFormLabel', { unit: unit.unitNumber })}
              className="mt-3 grid gap-3 sm:grid-cols-3"
            >
              <input type="hidden" name="leaseId" value={unit.leaseId} />
              <Field
                name="carrier"
                label={t('prot.insurer')}
                type="text"
                required
                defaultValue={unit.waiver?.carrier ?? ''}
                className="flex flex-col gap-1 text-sm"
              />
              <Field
                name="policyNumber"
                label={t('prot.policyNumber')}
                type="text"
                required
                defaultValue={unit.waiver?.policyNumber ?? ''}
                className="flex flex-col gap-1 text-sm"
              />
              <Field
                name="expiresAt"
                label={t('prot.runsOutOn')}
                type="date"
                required
                defaultValue={unit.waiver?.expiresAt?.toISOString().slice(0, 10) ?? ''}
                className="flex flex-col gap-1 text-sm"
              />
              <Field
                name="document"
                label={t('prot.declarationPage')}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                hint={t('prot.declarationHint')}
                className="flex flex-col gap-1 text-sm sm:col-span-3"
              />
              <div className="sm:col-span-3">
                <button
                  type="submit"
                  className="border-input hover:bg-accent inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium"
                >
                  {t('prot.sendDetails')}
                </button>
              </div>
            </AdminForm>
          </details>
        </section>
      ))}
    </div>
  )
}
