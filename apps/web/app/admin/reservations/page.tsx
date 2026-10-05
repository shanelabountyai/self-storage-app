import { AdminForm } from '@/components/admin/form'
import { Alert } from '@/components/ui/alert'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { ScrollRegion } from '@/components/ui/scroll-region'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { listHeldReservations } from '@/lib/admin/reservations'
import { can } from '@/lib/rbac/authorize'
import { formatCents } from '@/lib/format'
import { cancelHoldAction, startMoveInFromReservationAction } from './actions'

export const metadata = { title: 'Reservations' }

// PRD 02 US-14 "AC (the counter can see who is coming)" (B-434). Every held
// reservation at one facility, today's arrivals first.

const BUTTON =
  'border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-semibold'

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; gone?: string }>
}) {
  const { q, gone } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Reservations</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          Choose a single facility in the switcher above. A renter arrives at one counter, so this
          screen needs to know which.
        </p>
      </div>
    )
  }
  const { id: facilityId, name: facilityName, timezone } = selected.facility
  const rows = await listHeldReservations(actor, facilityId, q)
  const mayMoveIn = can(actor, 'leases:move_in', facilityId)
  const day = new Intl.DateTimeFormat('en-US', { timeZone: timezone, dateStyle: 'medium' })
  const dayTime = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Reservations — {facilityName}</h1>

      {gone && (
        <Alert tone="warning">
          That hold is no longer live, or its size has nothing left to rent. Check the list below.
        </Alert>
      )}

      <form method="GET" role="search" className="flex flex-wrap items-end gap-2">
        <label htmlFor="q" className="flex flex-col gap-1 text-sm">
          Find a reservation — name, phone or email
          <input
            id="q"
            name="q"
            defaultValue={q ?? ''}
            className="border-input bg-background h-11 w-72 rounded-md border px-2"
          />
        </label>
        <button type="submit" className={BUTTON}>
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState>
          {q ? <>No held reservation matches &ldquo;{q}&rdquo;.</> : 'Nobody is holding a unit here.'}
        </EmptyState>
      ) : (
        <ScrollRegion aria-label="Held reservations">
          <DataTable className="min-w-max">
            <caption className="sr-only">
              Held reservations at {facilityName}, today&apos;s arrivals first
            </caption>
            <DataTable.Head>
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                <th scope="col" className="px-3 py-2 font-semibold">Phone</th>
                <th scope="col" className="px-3 py-2 font-semibold">Size</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Held rate</th>
                <th scope="col" className="px-3 py-2 font-semibold">Move-in</th>
                <th scope="col" className="px-3 py-2 font-semibold">Held until</th>
                <th scope="col" className="px-3 py-2 font-semibold">Source</th>
                {mayMoveIn && <th scope="col" className="px-3 py-2 font-semibold">Action</th>}
              </tr>
            </DataTable.Head>
            <tbody>
              {rows.map((row) => (
                <DataTable.Row key={row.id} id={`reservation-${row.id}`} className="h-auto align-top">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {row.name}
                    <span className="text-muted-foreground block text-xs font-normal">{row.email}</span>
                  </th>
                  <td className="px-3 py-2">
                    {row.phone ? (
                      <a href={`tel:${row.phone}`} className="underline underline-offset-2">
                        {row.phone}
                      </a>
                    ) : (
                      'None given'
                    )}
                  </td>
                  <td className="px-3 py-2">{row.sizeName}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatCents(row.quotedRateCents)}/mo
                  </td>
                  <td className="px-3 py-2">
                    {row.moveInDate ? day.format(row.moveInDate) : 'No date'}
                    {/* 1.4.1: words, never a colour. */}
                    {row.arrivingToday && <span className="block text-xs font-medium">Arriving today</span>}
                  </td>
                  <td className="px-3 py-2">{dayTime.format(row.expiresAt)}</td>
                  <td className="px-3 py-2">{row.source.replace('_', ' ')}</td>
                  {mayMoveIn && (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-start gap-2">
                        <form action={startMoveInFromReservationAction}>
                          <input type="hidden" name="reservationId" value={row.id} />
                          <button type="submit" className={BUTTON}>
                            Start move-in<span className="sr-only"> for {row.name}</span>
                          </button>
                        </form>
                        <AdminForm action={cancelHoldAction} label={`Cancel hold for ${row.name}`}>
                          <input type="hidden" name="reservationId" value={row.id} />
                          <input type="hidden" name="name" value={row.name} />
                          <input type="hidden" name="size" value={row.sizeName} />
                          <button type="submit" className={BUTTON}>
                            Cancel hold<span className="sr-only"> for {row.name}</span>
                          </button>
                        </AdminForm>
                      </div>
                    </td>
                  )}
                </DataTable.Row>
              ))}
            </tbody>
          </DataTable>
        </ScrollRegion>
      )}
    </div>
  )
}
