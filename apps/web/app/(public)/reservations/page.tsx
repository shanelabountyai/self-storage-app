import { LocaleLink } from '@/components/site/locale-link'
import { formatRate } from '@/lib/format'
import { SITE } from '@/lib/site-config'
import { reservationByToken } from '@/lib/reservations/reserve'
import { cancelReservationAction, completeMoveInFromReservationAction } from './actions'
import { AdminForm } from '@/components/admin/form'

export const metadata = {
  title: 'Your reservation',
  // A page reachable only with a token has no business in an index.
  robots: { index: false, follow: false },
}

// PRD 01 US-401 / FR-3.2. The confirmation screen, and the page the cancel link
// in the email lands on. One page for both: the renter needs to see what they
// are cancelling before they cancel it.

function formatWhen(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatDay(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

export default async function ReservationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; new?: string }>
}) {
  const { token, new: isNew } = await searchParams
  const reservation = token ? await reservationByToken(token) : null

  if (!reservation) {
    // Unknown token and expired-link look identical on purpose — a guesser
    // learns nothing from the difference, and the renter's next step is the
    // same either way (§6.7: name the problem, then offer a human).
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          This link isn&apos;t good any more
        </h1>
        <p className="mt-4 text-pretty">
          Reservation links stop working once the hold ends or is cancelled. Nothing has been
          charged, and nothing is being held for you.
        </p>
        <p className="mt-4">
          <a href={`tel:${SITE.phone.href}`} className="font-medium underline underline-offset-4">
            Call {SITE.phone.display}
          </a>{' '}
          <span className="text-muted-foreground">
            and we will tell you what is available, or{' '}
          </span>
          <LocaleLink href="/storage/search" className="underline underline-offset-4">
            search again
          </LocaleLink>
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
        {isNew ? 'Your unit is reserved' : 'Your reservation'}
      </h1>

      {/* Where the outcome of cancelling is reported. The cancel form and its
          own status region are gone by the time this renders — the form only
          exists while the hold is live — so the announcement has to live here,
          on the state that replaced it. Safe as a live region because this
          arrives with a full page render after a POST, not as a node inserted
          mid-interaction. */}
      {!live && (
        <p role="status" className="border-input mt-4 rounded-md border p-3 text-pretty">
          This reservation is <strong>{reservation.status}</strong>. Nothing is being held for you
          and nothing has been charged — the unit is back available for anyone to take.
        </p>
      )}

      <dl className="mt-6 flex flex-col gap-3">
        <div>
          <dt className="text-muted-foreground text-sm">Facility</dt>
          <dd className="font-medium">
            {facility.name} — {facility.city}, {facility.state}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm">Unit</dt>
          <dd className="font-medium">
            <span aria-hidden="true">
              {unitType.widthFt}×{unitType.lengthFt}
            </span>
            <span className="sr-only">
              {unitType.widthFt} foot by {unitType.lengthFt} foot
            </span>{' '}
            — {unitType.name}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-sm">Rate we are holding</dt>
          <dd className="font-medium">{formatRate(reservation.quotedRateCents)}/mo</dd>
        </div>
        {reservation.moveInDate && (
          <div>
            <dt className="text-muted-foreground text-sm">Move-in date</dt>
            <dd className="font-medium">{formatDay(reservation.moveInDate, facility.timezone)}</dd>
          </div>
        )}
        <div>
          {/* 2.2.1: an absolute date and time, not a countdown. A ticking clock
              on a page a renter may leave open is a time limit they cannot
              pause, and it reads as pressure rather than information. */}
          <dt className="text-muted-foreground text-sm">We hold it until</dt>
          <dd className="font-medium">{formatWhen(reservation.expiresAt, facility.timezone)}</dd>
        </div>
      </dl>

      <p className="text-muted-foreground mt-6 text-sm text-pretty">
        Nothing has been charged. You can move in online before the hold ends, or just turn up —
        call{' '}
        <a
          href={`tel:${facility.phone ?? SITE.phone.href}`}
          className="underline underline-offset-4"
        >
          {facility.phone ?? SITE.phone.display}
        </a>{' '}
        if anything changes.
      </p>

      {live && (
        <section aria-labelledby="continue" className="mt-10">
          <h2 id="continue" className="text-xl font-medium">
            Ready to move in?
          </h2>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            Finish online in a few minutes — sign the lease, pay, and get your gate code today.
          </p>
          <AdminForm
            action={completeMoveInFromReservationAction}
            label="Complete move-in online"
            className="mt-3"
          >
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium"
            >
              Complete move-in online
            </button>
          </AdminForm>
        </section>
      )}

      {live && (
        <section aria-labelledby="cancel" className="mt-10">
          <h2 id="cancel" className="text-xl font-medium">
            Need to cancel?
          </h2>
          {/* 3.3.4 Error Prevention. The link in the email is a GET, and a mail
              client that prefetches links must not release someone's unit — so
              arriving here cancels nothing. Cancelling is this explicit POST,
              on a page that first shows what is about to be given up. */}
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            This releases the unit straight away and someone else can take it. You cannot undo it,
            but you can always reserve again if it is still free.
          </p>
          <AdminForm action={cancelReservationAction} label="Cancel this reservation" className="mt-3">
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
            >
              Cancel this reservation
            </button>
          </AdminForm>
        </section>
      )}
    </div>
  )
}
