import Link from 'next/link'
import { formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'
import { reservationByToken } from '@/lib/reservations/reserve'
import { cancelReservationAction, completeMoveInFromReservationAction } from './actions'
import { AdminForm } from '@/components/admin/form'
import { dictionaryFor, translate, LOCALE_TAG, type Locale, type MessageKey } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'

export async function generateMetadata() {
  return {
    title: translate(dictionaryFor(await getLocale()), 'res.title'),
    // A page reachable only with a token has no business in an index. Which is
    // also why the title is translated at all where the marketing pages' are
    // not (B-262): there is no crawler here to keep on English.
    robots: { index: false, follow: false },
  }
}

// PRD 01 US-401 / FR-3.2. The confirmation screen, and the page the cancel link
// in the email lands on. One page for both: the renter needs to see what they
// are cancelling before they cancel it.
//
// B-268 (D-122). This surface imported nothing from `@/lib/i18n`, so B-267's
// Spanish reservation form redirected to an English confirmation — the page
// that says a unit is held, and the page that releases it.

/// The hold's expiry, in the reader's own language. `'en-US'` was hardcoded
/// here, which left the one fact on this page with a deadline attached in
/// English after every sentence around it was translated.
///
/// `timeZone` was already explicit and stays that way — it is the facility's,
/// not the server's, and B-228's class is what makes that load-bearing.
function formatWhen(date: Date, timezone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatDay(date: Date, timezone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

/// The sentence for a hold that is over. One key per status rather than one
/// sentence quoting `reservation.status`: that column is a database enum, so
/// interpolating it left an English word inside the Spanish — and, worse, told
/// a renter who had just MOVED IN that their unit was back on the market.
function endedKey(status: string): MessageKey {
  if (status === 'converted') return 'res.endedConverted'
  if (status === 'expired') return 'res.endedExpired'
  return 'res.endedCancelled'
}

export default async function ReservationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; new?: string }>
}) {
  const { token, new: isNew } = await searchParams
  const reservation = token ? await reservationByToken(token) : null

  const locale = await getLocale()
  const dict = dictionaryFor(locale)
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(dict, key, vars)

  if (!reservation) {
    // Unknown token and expired-link look identical on purpose — a guesser
    // learns nothing from the difference, and the renter's next step is the
    // same either way (§6.7: name the problem, then offer a human).
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {t('res.deadHeading')}
        </h1>
        <p className="mt-4 text-pretty">{t('res.deadBody')}</p>
        <p className="mt-4">
          <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
            {t('res.deadCall', { phone: SITE.phone.display })}
          </a>{' '}
          <span className="text-muted-foreground">{t('res.deadOffer')} </span>
          <Link href="/storage/search" className="underline underline-offset-4">
            {t('res.deadSearch')}
          </Link>
          .
        </p>
      </div>
    )
  }

  const { facility, unitType } = reservation
  const live = reservation.status === 'held'

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {isNew ? t('res.headingNew') : t('res.title')}
      </h1>

      {/* Where the outcome of cancelling is reported. The cancel form and its
          own status region are gone by the time this renders — the form only
          exists while the hold is live — so the announcement has to live here,
          on the state that replaced it. Safe as a live region because this
          arrives with a full page render after a POST, not as a node inserted
          mid-interaction. */}
      {!live && (
        <p role="status" className="border-input mt-4 rounded-md border p-3 text-pretty">
          {t(endedKey(reservation.status))}
        </p>
      )}

      <dl className="mt-6 flex flex-col gap-3">
        <div>
          <dt className="text-muted-foreground text-sm">{t('res.facility')}</dt>
          <dd className="font-medium">
            {facility.name} — {facility.city}, {facility.state}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm">{t('res.unit')}</dt>
          <dd className="font-medium">
            <span aria-hidden="true">
              {unitType.widthFt}×{unitType.lengthFt}
            </span>
            <span className="sr-only">
              {t('facility.footBy', { width: unitType.widthFt, length: unitType.lengthFt })}
            </span>{' '}
            — {unitType.name}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm">{t('res.rateHeld')}</dt>
          <dd className="font-medium">
            {formatRate(reservation.quotedRateCents)}
            {t('card.perMonth')}
          </dd>
        </div>
        {reservation.moveInDate && (
          <div>
            <dt className="text-muted-foreground text-sm">{t('reserve.moveInDate')}</dt>
            <dd className="font-medium">
              {formatDay(reservation.moveInDate, facility.timezone, locale)}
            </dd>
          </div>
        )}
        <div>
          {/* 2.2.1: an absolute date and time, not a countdown. A ticking clock
              on a page a renter may leave open is a time limit they cannot
              pause, and it reads as pressure rather than information. */}
          <dt className="text-muted-foreground text-sm">{t('res.holdUntil')}</dt>
          <dd className="font-medium">
            {formatWhen(reservation.expiresAt, facility.timezone, locale)}
          </dd>
        </div>
      </dl>

      <p className="text-muted-foreground mt-6 text-sm text-pretty">
        {t('res.reassureBefore')}{' '}
        <a
          href={`tel:${facility.phone ?? SITE.phone.href}`}
          className="underline underline-offset-4"
        >
          {facility.phone ?? SITE.phone.display}
        </a>{' '}
        {t('res.reassureAfter')}
      </p>

      {live && (
        <section aria-labelledby="continue" className="mt-10">
          <h2 id="continue" className="text-xl font-medium">
            {t('res.readyHeading')}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">{t('res.readyBody')}</p>
          <AdminForm
            action={completeMoveInFromReservationAction}
            label={t('res.completeMoveIn')}
            className="mt-3"
          >
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
            >
              {t('res.completeMoveIn')}
            </button>
          </AdminForm>
        </section>
      )}

      {live && (
        <section aria-labelledby="cancel" className="mt-10">
          <h2 id="cancel" className="text-xl font-medium">
            {t('res.cancelHeading')}
          </h2>
          {/* 3.3.4 Error Prevention. The link in the email is a GET, and a mail
              client that prefetches links must not release someone's unit — so
              arriving here cancels nothing. Cancelling is this explicit POST,
              on a page that first shows what is about to be given up. */}
          <p className="text-muted-foreground mt-2 text-sm text-pretty">{t('res.cancelBody')}</p>
          <AdminForm action={cancelReservationAction} label={t('res.cancelButton')} className="mt-3">
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
            >
              {t('res.cancelButton')}
            </button>
          </AdminForm>
        </section>
      )}
    </div>
  )
}
