import Link from 'next/link'
import { prisma } from '@storage/db'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { markReadyToRentAction } from './actions'

export const metadata = { title: 'Units awaiting check' }

// PRD 02 US-14's "verified empty and clean". A unit released by a move-out
// lands in `maintenance`, and this is the confirmation that puts it back on
// sale — deliberately a separate, later act by a human who opened the door.
//
// The units screen can also make a unit available directly, with a reason
// code; this page exists because that is a general status override, and the
// AC asks for a named confirmation that someone actually checked.

export default async function UnitsReadyPage() {
  const { facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">Units awaiting check</h1>
        <p className="text-muted-foreground text-sm">Choose a single facility in the switcher above.</p>
      </div>
    )
  }

  const units = await prisma.unit.findMany({
    where: { facilityId: selected.facility.id, operationalStatus: 'maintenance' },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, unitType: { select: { name: true } } },
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Units awaiting check — {selected.facility.name}</h1>
        <Link href="/admin/units" className="text-sm underline underline-offset-2">
          All units
        </Link>
      </div>

      {units.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing is waiting to be checked. Units released by a move-out appear here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {units.map((unit) => (
            <li
              key={unit.id}
              className="border-input flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
            >
              <span>
                <span className="font-medium">{unit.number}</span>{' '}
                <span className="text-muted-foreground">· {unit.unitType.name}</span>
              </span>
              <form action={markReadyToRentAction}>
                <input type="hidden" name="facilityId" value={selected.facility.id} />
                <input type="hidden" name="unitId" value={unit.id} />
                <button
                  type="submit"
                  className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium"
                >
                  Verified empty and clean
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
