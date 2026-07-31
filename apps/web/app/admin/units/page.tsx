import Link from 'next/link'
import { prisma } from '@storage/db'
import { MANUAL_UNIT_STATUSES } from '@storage/core/inventory'
import { Button } from '@/components/ui/button'
import { UnitStatusBadge } from '@/components/admin/unit-status-badge'
import { UnitsSubnav } from '@/components/admin/units-subnav'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { listUnits, unitGroupings } from '@/lib/admin/units'
import { currentRatesForFacility } from '@/lib/pricing/unit-type-rates'
import { previewBulkOperation, type BulkUnitOperation } from '@/lib/admin/units-bulk'
import { previewLayoutImport } from '@/lib/admin/unit-layout'
import type { UnitFilters } from '@/lib/admin/unit-query'
import { formatCents } from '@/lib/format'
import { applyBulkAction, applyLayoutImportAction, createUnitAction, setUnitStatusAction } from './actions'

const ALL_STATUSES = ['available', 'reserved', 'occupied', 'overlocked', 'maintenance', 'unrentable'] as const

type SearchParams = {
  view?: string
  status?: string
  unitTypeId?: string
  building?: string
  floor?: string
  q?: string
  // Bulk preview is driven by search params so it is a GET — linkable,
  // re-renderable, and impossible to trigger as a side effect.
  op?: string
  opStatus?: string
  opUnitTypeId?: string
  opBuilding?: string
  opFloor?: string
  opDoorType?: string
  layout?: string
}

function filtersFrom(params: SearchParams): UnitFilters {
  return {
    status: (params.status || undefined) as UnitFilters['status'],
    unitTypeId: params.unitTypeId || undefined,
    building: params.building || undefined,
    floor: params.floor ? Number(params.floor) : undefined,
    search: params.q || undefined,
  }
}

function operationFrom(params: SearchParams): BulkUnitOperation | null {
  if (params.op === 'status' && params.opStatus) {
    return { kind: 'status', operationalStatus: params.opStatus as 'available' }
  }
  if (params.op === 'unitType' && params.opUnitTypeId) {
    return { kind: 'unitType', unitTypeId: params.opUnitTypeId }
  }
  if (params.op === 'attributes') {
    return {
      kind: 'attributes',
      ...(params.opBuilding !== undefined && params.opBuilding !== '' && { building: params.opBuilding }),
      ...(params.opFloor !== undefined && params.opFloor !== '' && { floor: Number(params.opFloor) }),
      ...(params.opDoorType !== undefined && params.opDoorType !== '' && { doorType: params.opDoorType }),
    }
  }
  return null
}

