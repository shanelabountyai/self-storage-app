import Link from 'next/link'
import { prisma } from '@storage/db'
import { MANUAL_UNIT_STATUSES } from '@storage/core/inventory'
import { REASON_CODES, REASON_CODE_LABELS } from '@storage/core/audit'
import { unitStatusLabel } from '@storage/core/labels'
import { Button } from '@/components/ui/button'
import { UnitStatusBadge } from '@/components/admin/unit-status-badge'
import { UnitsSubnav } from '@/components/admin/units-subnav'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { listUnits, unitGroupings } from '@/lib/admin/units'
import { unitRollup } from '@/lib/admin/rollups'
import { FacilityRollup } from '@/components/admin/facility-rollup'
import { currentRatesForFacility } from '@/lib/pricing/unit-type-rates'
import { previewBulkOperation, type BulkUnitOperation } from '@/lib/admin/units-bulk'
import type { UnitFilters } from '@/lib/admin/unit-query'
import { formatCents } from '@/lib/format'
import { applyBulkAction, setUnitStatusAction } from './actions'
import { ScrollRegion } from '@/components/ui/scroll-region'

// B-169. A unit reading `overlocked` with nobody in it is not a tenant behind
// on rent — it is a lock left on after the lease ended, and it is out of
// sellable inventory until somebody walks out and cuts it off. The board showed
// it as plain `overlocked`, which reads as the ordinary delinquency case, so
// nothing on this screen said the unit was unrentable for a reason nobody was
// chasing. Derived from two facts the row already carries rather than a fifth
// query.
function stuckLock(unit: { status: string; occupant: unknown }): boolean {
  return unit.status === 'overlocked' && !unit.occupant
}

const STUCK_LOCK_HREF = '/admin/tasks?type=overlock_remove'

const ALL_STATUSES = ['available', 'reserved', 'occupied', 'overlocked', 'maintenance', 'unrentable'] as const

