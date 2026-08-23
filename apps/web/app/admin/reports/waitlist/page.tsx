import Link from 'next/link'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { waitlistDemand, WAITLIST_CLAIM_WINDOW_HOURS } from '@/lib/waitlist/admin'

export const metadata = { title: 'Waitlist' }

// PRD 01 §9 Phase 3 (B-090 part 1). The waitlist as demand, not as a mailing list.
//
// The reason this is a report rather than a queue of people to work: nothing
// here is a task. The sweep writes to everybody the moment a unit frees up, so
// an operator never has to act on a row. What the numbers are FOR is the
// decision underneath — nine people waiting on a 10×20 that is permanently
// full is the case for raising its street rate, converting a size, or building
// more of them, and it is the only demand signal this product has for
// inventory that does not exist. B-088 part 1's rate suggestions read
// occupancy, which can only say a site is full; this says how full.

export const dynamic = 'force-dynamic'

function formatSince(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string }>
}) {
  const { facility: facilityParam } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()

  if (!hasPermissionAnywhere(actor, ['reports:operational'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to reports.</p>
  }

  const requested = facilityParam ? facilities.find((f) => f.id === facilityParam) : undefined
  const selected = requested
    ? { mode: 'single' as const, facility: requested }
    : resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">Waitlist</h1>
        <p className="text-muted-foreground text-sm">
          Choose a single facility in the switcher above — a waitlist is about one site&apos;s
          inventory.
        </p>
      </div>
    )
  }

  const rows = await waitlistDemand(selected.facility.id)
  const totalWaiting = rows.reduce((total, row) => total + row.waiting, 0)

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Waitlist — {selected.facility.name}</h1>
        <Link href="/admin/reports" className="text-sm underline underline-offset-2">
          All reports
        </Link>
      </div>

      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        People who asked to be emailed when a size comes free. Nobody here needs calling for the
        sweep to work — when a unit becomes available we email as many people as there are units,
        oldest first, and give them {WAITLIST_CLAIM_WINDOW_HOURS} hours before telling the next
        person. These numbers are demand for inventory you don&apos;t have, and each size&apos;s
        contact details are listed below it if you want to call somebody yourself.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm">
          Nobody is waiting for a size at this facility. The form only appears on sizes that are
          fully rented, so an empty list usually means there is something available in every size.
        </p>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">People waiting</dt>
              <dd className="text-lg font-medium tabular-nums">{totalWaiting}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sizes with a queue</dt>
              <dd className="text-lg font-medium tabular-nums">{rows.length}</dd>
            </div>
          </dl>

          <div tabIndex={0} className="overflow-x-auto">
            <table className="w-full min-w-2xl border-collapse text-sm">
              <caption className="sr-only">
                Waitlist by unit type, longest queue first
              </caption>
              <thead>
                <tr className="border-input border-b text-left">
                  <th scope="col" className="py-2 pr-4">Size</th>
                  <th scope="col" className="py-2 pr-4">Waiting</th>
                  <th scope="col" className="py-2 pr-4">Been told</th>
                  <th scope="col" className="py-2 pr-4">Free now</th>
                  <th scope="col" className="py-2 pr-4">Longest wait since</th>
                  <th scope="col" className="py-2 pr-4">Contact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.unitTypeId} className="border-input border-b">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">
                      <span aria-hidden="true">
                        {row.widthFt}×{row.lengthFt}
                      </span>
                      <span className="sr-only">
                        {row.widthFt} foot by {row.lengthFt} foot
                      </span>
                      <span className="text-muted-foreground"> · {row.unitTypeName}</span>
                    </th>
                    <td className="py-2 pr-4 font-medium tabular-nums">{row.waiting}</td>
                    <td className="py-2 pr-4 tabular-nums">{row.claiming}</td>
                    <td className="py-2 pr-4 tabular-nums">{row.availableNow}</td>
                    <td className="text-muted-foreground py-2 pr-4">
                      {row.waitingSince ? formatSince(row.waitingSince) : '—'}
                    </td>
                    <td className="py-2 pr-4">
                      {/* Native <details>/<summary> — no client JS needed to
                          keep the report's PII off-screen until asked for. */}
                      <details>
                        <summary className="cursor-pointer text-sm underline underline-offset-2">
                          {row.contacts.length} {row.contacts.length === 1 ? 'person' : 'people'}
                        </summary>
                        <ul className="mt-2 flex flex-col gap-1 text-xs">
                          {row.contacts.map((contact) => (
                            <li key={contact.id}>
                              {contact.name ?? 'No name'} ·{' '}
                              <a href={`mailto:${contact.email}`} className="underline underline-offset-2">
                                {contact.email}
                              </a>
                              {contact.phone && (
                                <>
                                  {' · '}
                                  <a href={`tel:${contact.phone}`} className="underline underline-offset-2">
                                    {contact.phone}
                                  </a>
                                </>
                              )}
                              {contact.status === 'notified' ? ' · notified' : ''}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
