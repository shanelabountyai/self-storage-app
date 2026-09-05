import type { Metadata } from 'next'
import { AdminForm, Field } from '@/components/admin/form'
import { requireTenantActor } from '@/lib/rbac/session'
import { authorizedAccessForTenant } from '@/lib/portal/authorized-access'
import { currentImpersonation } from '@/lib/impersonation/context'
import { SHARED_ACCESS_PRESETS } from '@storage/core/access'
import { mobileKeysForTenant, type MobileKey } from '@/lib/access/mobile-key'
import { UnlockButton } from '@/components/portal/unlock-button'
import { AnnounceRegion } from '@/components/admin/announce'
import {
  addPersonAction,
  enrollMobileKeyAction,
  revokeMobileKeyAction,
  revokePersonAction,
  unlockGateAction,
} from './actions'
import { dictionaryFor, translate, type Dictionary, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(dictionaryFor(await getLocale()), 'acc.title') }
}

// PRD 03 US-9 AC4 (B-105). The tenant's own authorized-access list.
//
// The heading is "Who can get in" rather than "Authorized access list" for a
// reason US-9 itself gives: the failure this feature exists to stop is a tenant
// handing their code around, which destroys the gate log's evidentiary value at
// exactly the moment a theft claim needs it. A screen somebody understands at a
// glance is the one they use instead of texting their code to a contractor.

