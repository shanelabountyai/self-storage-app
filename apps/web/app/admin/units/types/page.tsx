import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { listUnitTypes } from '@/lib/admin/unit-types'
import { formatCents } from '@/lib/format'
import { createUnitTypeAction, updateUnitTypeAction, cloneUnitTypeAction } from './actions'

type UnitTypeRow = Awaited<ReturnType<typeof listUnitTypes>>[number]

function dimensions(unitType: UnitTypeRow): string {
  const base = `${unitType.widthFt}×${unitType.lengthFt}`
  return unitType.heightFt ? `${base}×${unitType.heightFt} ft` : `${base} ft`
}

function attributeTags(unitType: UnitTypeRow): string[] {
  const tags: string[] = []
  if (unitType.climateControlled) tags.push('Climate')
  if (unitType.driveUp) tags.push('Drive-up')
  if (unitType.powerAvailable) tags.push('Power')
  return tags
}

function UnitTypeFields({ unitType }: { unitType?: UnitTypeRow }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input
          name="name"
          defaultValue={unitType?.name}
          required
          placeholder="10x10 Climate"
          className="border-input bg-background h-9 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Width (ft)
        <input
          name="widthFt"
          type="number"
          min="1"
          defaultValue={unitType?.widthFt}
          required
          className="border-input bg-background h-9 w-24 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Length (ft)
        <input
          name="lengthFt"
          type="number"
          min="1"
          defaultValue={unitType?.lengthFt}
          required
          className="border-input bg-background h-9 w-24 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Height (ft, optional)
        <input
          name="heightFt"
          type="number"
          min="1"
          defaultValue={unitType?.heightFt ?? ''}
          className="border-input bg-background h-9 w-24 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Floor
        <input
          name="floor"
          type="number"
          min="1"
          defaultValue={unitType?.floor ?? 1}
          required
          className="border-input bg-background h-9 w-20 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Street rate ($/mo)
        <input
          name="streetRateDollars"
          type="number"
          step="0.01"
          min="0"
          defaultValue={unitType ? (unitType.streetRateCents / 100).toFixed(2) : undefined}
          required
          className="border-input bg-background h-9 w-28 rounded-md border px-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Web rate ($/mo)
        <input
          name="webRateDollars"
          type="number"
          step="0.01"
          min="0"
          defaultValue={unitType ? (unitType.webRateCents / 100).toFixed(2) : undefined}
          required
          className="border-input bg-background h-9 w-28 rounded-md border px-2"
        />
      </label>
      <label className="col-span-full flex flex-col gap-1 text-sm">
        Description
        <input
          name="description"
          defaultValue={unitType?.description ?? ''}
          className="border-input bg-background h-9 rounded-md border px-2"
        />
      </label>
      <div className="col-span-full flex gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="climateControlled" defaultChecked={unitType?.climateControlled} />
          Climate controlled
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="driveUp" defaultChecked={unitType?.driveUp} />
          Drive-up
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="powerAvailable" defaultChecked={unitType?.powerAvailable} />
          Power available
        </label>
      </div>
    </>
  )
}

// PRD 02 US-6: manage unit types (dimensions, floor, climate/drive-up/power,
// clonable across facilities). Door type is deliberately not managed here —
// see the note in lib/admin/unit-types.ts. The full unit inventory grid/list
// (B-010) will likely add a tab alongside this; for now "Units" in the nav
// lands here since this is the part that exists.
export default async function AdminUnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>
}) {
  const { edit } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a specific facility above to manage its unit types.
      </p>
    )
  }

  if (!hasPermissionAnywhere(actor, ['units:edit'])) {
    return <p className="text-muted-foreground text-sm">You don&apos;t have access to unit types.</p>
  }

  const facilityId = selected.facility.id
  const unitTypes = await listUnitTypes(facilityId)
  const cloneTargets = facilities.filter((f) => f.id !== facilityId)

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-lg font-semibold">{selected.facility.name} unit types</h1>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th className="pb-2 font-normal">Name</th>
            <th className="pb-2 font-normal">Dimensions</th>
            <th className="pb-2 font-normal">Attributes</th>
            <th className="pb-2 font-normal">Street rate</th>
            <th className="pb-2 font-normal">Web rate</th>
            <th className="pb-2 font-normal">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {unitTypes.map((unitType) =>
            edit === unitType.id ? (
              <tr key={unitType.id}>
                <td colSpan={6} className="py-3">
                  <form
                    action={updateUnitTypeAction}
                    className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-4"
                  >
                    <input type="hidden" name="facilityId" value={facilityId} />
                    <input type="hidden" name="unitTypeId" value={unitType.id} />
                    <UnitTypeFields unitType={unitType} />
                    <div className="col-span-full flex gap-2">
                      <Button type="submit">Save</Button>
                      <Button type="button" variant="outline" asChild>
                        <Link href="/admin/units/types">Cancel</Link>
                      </Button>
                    </div>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={unitType.id} className="border-t">
                <td className="py-2">{unitType.name}</td>
                <td className="py-2">{dimensions(unitType)}</td>
                <td className="py-2">{attributeTags(unitType).join(', ') || '—'}</td>
                <td className="py-2">{formatCents(unitType.streetRateCents)}</td>
                <td className="py-2">{formatCents(unitType.webRateCents)}</td>
                <td className="py-2">
                  <div className="flex items-center gap-3">
                    <Link href={`/admin/units/types?edit=${unitType.id}`} className="underline underline-offset-2">
                      Edit
                    </Link>
                    {cloneTargets.length > 0 && (
                      <form action={cloneUnitTypeAction} className="inline-flex items-center gap-1">
                        <input type="hidden" name="unitTypeId" value={unitType.id} />
                        <label className="sr-only" htmlFor={`clone-target-${unitType.id}`}>
                          Clone {unitType.name} to facility
                        </label>
                        <select
                          id={`clone-target-${unitType.id}`}
                          name="targetFacilityId"
                          defaultValue=""
                          className="border-input bg-background h-8 rounded-md border px-1 text-xs"
                        >
                          <option value="" disabled>
                            Clone to…
                          </option>
                          {cloneTargets.map((facility) => (
                            <option key={facility.id} value={facility.id}>
                              {facility.name}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="text-xs underline underline-offset-2">
                          Go
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      <section aria-labelledby="new-type-heading" className="flex flex-col gap-3">
        <h2 id="new-type-heading" className="text-base font-medium">
          Add a unit type
        </h2>
        <form action={createUnitTypeAction} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <input type="hidden" name="facilityId" value={facilityId} />
          <UnitTypeFields />
          <div className="col-span-full">
            <Button type="submit">Add unit type</Button>
          </div>
        </form>
      </section>
    </div>
  )
}
