import Link from 'next/link'
import { prisma } from '@storage/db'
import { REASON_CODES, REASON_CODE_LABELS } from '@storage/core/audit'
import { Button } from '@/components/ui/button'
import { UnitsSubnav } from '@/components/admin/units-subnav'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { previewLayoutImport } from '@/lib/admin/unit-layout'
import { applyLayoutImportAction, createUnitAction } from '../actions'

export const metadata = { title: 'Add or import units' }

// B-116 (UX review 2026-08-12 finding 12; D-48). "Add a unit" and "Import
// layout" moved off /admin/units, which somebody opens dozens of times a day
// to work the inventory. Both are once-per-facility setup jobs — most sites
// never touch this page again after the units exist — and they used to sit
// BELOW the bulk-edit section on the screen a manager actually works from.

export default async function AdminUnitsSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string; layout?: string }>
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
        <p className="text-muted-foreground text-sm">
          Open a facility to add or import its units — a unit belongs to one site.
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
  const unitTypes = await prisma.unitType.findMany({
    where: { facilityId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  const layoutPlan = params.layout ? await previewLayoutImport(actor, facilityId, params.layout) : null

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <UnitsSubnav />

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{selected.facility.name} — add or import units</h1>
        <Link href="/admin/units" className="text-sm underline underline-offset-2">
          Back to inventory
        </Link>
      </div>

      <section aria-labelledby="add-heading" className="flex flex-col gap-3">
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
          {/* One unbreakable token, so it pushed the page sideways at phone
              width until `break-all` let it wrap (1.4.10). */}
          <code className="break-all">{`[{"number":"A-1","unitTypeName":"10x10","building":"A","floor":1}]`}</code>
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