export default async function AccessPage() {
  const actor = await requireTenantActor()
  const [loaded, impersonation, mobileKeys] = await Promise.all([
    authorizedAccessForTenant(actor.tenantId),
    currentImpersonation(),
    mobileKeysForTenant(actor.tenantId),
  ])

  // PRD 09 FR-12 (B-091 part 2). Same rule as the tenant's own code on
  // /portal: an impersonated session never renders a gate code, and the code is
  // dropped from the data rather than hidden in the markup so it is not
  // serialised into the page at all.
  const units = impersonation
    ? loaded.map((unit) => ({ ...unit, people: unit.people.map((p) => ({ ...p, code: null })) }))
    : loaded
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{t('acc.title')}</h1>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          {t('acc.introBefore')} <strong>{t('acc.own')}</strong> {t('acc.introAfter')}
        </p>
      </header>

      <PhoneUnlockSection keys={mobileKeys} impersonated={Boolean(impersonation)} dict={dict} />

      {/* Wrapped and named, and the unit headings drop to h3 with it. Before
          this row the units were the page's only h2s; adding the phone-unlock
          section above them would otherwise have left two unrelated things
          reading as peers, with each unit a sibling of "Open the gate from your
          phone" rather than a child of the list it belongs to. */}
      <section aria-labelledby="authorized-people" className="flex flex-col gap-8">
      <h2 id="authorized-people" className="text-lg font-semibold">
        {t('acc.whoElse')}
      </h2>

      {units.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('acc.noUnits')}</p>
      )}

      {units.map((unit) => (
        <section
          key={unit.leaseId}
          aria-labelledby={`unit-${unit.leaseId}`}
          className="border-input flex flex-col gap-4 rounded-lg border p-4"
        >
          <h3 id={`unit-${unit.leaseId}`} className="font-medium">
            {t('dash.unitNumber', { unit: unit.unitNumber })}
            <span className="text-muted-foreground font-normal">
              {t('acc.unitFacility', { facility: unit.facilityName })}
            </span>
          </h3>

          {unit.tenantSuspended && (
            // Said before the form rather than after the submit. Anyone added
            // now starts suspended, and letting somebody hand out a code that
            // does not work is worse than telling them why.
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900">
              {t('acc.unitSuspended')}
            </p>
          )}

          {unit.people.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('acc.nobodyElse')}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {unit.people.map((person) => (
                <li
                  key={person.id}
                  className="border-input flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{person.name}</p>
                    <p className="text-muted-foreground">
                      {person.relationship} · {person.phone}
                    </p>
                    <p className="text-muted-foreground">
                      {t(person.hoursLabel)}
                      {person.expiresOn &&
                        t('acc.untilDay', { date: formatDay(person.expiresOn, locale) })}
                    </p>
                    {person.code ? (
                      <p className="mt-1">
                        {t('acc.theirCode')}{' '}
                        <span className="font-mono font-medium">{person.code}</span>
                      </p>
                    ) : impersonation ? (
                      <p className="text-muted-foreground mt-1">
                        {t('acc.codesHiddenSupport')}
                      </p>
                    ) : (
                      <p className="text-muted-foreground mt-1">
                        {t('acc.callForCode')}
                      </p>
                    )}
                    {person.suspended && !unit.tenantSuspended && (
                      <p className="mt-1 text-amber-700">{t('acc.codeSwitchedOff')}</p>
                    )}
                    {!person.addedByTenant && (
                      <p className="text-muted-foreground mt-1 text-xs">{t('acc.addedAtOffice')}</p>
                    )}
                  </div>

                  <AdminForm action={revokePersonAction} label={t('acc.withdrawFor', { name: person.name })}>
                    <input type="hidden" name="personId" value={person.id} />
                    <input type="hidden" name="name" value={person.name} />
                    <button type="submit" className="text-sm underline underline-offset-4">
                      {t('acc.withdraw')}
                    </button>
                  </AdminForm>
                </li>
              ))}
            </ul>
          )}

          {unit.people.length >= unit.cap ? (
            <p className="text-muted-foreground text-sm text-pretty">
              {t('acc.atCap', { cap: unit.cap })}
            </p>
          ) : (
            <details className="border-input rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">{t('acc.addSomeone')}</summary>
              <p className="text-muted-foreground mt-2 text-sm text-pretty">
                {t('acc.addSomeoneBody', { cap: unit.cap })}
              </p>
              <AdminForm
                action={addPersonAction}
                label={t('acc.addFormLabel', { unit: unit.unitNumber })}
                className="mt-3 grid gap-3 sm:grid-cols-3"
              >
                <input type="hidden" name="leaseId" value={unit.leaseId} />
                <Field
                  name="name"
                  label={t('acc.fullName')}
                  type="text"
                  required
                  autoComplete="off"
                  className="flex flex-col gap-1 text-sm"
                />
                <Field
                  name="phone"
                  label={t('acc.phone')}
                  type="tel"
                  required
                  autoComplete="off"
                  className="flex flex-col gap-1 text-sm"
                />
                <Field
                  name="relationship"
                  label={t('acc.relationship')}
                  type="text"
                  required
                  autoComplete="off"
                  hint={t('acc.relationshipHint')}
                  className="flex flex-col gap-1 text-sm"
                />
                {/* US-8 AC1's scope. Both optional and both defaulted to the
                    unrestricted answer: the common case is still "my brother,
                    no limits", and a tenant made to answer two questions they
                    did not ask goes back to texting their own code. */}
                <Field
                  name="accessHours"
                  label={t('acc.whenTheyCanGetIn')}
                  as="select"
                  defaultValue="anytime"
                  className="flex flex-col gap-1 text-sm"
                >
                  {Object.entries(SHARED_ACCESS_PRESETS).map(([value, preset]) => (
                    <option key={value} value={value}>
                      {t(preset.labelKey)}
                    </option>
                  ))}
                </Field>
                <Field
                  name="expiresOn"
                  label={t('acc.lastDay')}
                  type="date"
                  min={unit.today}
                  autoComplete="off"
                  hint={t('acc.lastDayHint')}
                  className="flex flex-col gap-1 text-sm"
                />
                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
                  >
                    {t('acc.addThem')}
                  </button>
                </div>
              </AdminForm>
            </details>
          )}
        </section>
      ))}
      </section>
    </div>
  )
}


