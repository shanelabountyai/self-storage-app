import Link from 'next/link'
import { requireTenantActor } from '@/lib/rbac/session'
import {
  previewTenantTransfer,
  tenantTransferLeases,
  transferOptionsFor,
  lienTransferRefusal,
  PORTAL_TRANSFER_PROBLEM_KEYS,
} from '@/lib/portal/transfer'
import { MAX_MOVE_IN_DAYS_AHEAD } from '@/lib/reservations/reserve'
import { formatRate } from '@/lib/format'
import { AdminForm, Field } from '@/components/admin/form'
import { CallLink, phoneFor } from '@/components/marketing/call-link'
import { cancelTransferAction, requestTransferAction } from './actions'
import { dictionaryFor, translate, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata() {
  return { title: translate(dictionaryFor(await getLocale()), 'tr.title') }
}

// PRD 01 §9 / US-14 (B-090 part 2). Pick a unit → pick a date → see what the
// swap settles to → ask. Nothing here commits a transfer: that stays exactly
// where B-077 built it, behind a person who can see whether the old unit is
// actually empty.

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
}

// B-142 / PRD 02 §4.4 US-14: the hold's absolute facility-local expiry, never
// a countdown.
function formatExpiry(date: Date, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date)
}

// UTC day math, matching the server-side ceiling in `requestTransfer` — not
// local-time `setDate`, which can drift a day off a UTC boundary depending on
// the server's own timezone.
function maxDateIso(): string {
  const today = new Date()
  const startOfTodayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return isoDate(new Date(startOfTodayUtc + MAX_MOVE_IN_DAYS_AHEAD * 24 * 60 * 60 * 1000))
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>
}

