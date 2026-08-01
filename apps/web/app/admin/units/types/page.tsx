import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { listUnitTypes } from '@/lib/admin/unit-types'
import { currentRatesForFacility, rateHistoryForUnitType } from '@/lib/pricing/unit-type-rates'
import { formatCents } from '@/lib/format'
import { createUnitTypeAction, updateUnitTypeAction, cloneUnitTypeAction, publishRateAction } from './actions'

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
      {/* Rates only appear when creating: they become the type's first
          effective-dated row. Changing a price later is publishing a new row
          (US-9), which is the Rates column on each row below — not an edit
          here, which would rewrite history. */}
      {!unitType && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Street rate ($/mo)
            <input
              name="streetRateDollars"
              type="number"
              step="0.01"
              min="0"
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
              required
              className="border-input bg-background h-9 w-28 rounded-md border px-2"
            />
          </label>
        </>
      )}
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

// PRD 02 US-6 (unit types) and US-9 (street rates). Door type is deliberately
// not managed here — see the note in lib/admin/unit-types.ts. Rates are
// effective-dated rows, not columns: the table shows the current one and
// ?rates=<id> opens that type's history.
export default async function AdminUnitTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; rates?: string }>
}) {
  const params = await searchParams
  const { edit } = params
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
  const [unitTypes, rates] = await Promise.all([
    listUnitTypes(facilityId),
    currentRatesForFacility(facilityId),
  ])
  // Rate history for the type being inspected, if any (US-9: history viewable).
  const historyFor = params.rates
  const rateHistory = historyFor ? await rateHistoryForUnitType(historyFor) : []
  const cloneTargets = facilities.filter((f) => f.id !== facilityId)

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-lg font-semibold">{selected.facility.name} unit types</h1>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" className="pb-2 font-normal">Name</th>
            <th scope="col" className="pb-2 font-normal">Dimensions</th>
            <th scope="col" className="pb-2 font-normal">Attributes</th>
            <th scope="col" className="pb-2 font-normal">Street rate</th>
            <th scope="col" className="pb-2 font-normal">Web rate</th>
            <th scope="col" className="pb-2 font-normal">
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
                <th scope="row" className="py-2 text-left font-normal">{unitType.name}</th>
                <td className="py-2">{dimensions(unitType)}</td>
                <td className="py-2">{attributeTags(unitType).join(', ') || '—'}</td>
                <td className="py-2">
                  {rates.get(unitType.id)
                    ? formatCents(rates.get(unitType.id)!.streetRateCents)
                    : <span className="text-muted-foreground">not priced</span>}
                </td>
                <td className="py-2">
                  {rates.get(unitType.id)
                    ? formatCents(rates.get(unitType.id)!.webRateCents)
                    : <span className="text-muted-foreground">not priced</span>}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-3">
                    <Link href={`/admin/units/types?edit=${unitType.id}`} className="underline underline-offset-2">
                      Edit
                    </Link>
                    <Link href={`/admin/units/types?rates=${unitType.id}`} className="underline underline-offset-2">
                      Rates
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
                          Go<span className="sr-only"> — clone {unitType.name} to the selected facility</span>
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

      {historyFor && (
        <section aria-labelledby="rates-heading" className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <h2 id="rates-heading" className="text-base font-medium">
              Rate history — {unitTypes.find((t) => t.id === historyFor)?.name ?? 'unit type'}
            </h2>
            <Link href="/admin/units/types" className="text-sm underline underline-offset-2">Close</Link>
          </div>

          <p className="text-muted-foreground text-xs">
            Publishing a new rate never edits an existing row and never changes an
            existing lease&apos;s rent (US-9). Future-dated rows take effect on their own date.
          </p>

          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="pb-1 font-normal">Effective from</th>
                <th scope="col" className="pb-1 font-normal">Street</th>
                <th scope="col" className="pb-1 font-normal">Web</th>
                <th scope="col" className="pb-1 font-normal">State</th>
              </tr>
            </thead>
            <tbody>
              {rateHistory.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="py-1">{row.effectiveFrom.toISOString().slice(0, 10)}</td>
                  <td className="py-1">{formatCents(row.streetRateCents)}</td>
                  <td className="py-1">{formatCents(row.webRateCents)}</td>
                  <td className="py-1 text-xs capitalize">{row.state}</td>
                </tr>
              ))}
              {rateHistory.length === 0 && (
                <tr><td colSpan={4} className="text-muted-foreground py-1 text-xs">No rates yet.</td></tr>
              )}
            </tbody>
          </table>

          <form action={publishRateAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="facilityId" value={facilityId} />
            <input type="hidden" name="unitTypeId" value={historyFor} />
            <label className="flex flex-col gap-1 text-sm">
              Street rate ($/mo)
              <input name="streetRateDollars" type="number" step="0.01" min="0" required className="border-input bg-background h-9 w-28 rounded-md border px-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Web rate ($/mo)
              <input name="webRateDollars" type="number" step="0.01" min="0" required className="border-input bg-background h-9 w-28 rounded-md border px-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Effective from
              <input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required className="border-input bg-background h-9 rounded-md border px-2" />
            </label>
            <Button type="submit">Publish rate</Button>
          </form>
        </section>
      )}

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