type SearchParams = {
  /// B-113: lets the all-facilities roll-up link into one site without changing
  /// the switcher's persistent choice.
  facility?: string
  view?: string
  status?: string
  unitTypeId?: string
  building?: string
  floor?: string
  q?: string
  page?: string
  // Bulk preview is driven by search params so it is a GET — linkable,
  // re-renderable, and impossible to trigger as a side effect.
  op?: string
  opStatus?: string
  opUnitTypeId?: string
  opBuilding?: string
  opFloor?: string
  opDoorType?: string
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
  const requested = params.facility ? facilities.find((f) => f.id === params.facility) : undefined
  const selected = requested
    ? { mode: 'single' as const, facility: requested }
    : resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-4">
        <UnitsSubnav />
        <FacilityRollup heading="Across your facilities" rows={await unitRollup(actor)} />
        <p className="text-muted-foreground text-sm">
          Open a facility to manage its units — a unit belongs to one site.
        </p>
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
  const page = Number.parseInt(params.page ?? '1', 10) || 1

  const [list, groupings, unitTypes, rates] = await Promise.all([
    listUnits(actor, facilityId, filters, { page }),
    unitGroupings(facilityId),
    prisma.unitType.findMany({ where: { facilityId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    // Rates resolve from effective-dated history (B-011), not a column.
    currentRatesForFacility(facilityId),
  ])

  const operation = operationFrom(params)
  const preview = operation ? await previewBulkOperation(actor, facilityId, filters, operation) : null

  // Grid grouping: building, then floor (US-5 AC), over the current PAGE of
  // units — B-116 paginates `listUnits` itself, so both views share one page
  // of rows and one "Showing X–Y of Z" rather than the grid quietly showing
  // more than the list claims exists.
  const groups = new Map<string, typeof list.rows>()
  for (const unit of list.rows) {
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

  const from = list.total > 0 ? (list.page - 1) * list.pageSize + 1 : 0
  const to = Math.min(list.page * list.pageSize, list.total)
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize))

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <UnitsSubnav />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{selected.facility.name} units</h1>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex gap-2">
            <Link
              href={linkTo({ view: undefined, page: undefined })}
              aria-current={view === 'list' ? 'page' : undefined}
              className={view === 'list' ? 'font-medium underline underline-offset-2' : 'text-muted-foreground'}
            >
              List
            </Link>
            <Link
              href={linkTo({ view: 'grid', page: undefined })}
              aria-current={view === 'grid' ? 'page' : undefined}
              className={view === 'grid' ? 'font-medium underline underline-offset-2' : 'text-muted-foreground'}
            >
              Grid
            </Link>
          </div>
          {/* B-116: two once-per-facility setup jobs, off the screen worked
              from every day. */}
          <Link href="/admin/units/setup" className="text-muted-foreground underline underline-offset-2">
            Add or import units
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
              <option key={s} value={s}>{unitStatusLabel(s)}</option>
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

      <p className="text-muted-foreground text-sm" role="status">
        {list.total > 0 ? `Showing ${from}–${to} of ${list.total}` : 'No units'}
        {Object.values(filters).some(Boolean) ? ' matching the filter' : ''}
      </p>

      {view === 'list' ? (
        <ScrollRegion aria-label="Units">
        <table className="hidden w-full min-w-max text-left text-sm sm:table">
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="pb-2 font-normal">Unit</th>
              <th scope="col" className="pb-2 font-normal">Type</th>
              <th scope="col" className="pb-2 font-normal">Location</th>
              <th scope="col" className="pb-2 font-normal">Rate</th>
              <th scope="col" className="pb-2 font-normal">Status</th>
              {/* B-116, UX review finding 12: "who is in B-14?" used to mean
                  leaving this screen for Tenants and searching. */}
              <th scope="col" className="pb-2 font-normal">Tenant</th>
              <th scope="col" className="pb-2 font-normal"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((unit) => (
              <tr key={unit.id} className="border-t align-middle">
                <th scope="row" className="py-2 text-left font-medium">{unit.number}</th>
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
                <td className="py-2">
                  <UnitStatusBadge status={unit.status} />
                  {/* 1.4.1: words, never a colour. */}
                  {stuckLock(unit) && (
                    <Link href={STUCK_LOCK_HREF} className="mt-1 block text-xs underline underline-offset-2">
                      Lock still on, no tenant — not rentable
                    </Link>
                  )}
                </td>
                <td className="py-2">
                  {unit.occupant ? (
                    <Link href={`/admin/tenants/${unit.occupant.tenantId}`} className="underline underline-offset-2">
                      {unit.occupant.tenantName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
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
                    <button type="submit" className="text-xs underline underline-offset-2">
                      Set<span className="sr-only"> status for {unit.number}</span>
                    </button>
                  </form>
                  <Link
                    href={`/admin/maintenance?unit=${unit.id}`}
                    className="ml-2 text-xs underline underline-offset-2"
                  >
                    Report issue<span className="sr-only"> on {unit.number}</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </ScrollRegion>
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
                      {stuckLock(unit) && (
                        <p className="text-xs text-pretty">
                          <Link href={STUCK_LOCK_HREF} className="underline underline-offset-2">
                            Lock on, no tenant
                          </Link>
                        </p>
                      )}
                      {unit.occupant && (
                        <p className="truncate text-xs">
                          <Link href={`/admin/tenants/${unit.occupant.tenantId}`} className="underline underline-offset-2">
                            {unit.occupant.tenantName}
                          </Link>
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {groups.size === 0 && <p className="text-muted-foreground text-sm">No units match.</p>}
        </div>
      )}

      {/* B-116. Below `sm`, the table above is hidden and this card list is
          the only rendering — each unit's actionable controls (the status
          select, the "Report issue" link) turned into one legible card
          instead of a horizontally-scrolled sliver of a six-column table.
          Only for list view; grid view's tiles are already card-shaped. */}
      {view === 'list' && (
        <ul className="flex flex-col gap-3 sm:hidden">
          {list.rows.map((unit) => (
            <li key={unit.id} className="border-input rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{unit.number}</p>
                  <p className="text-muted-foreground text-sm">
                    {unit.unitType.name} · {unit.unitType.widthFt}×{unit.unitType.lengthFt}
                  </p>
                </div>
                <UnitStatusBadge status={unit.status} />
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                {[unit.building, `Floor ${unit.floor}`].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 text-sm">
                {(() => {
                  const rate = rates.get(unit.unitTypeId)
                  return rate ? formatCents(rate.streetRateCents) : <span className="text-muted-foreground">not priced</span>
                })()}
              </p>
              <p className="mt-1 text-sm">
                {unit.occupant ? (
                  <Link href={`/admin/tenants/${unit.occupant.tenantId}`} className="underline underline-offset-2">
                    {unit.occupant.tenantName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Vacant</span>
                )}
              </p>
              {stuckLock(unit) && (
                <p className="mt-1 text-sm text-pretty">
                  <Link href={STUCK_LOCK_HREF} className="underline underline-offset-2">
                    Lock still on with no tenant — not rentable until it comes off
                  </Link>
                </p>
              )}

              <form action={setUnitStatusAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="facilityId" value={facilityId} />
                <input type="hidden" name="unitId" value={unit.id} />
                <label className="sr-only" htmlFor={`status-m-${unit.id}`}>Set {unit.number} status</label>
                <select
                  id={`status-m-${unit.id}`}
                  name="operationalStatus"
                  defaultValue={unit.operationalStatus}
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                >
                  {MANUAL_UNIT_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="border-input hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium"
                >
                  Set status
                </button>
              </form>
              <Link
                href={`/admin/maintenance?unit=${unit.id}`}
                className="mt-2 inline-block text-sm underline underline-offset-2"
              >
                Report issue on {unit.number}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center gap-3 text-sm">
          {list.page > 1 && (
            <Link href={linkTo({ page: String(list.page - 1) })} className="underline underline-offset-2">
              Previous
            </Link>
          )}
          <span className="text-muted-foreground">Page {list.page} of {lastPage}</span>
          {list.page < lastPage && (
            <Link href={linkTo({ page: String(list.page + 1) })} className="underline underline-offset-2">
              Next
            </Link>
          )}
        </nav>
      )}

      <section aria-labelledby="bulk-heading" className="flex flex-col gap-3 border-t pt-6">
        <h2 id="bulk-heading" className="text-base font-medium">Bulk edit</h2>
        <p className="text-muted-foreground text-xs">
          {/* The FULL filtered count, not this page's row count — bulk edit
              itself is never paginated (US-7): it applies to everything the
              filter matches. */}
          Applies to the {list.total} unit{list.total === 1 ? '' : 's'} currently filtered above.
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
              {MANUAL_UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>{unitStatusLabel(s)}</option>
              ))}
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

            <ScrollRegion aria-label="Bulk edit preview">
            <table className="w-full min-w-max text-left text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="pb-1 font-normal">Unit</th>
                  <th scope="col" className="pb-1 font-normal">Outcome</th>
                  <th scope="col" className="pb-1 font-normal">Detail</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.unitId} className="border-t">
                    <th scope="row" className="py-1 text-left font-medium">{row.number}</th>
                    <td className="py-1">{row.outcome === 'apply' ? 'Will change' : 'Skipped'}</td>
                    <td className="py-1">
                      {row.outcome === 'apply' ? `${row.from} → ${row.to}` : row.skipReason}
                      {row.warning && <span className="block text-yellow-700 dark:text-yellow-400">{row.warning}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </ScrollRegion>

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
                {/* A chosen code plus an optional note, not a free-text box
                    pre-filled with `management_approval`. Two things were wrong
                    with the old field: it put a schema identifier in front of an
                    operator as the thing to type, and — because it was free
                    text with a default nobody edits — the audit log filled with
                    one value that means "somebody pressed the button", on an
                    operation that can rewrite the status of every unit at a
                    site. US-38 wants the log filterable; a field with one
                    de-facto value is not. */}
                <label className="flex flex-col gap-1 text-sm">
                  Reason
                  <select
                    name="reasonCode"
                    defaultValue="management_approval"
                    required
                    className="border-input bg-background h-9 rounded-md border px-2"
                  >
                    {REASON_CODES.map((code) => (
                      <option key={code} value={code}>{REASON_CODE_LABELS[code]}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Note <span className="text-muted-foreground text-xs">(optional)</span>
                  <input
                    name="reasonNote"
                    className="border-input bg-background h-9 rounded-md border px-2"
                    placeholder="Anything the code does not capture"
                  />
                </label>
                <Button type="submit">Apply to {preview.applyCount}</Button>
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