export default async function PortalTransferPage({
  searchParams,
}: {
  searchParams: Promise<{ lease?: string; unit?: string; date?: string }>
}) {
  const { lease: leaseId, unit: toUnitId, date } = await searchParams
  const actor = await requireTenantActor()
  const leases = await tenantTransferLeases(actor.tenantId)
  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)

  if (leases.length === 0) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{t('tr.title')}</h1>
        <p className="text-sm text-pretty">{t('tr.noUnits')}</p>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          {t('paypg.backToAccount')}
        </Link>
      </Shell>
    )
  }

  const selectedId = leaseId ?? (leases.length === 1 ? leases[0].leaseId : undefined)

  if (!selectedId) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{t('tr.title')}</h1>
        <p className="text-sm">{t('tr.whichUnit')}</p>
        <ul className="flex flex-col gap-2">
          {leases.map((lease) => (
            <li key={lease.leaseId}>
              {lease.transferable ? (
                <Link
                  href={`/portal/transfer?lease=${lease.leaseId}`}
                  className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                >
                  {t('tr.unitOption', {
                    facility: lease.facilityName,
                    unit: lease.unitNumber,
                    type: lease.unitTypeName,
                  })}
                </Link>
              ) : (
                <p className="text-muted-foreground text-sm text-pretty">
                  {t('tr.lienListed', {
                    facility: lease.facilityName,
                    refusal: lienTransferRefusal(lease.unitNumber, dict),
                  })}{' '}
                  <CallLink
                    phone={phoneFor(lease.facilityPhone || null)}
                    className="underline underline-offset-4"
                  />
                </p>
              )}
            </li>
          ))}
        </ul>
      </Shell>
    )
  }

  const lease = leases.find((l) => l.leaseId === selectedId)
  if (!lease) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{t('tr.title')}</h1>
        <p className="text-sm text-pretty">{t('tr.notFound')}</p>
        <Link href="/portal/transfer" className="text-sm underline underline-offset-4">
          {t('tr.chooseAUnit')}
        </Link>
      </Shell>
    )
  }

  // In the lien pipeline (B-137, D-85): no picker, no options, no preview. The
  // office is the only route, and saying so is the whole screen.
  if (!lease.transferable) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{t('tr.title')}</h1>
        <p className="text-sm text-pretty">
          {t('tr.lienListed', {
            facility: lease.facilityName,
            refusal: lienTransferRefusal(lease.unitNumber, dict),
          })}{' '}
          <CallLink
            phone={phoneFor(lease.facilityPhone || null)}
            className="underline underline-offset-4"
          />
        </p>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          {t('paypg.backToAccount')}
        </Link>
      </Shell>
    )
  }

  // Already asked: show what was asked for and a way to withdraw it, not the
  // picker again. Same shape as the move-out request screen.
  if (lease.pending) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">{t('tr.requestedTitle')}</h1>
        <p className="text-sm text-pretty">
          {t('tr.holdingBefore')}{' '}
          <strong>{t('tr.holdingUnit', { unit: lease.pending.unitNumber })}</strong>{' '}
          {t('tr.holdingAtFor', { facility: lease.facilityName })}{' '}
          <strong>{formatDate(lease.pending.transferDate, locale)}</strong>,{' '}
          {t('tr.holdingAtRate')}{' '}
          <strong>
            {formatRate(lease.pending.quotedRateCents)}
            {t('card.perMonth')}
          </strong>{' '}
          {t('tr.holdingRateNote', { unit: lease.unitNumber })}
        </p>
        <p className="text-sm text-pretty">
          {t('tr.holdLastsBefore')}{' '}
          <strong>
            {formatExpiry(lease.pending.expiresAt, lease.facilityTimezone, locale)}
          </strong>
          . {t('tr.holdLastsAfter')}{' '}
          <CallLink phone={phoneFor(lease.facilityPhone || null)} /> {t('tr.toKeepIt')}
        </p>
        <p className="text-sm text-pretty">
          {t('tr.theyWillCall')}{' '}
          <CallLink phone={phoneFor(lease.facilityPhone || null)} />.
        </p>
        <AdminForm action={cancelTransferAction} label={t('tr.cancelFormLabel')}>
          <input type="hidden" name="leaseId" value={lease.leaseId} />
          <button
            type="submit"
            className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
          >
            {t('tr.cancelThis')}
          </button>
        </AdminForm>
        <Link href="/portal" className="text-sm underline underline-offset-4">
          {t('paypg.backToAccount')}
        </Link>
      </Shell>
    )
  }

  const options = await transferOptionsFor(actor.tenantId, lease.leaseId)
  const transferDate = date ? new Date(`${date}T00:00:00.000Z`) : new Date()
  const selectedUnit = options.find((option) => option.unitId === toUnitId)
  const previewResult = selectedUnit
    ? await previewTenantTransfer(actor.tenantId, lease.leaseId, selectedUnit.unitId, transferDate)
    : null
  const preview = previewResult?.ok ? previewResult.preview : null
  // B-142. Used to be dropped entirely — a failed preview re-rendered the
  // page byte-identical to before the request, with no price and no message
  // (3.3.1), indistinguishable from a broken picker.
  const previewProblem = previewResult && !previewResult.ok ? previewResult.problem : null

  return (
    <Shell>
      <div>
        {leases.length > 1 && (
          <Link href="/portal/transfer" className="text-sm underline underline-offset-4">
            {t('tr.chooseDifferent')}
          </Link>
        )}
        <h1 className="mt-1 text-xl font-semibold">
          {t('tr.headingForUnit', { unit: lease.unitNumber })}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          {t('tr.payingNow', {
            rate: formatRate(lease.monthlyRateCents),
            unit: lease.unitNumber,
            type: lease.unitTypeName,
            facility: lease.facilityName,
          })}
        </p>
      </div>

      {options.length === 0 ? (
        <p className="text-sm text-pretty">
          {t('tr.nothingFreeBefore', { facility: lease.facilityName })}{' '}
          <CallLink phone={phoneFor(lease.facilityPhone || null)} /> {t('tr.nothingFreeAfter')}
        </p>
      ) : (
        <>
          {/* B-173. One form, one truth.

              The unit and the date used to sit in their own `method="GET"` form
              whose only submit was "Show me what it costs", while the request
              form below carried hidden copies built from the URL — so changing
              either and pressing Request this transfer asked for the PREVIOUS
              one, after showing the tenant what the new one costs. Nothing said
              the controls were inert until a second button was pressed.

              They are fields of the requesting form now, so what posts is what
              is on screen, and `stalePreview` refuses while a control and the
              priced value disagree. The pricing button is a native GET submit of
              this same form: a submit button whose `formAction` is a STRING is
              the one case React hands back to the browser. */}
          <AdminForm
            action={requestTransferAction}
            label={t('tr.formLabel')}
            className="flex flex-col gap-4"
          >
            <input type="hidden" name="leaseId" value={lease.leaseId} />
            <input type="hidden" name="lease" value={lease.leaseId} />
            <input type="hidden" name="previewed_unit" value={toUnitId ?? ''} />
            <input type="hidden" name="previewed_date" value={isoDate(transferDate)} />
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t('tr.whichWouldYouLike')}</legend>
              {options.map((option) => (
                <label
                  key={option.unitId}
                  className="border-input flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="unit"
                    value={option.unitId}
                    defaultChecked={option.unitId === toUnitId}
                  />
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{t('tr.optionUnit', { unit: option.unitNumber })}</span>
                    <span className="text-muted-foreground">
                      {option.unitTypeName} ·{' '}
                      <span aria-hidden="true">
                        {option.widthFt}×{option.lengthFt}
                      </span>
                      <span className="sr-only">
                        {t('facility.footBy', {
                          width: option.widthFt,
                          length: option.lengthFt,
                        })}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {formatRate(option.rateCents)}
                      {t('card.perMonth')}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {option.monthlyDifferenceCents === 0
                        ? t('tr.sameAsNow')
                        : option.monthlyDifferenceCents > 0
                          ? t('tr.moreAMonth', {
                              amount: formatRate(option.monthlyDifferenceCents),
                            })
                          : t('tr.lessAMonth', {
                              amount: formatRate(-option.monthlyDifferenceCents),
                            })}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <Field
              name="date"
              label={t('tr.whenMove')}
              type="date"
              min={isoDate(new Date())}
              max={maxDateIso()}
              defaultValue={isoDate(transferDate)}
              className="flex max-w-xs flex-col gap-1 text-sm"
            />

            <button
              type="submit"
              formMethod="get"
              formAction="/portal/transfer"
              className="border-input hover:bg-accent inline-flex min-h-11 items-center self-start rounded-md border px-4 text-sm font-medium"
            >
              {t('tr.showCost')}
            </button>

            {previewProblem && (
              <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                {t(PORTAL_TRANSFER_PROBLEM_KEYS[previewProblem] ?? 'tr.previewFailed', {
                  days: MAX_MOVE_IN_DAYS_AHEAD,
                })}
              </p>
            )}

            {preview && (
              <>
                <dl className="border-input flex flex-col gap-2 rounded-lg border p-4 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt>{t('tr.newRentFor', { unit: preview.toUnitNumber })}</dt>
                    <dd className="tabular-nums">{formatRate(preview.newRateCents)}</dd>
                  </div>
                  {preview.refundCents > 0 && (
                    <div className="flex justify-between gap-4">
                      <dt>{t('tr.creditForDays', { unit: preview.fromUnitNumber })}</dt>
                      <dd className="tabular-nums">−{formatRate(preview.refundCents)}</dd>
                    </div>
                  )}
                  {preview.chargeCents > 0 && (
                    <div className="flex justify-between gap-4">
                      <dt>{t('tr.unitForRange', { unit: preview.toUnitNumber, range: preview.dayRange })}</dt>
                      <dd className="tabular-nums">{formatRate(preview.chargeCents)}</dd>
                    </div>
                  )}
                  {preview.transferFeeCents > 0 && (
                    <div className="flex justify-between gap-4">
                      <dt>{t('tr.transferFee')}</dt>
                      <dd className="tabular-nums">{formatRate(preview.transferFeeCents)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4 border-t pt-2 font-medium">
                    <dt>
                      {preview.totalDueTodayCents > 0
                        ? t('tr.toPayOnDay')
                        : preview.totalDueTodayCents < 0
                          ? t('tr.creditedToAccount')
                          : t('tr.nothingToPay')}
                    </dt>
                    <dd className="tabular-nums">
                      {formatRate(Math.abs(preview.totalDueTodayCents))}
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-col gap-3">
                  <p className="text-muted-foreground text-sm text-pretty">
                    {t('tr.willHold', { unit: preview.toUnitNumber })}
                  </p>
                  {/* B-173. The unit and the day are in the button's own
                      accessible name, not only in controls the reader passed
                      several fields ago. */}
                  <button
                    type="submit"
                    className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 text-sm font-medium"
                  >
                    {t('tr.requestFrom', {
                      unit: preview.toUnitNumber,
                      date: formatDate(transferDate, locale),
                    })}
                  </button>
                </div>
              </>
            )}
          </AdminForm>
        </>
      )}

      <Link href="/portal" className="text-sm underline underline-offset-4">
        Back to my account
      </Link>
    </Shell>
  )
}