// PRD 02 US-5/US-7/US-8. Grid is the MVP fallback for facilities with no
// uploaded floor plan — the interactive map with zoom/pan is P2, per the AC's
// own phasing ("P2: layout editor; MVP: grid view + optional JSON import").
export default async function AdminUnitsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-4">
        <UnitsSubnav />
        <p className="text-muted-foreground text-sm">Pick a specific facility above to manage its units.</p>
      </div>
    )
  }
  if (!hasPermissionAnywhere(actor, ['units:edit'])) {
    return (
      <div className="flex flex-col gap-4">
        <UnitsSubnav />
        <p className="text-muted-foreground text-sm">You don&apos;t have access to units.</p>
      </div>
    )
  }

  const facilityId = selected.facility.id
  const filters = filtersFrom(params)
  const view = params.view === 'grid' ? 'grid' : 'list'

  const [units, groupings, unitTypes, rates] = await Promise.all([
    listUnits(actor, facilityId, filters),
    unitGroupings(facilityId),
    prisma.unitType.findMany({ where: { facilityId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    // Rates resolve from effective-dated history (B-011), not a column.
    currentRatesForFacility(facilityId),
  ])

  const operation = operationFrom(params)
  const preview = operation ? await previewBulkOperation(actor, facilityId, filters, operation) : null
  const layoutPlan = params.layout ? await previewLayoutImport(actor, facilityId, params.layout) : null

  // Grid grouping: building, then floor (US-5 AC).
  const groups = new Map<string, typeof units>()
  for (const unit of units) {
    const key = `${unit.building ?? 'Unassigned'} · Floor ${unit.floor}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(unit)
    else groups.set(key, [unit])
  }

  const hidden = (extra: Record<string, string | undefined>) => ({ ...params, ...extra })
  const linkTo = (extra: Record<string, string | undefined>) => {
    const next = new URLSearchParams()
    for (const [k, v] of Object.entries(hidden(extra))) if (v) next.set(k, v)
    return `/admin/units?${next.toString()}`
  }

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <UnitsSubnav />

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{selected.facility.name} units</h1>
        <div className="flex gap-2 text-sm">
          <Link
            href={linkTo({ view: undefined })}
            aria-current={view === 'list' ? 'page' : undefined}
            className={view === 'list' ? 'font-medium underline underline-offset-2' : 'text-muted-foreground'}
          >
            List
          </Link>
          <Link
            href={linkTo({ view: 'grid' })}
            aria-current={view === 'grid' ? 'page' : undefined}
            className={view === 'grid' ? 'font-medium underline underline-offset-2' : 'text-muted-foreground'}
          >
            Grid
          </Link>
        </div>
      </div>

      {/* Filters — a GET form so the result is a linkable URL, and so the same
          filter drives both the view and any bulk operation below it. */}
      <form method="GET" className="flex flex-wrap items-end gap-3">
        {params.view && <input type="hidden" name="view" value={params.view} />}
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select name="status" defaultValue={params.status ?? ''} className="border-input bg-background h-9 rounded-md border px-2">
            <option value="">Any</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select name="unitTypeId" defaultValue={params.unitTypeId ?? ''} className="border-input bg-background h-9 rounded-md border px-2">
            <option value="">Any</option>
            {unitTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        {groupings.buildings.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            Building
            <select name="building" defaultValue={params.building ?? ''} className="border-input bg-background h-9 rounded-md border px-2">
              <option value="">Any</option>
              {groupings.buildings.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Floor
          <select name="floor" defaultValue={params.floor ?? ''} className="border-input bg-background h-9 rounded-md border px-2">
            <option value="">Any</option>
            {groupings.floors.map((f) => (
              <option key={f} value={String(f)}>{f}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Unit number
          <input name="q" defaultValue={params.q ?? ''} placeholder="A-1" className="border-input bg-background h-9 rounded-md border px-2" />
        </label>
        <Button type="submit" variant="outline">Filter</Button>
        <Link href="/admin/units" className="text-muted-foreground pb-2 text-sm underline underline-offset-2">Clear</Link>
      </form>

      <p className="text-muted-foreground text-sm">
        {units.length} unit{units.length === 1 ? '' : 's'}
        {Object.values(filters).some(Boolean) ? ' matching the filter' : ''}
      </p>

      {view === 'list' ? (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="pb-2 font-normal">Unit</th>
              <th className="pb-2 font-normal">Type</th>
              <th className="pb-2 font-normal">Location</th>
              <th className="pb-2 font-normal">Rate</th>
              <th className="pb-2 font-normal">Status</th>
              <th className="pb-2 font-normal"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => (
              <tr key={unit.id} className="border-t align-middle">
                <td className="py-2 font-medium">{unit.number}</td>
                <td className="py-2">
                  {unit.unitType.name}
                  <span className="text-muted-foreground"> · {unit.unitType.widthFt}×{unit.unitType.lengthFt}</span>
                </td>
                <td className="py-2">{[unit.building, `Floor ${unit.floor}`].filter(Boolean).join(' · ')}</td>
                <td className="py-2">
                  {(() => {
                    const rate = rates.get(unit.unitTypeId)
                    // A type whose only rate starts in the future has no
                    // current price — shown as such rather than as $0.00.
                    return rate ? formatCents(rate.streetRateCents) : <span className="text-muted-foreground">not priced</span>
                  })()}
                </td>
                <td className="py-2"><UnitStatusBadge status={unit.status} /></td>
                <td className="py-2">
                  {/* Only the three manual statuses are offered — the derived
                      ones are not a human's to set (US-8), so they never
                      appear as an option rather than failing on submit. */}
                  <form action={setUnitStatusAction} className="inline-flex items-center gap-1">
                    <input type="hidden" name="facilityId" value={facilityId} />
                    <input type="hidden" name="unitId" value={unit.id} />
                    <label className="sr-only" htmlFor={`status-${unit.id}`}>Set {unit.number} status</label>
                    <select
                      id={`status-${unit.id}`}
                      name="operationalStatus"
                      defaultValue={unit.operationalStatus}
                      className="border-input bg-background h-8 rounded-md border px-1 text-xs"
                    >
                      {MANUAL_UNIT_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button type="submit" className="text-xs underline underline-offset-2">Set</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex flex-col gap-6">
          {[...groups.entries()].map(([label, groupUnits]) => (
            <section key={label} aria-labelledby={`group-${label}`}>
              <h2 id={`group-${label}`} className="mb-2 text-sm font-medium">{label}</h2>
              <ul className="flex flex-wrap gap-2">
                {groupUnits.map((unit) => (
                  <li key={unit.id}>
                    {/* Each tile carries number, type and status as text —
                        colour alone never conveys the state (WCAG 1.4.1). */}
                    <div className="w-28 rounded-md border p-2">
                      <p className="truncate text-sm font-medium">{unit.number}</p>
                      <p className="text-muted-foreground truncate text-xs">{unit.unitType.name}</p>
                      <UnitStatusBadge status={unit.status} className="mt-1" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {groups.size === 0 && <p className="text-muted-foreground text-sm">No units match.</p>}
        </div>
      )}

      <section aria-labelledby="bulk-heading" className="flex flex-col gap-3 border-t pt-6">
        <h2 id="bulk-heading" className="text-base font-medium">Bulk edit</h2>
        <p className="text-muted-foreground text-xs">
          Applies to the {units.length} unit{units.length === 1 ? '' : 's'} currently filtered above.
          Preview first — blocked units are skipped and listed with a reason.
        </p>

        <form method="GET" className="flex flex-wrap items-end gap-3">
          {Object.entries({ view: params.view, status: params.status, unitTypeId: params.unitTypeId, building: params.building, floor: params.floor, q: params.q })
            .filter(([, v]) => v)
            .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="flex flex-col gap-1 text-sm">
            Change
            <select name="op" defaultValue={params.op ?? 'status'} className="border-input bg-background h-9 rounded-md border px-2">
              <option value="status">Status</option>
              <option value="unitType">Unit type</option>
              <option value="attributes">Building / floor</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            To status
            <select name="opStatus" defaultValue={params.opStatus ?? 'available'} className="border-input bg-background h-9 rounded-md border px-2">
              {MANUAL_UNIT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            To type
            <select name="opUnitTypeId" defaultValue={params.opUnitTypeId ?? ''} className="border-input bg-background h-9 rounded-md border px-2">
              <option value="">—</option>
              {unitTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            To building
            <input name="opBuilding" defaultValue={params.opBuilding ?? ''} className="border-input bg-background h-9 w-28 rounded-md border px-2" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            To floor
            <input name="opFloor" type="number" min="1" defaultValue={params.opFloor ?? ''} className="border-input bg-background h-9 w-20 rounded-md border px-2" />
          </label>
          <Button type="submit" variant="outline">Preview</Button>
        </form>

        {preview && (
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <p className="text-sm">
              <strong>{preview.applyCount}</strong> will change, <strong>{preview.skipCount}</strong> skipped
              {preview.warningCount > 0 && <>, <strong>{preview.warningCount}</strong> with warnings</>}.
              {preview.truncated && (
                <span className="text-muted-foreground"> Showing the first {preview.rows.length} of {preview.matchedTotal} matches.</span>
              )}
            </p>

            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-1 font-normal">Unit</th>
                  <th className="pb-1 font-normal">Outcome</th>
                  <th className="pb-1 font-normal">Detail</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.unitId} className="border-t">
                    <td className="py-1 font-medium">{row.number}</td>
                    <td className="py-1">{row.outcome === 'apply' ? 'Will change' : 'Skipped'}</td>
                    <td className="py-1">
                      {row.outcome === 'apply' ? `${row.from} → ${row.to}` : row.skipReason}
                      {row.warning && <span className="block text-yellow-700 dark:text-yellow-400">{row.warning}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {preview.applyCount > 0 && (
              <form action={applyBulkAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="facilityId" value={facilityId} />
                <input type="hidden" name="filterStatus" value={params.status ?? ''} />
                <input type="hidden" name="filterUnitTypeId" value={params.unitTypeId ?? ''} />
                <input type="hidden" name="filterBuilding" value={params.building ?? ''} />
                <input type="hidden" name="filterFloor" value={params.floor ?? ''} />
                <input type="hidden" name="filterSearch" value={params.q ?? ''} />
                <input type="hidden" name="operationKind" value={params.op ?? 'status'} />
                <input type="hidden" name="operationalStatus" value={params.opStatus ?? ''} />
                <input type="hidden" name="targetUnitTypeId" value={params.opUnitTypeId ?? ''} />
                <input type="hidden" name="targetBuilding" value={params.opBuilding ?? ''} />
                <input type="hidden" name="targetFloor" value={params.opFloor ?? ''} />
                <label className="flex flex-col gap-1 text-sm">
                  Reason
                  <input name="reasonCode" defaultValue="management_approval" required className="border-input bg-background h-9 rounded-md border px-2" />
                </label>
                <Button type="submit">Apply to {preview.applyCount}</Button>
              </form>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="add-heading" className="flex flex-col gap-3 border-t pt-6">
        <h2 id="add-heading" className="text-base font-medium">Add a unit</h2>
        {unitTypes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Create a <Link href="/admin/units/types" className="underline underline-offset-2">unit type</Link> first.
          </p>
        ) : (
          <form action={createUnitAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="facilityId" value={facilityId} />
            <label className="flex flex-col gap-1 text-sm">
              Number
              <input name="number" required className="border-input bg-background h-9 w-28 rounded-md border px-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Type
              <select name="unitTypeId" required className="border-input bg-background h-9 rounded-md border px-2">
                {unitTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Building
              <input name="building" className="border-input bg-background h-9 w-28 rounded-md border px-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Floor
              <input name="floor" type="number" min="1" defaultValue={1} className="border-input bg-background h-9 w-20 rounded-md border px-2" />
            </label>
            <Button type="submit">Add unit</Button>
          </form>
        )}
      </section>

      <section aria-labelledby="import-heading" className="flex flex-col gap-3 border-t pt-6">
        <h2 id="import-heading" className="text-base font-medium">Import layout (JSON)</h2>
        <p className="text-muted-foreground text-xs">
          Creates missing units and updates existing ones, matched by number. Never changes
          occupancy. Example:{' '}
          <code>{`[{"number":"A-1","unitTypeName":"10x10","building":"A","floor":1}]`}</code>
        </p>

        <form method="GET" className="flex flex-col gap-2">
          <label htmlFor="layout" className="sr-only">Layout JSON</label>
          <textarea
            id="layout"
            name="layout"
            rows={4}
            defaultValue={params.layout ?? ''}
            className="border-input bg-background rounded-md border p-2 font-mono text-xs"
          />
          <div><Button type="submit" variant="outline">Preview import</Button></div>
        </form>

        {layoutPlan && (
          <div className="flex flex-col gap-3 rounded-md border p-3">
            {layoutPlan.issues.length > 0 ? (
              <ul className="text-sm text-red-700 dark:text-red-400">
                {layoutPlan.issues.map((issue, i) => (
                  <li key={i}>
                    {issue.index >= 0 ? `Row ${issue.index + 1}: ` : ''}{issue.field} — {issue.message}
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className="text-sm">
                  <strong>{layoutPlan.createCount}</strong> to create, <strong>{layoutPlan.updateCount}</strong> to update
                  {layoutPlan.errorCount > 0 && <>, <strong>{layoutPlan.errorCount}</strong> unresolved</>}.
                </p>
                <ul className="text-xs">
                  {layoutPlan.rows.map((row) => (
                    <li key={row.number} className={row.action === 'error' ? 'text-red-700 dark:text-red-400' : ''}>
                      {row.number}: {row.detail}
                    </li>
                  ))}
                </ul>
                {layoutPlan.errorCount === 0 && (
                  <form action={applyLayoutImportAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="facilityId" value={facilityId} />
                    <input type="hidden" name="layoutJson" value={params.layout ?? ''} />
                    <label className="flex flex-col gap-1 text-sm">
                      Reason
                      <input name="reasonCode" defaultValue="management_approval" required className="border-input bg-background h-9 rounded-md border px-2" />
                    </label>
                    <Button type="submit">Import {layoutPlan.createCount + layoutPlan.updateCount}</Button>
                  </form>
                )}
                {layoutPlan.errorCount > 0 && (
                  <p className="text-muted-foreground text-xs">
                    Nothing is imported until every row resolves — a half-imported layout is
                    worse than none.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