// PRD 03 US-8 AC1/AC4, OQ-2 (B-086 part 2, D-121). Phone unlock, per gate.
//
// Keyed on the FACILITY, not the unit, and placed above the per-unit list for
// that reason: a mobile key is one credential on the tenant's grant, and a
// tenant with three units at one site has one gate, one code and one phone
// button. The three "unlock" buttons a per-lease rendering would have drawn are
// the same mistake D-54 found in the three PINs a three-unit checkout used to
// mint.
function PhoneUnlockSection({
  keys,
  impersonated,
  dict,
}: {
  keys: MobileKey[]
  impersonated: boolean
  dict: Dictionary
}) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  if (keys.length === 0) return null

  return (
    <section aria-labelledby="phone-unlock" className="flex flex-col gap-4">
      <h2 id="phone-unlock" className="text-lg font-semibold">
        {t('acc.unlockHeading')}
      </h2>
      {/* B-170's case exactly, and it took an e2e failure to see it: turning
          phone unlock on or off revalidates the page, so the form that reports
          the outcome is unmounted in the same commit that writes the message.
          Announced from here instead, above the cards, where the revalidation
          cannot take the region away. The UNLOCK form keeps its own in-form
          region — it survives its own success, and the outcome belongs beside
          the button somebody just pressed. */}
      <AnnounceRegion>
      {/* Said once, at the top, and said plainly. A tenant who believes the
          phone REPLACES the keypad is a tenant standing outside a gate with no
          signal and no code — which is the failure this whole control has to be
          honest about (D-121). */}
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        {t('acc.keypadStillWorks')}
      </p>

      {impersonated && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-pretty text-amber-900">
          {t('acc.impersonatedNoUnlock')}
        </p>
      )}

      {keys.map((key) => (
        <div key={key.facilityId} className="border-input flex flex-col gap-3 rounded-lg border p-4">
          <h3 className="font-medium">{key.facilityName}</h3>

          {key.unavailableReason ? (
            <p className="text-muted-foreground text-sm text-pretty">{key.unavailableReason}</p>
          ) : key.credentialId ? (
            <>
              {key.suspended && (
                <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-pretty text-red-900">
                  {t('acc.suspendedHere')}
                </p>
              )}
              {/* Keyed, and this is not decoration. The enrol branch and this
                  one are conditional siblings in the same slot, so React
                  reconciles the first `AdminForm` of one into the first of the
                  other and carries its `useActionState` across — which put
                  "Phone unlock is on for this gate" into the UNLOCK form's
                  status region as if the gate had just been opened. */}
              <AdminForm
                key="unlock"
                action={unlockGateAction}
                label={t('acc.openGateAt', { facility: key.facilityName })}
              >
                <input type="hidden" name="facilityId" value={key.facilityId} />
                <UnlockButton label={t('acc.openGate')} />
              </AdminForm>
              <AdminForm
                key="revoke"
                action={revokeMobileKeyAction}
                label={t('acc.turnOffAt', { facility: key.facilityName })}
                announceOutside
              >
                <input type="hidden" name="facilityId" value={key.facilityId} />
                <button type="submit" className="self-start text-sm underline underline-offset-4">
                  {t('acc.turnOffLostPhone')}
                </button>
              </AdminForm>
            </>
          ) : (
            <>
              <p className="text-muted-foreground text-sm text-pretty">
                {t('acc.notSwitchedOn')}
              </p>
              <AdminForm
                key="enroll"
                action={enrollMobileKeyAction}
                label={t('acc.turnOnAt', { facility: key.facilityName })}
                announceOutside
              >
                <input type="hidden" name="facilityId" value={key.facilityId} />
                <button
                  type="submit"
                  className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
                >
                  {t('acc.turnOn')}
                </button>
              </AdminForm>
            </>
          )}

          <p className="text-muted-foreground text-sm">
            {t('acc.troubleAtGate')}{' '}
            <a href={`tel:${key.facilityPhone.replace(/[^0-9+]/g, '')}`} className="underline underline-offset-4">
              {key.facilityPhone}
            </a>
            .
          </p>
        </div>
      ))}
      </AnnounceRegion>
    </section>
  )
}

/// An absolute facility-local day, spelled out. Never a countdown — PRD 01
/// §6.8.1.
function formatDay(isoDate: string, locale: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(locale, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
