import Link from 'next/link'
import { prisma } from '@storage/db'
import { UNRENTABLE_REASONS, UNRENTABLE_REASON_LABELS } from '@storage/core/inventory'
import { AdminForm, Field } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { ScrollRegion } from '@/components/ui/scroll-region'
import { getSwitcherData } from '@/lib/admin/context'
import { getUnrentableLimits, listUnrentableUnits } from '@/lib/admin/unrentable'
import { can } from '@/lib/rbac/authorize'
import { formatCents } from '@/lib/format'
import { markUnrentableAction } from '../actions'

export const metadata = { title: 'Unrentable units' }

// PRD 02 US-8 "AC (unrentable says why)" (B-433). Every unit taken off sale by
// hand, across every facility the reader can see, longest first, with what it
// has cost at today's street rate. `?unit=` opens the form that sets one.

const day = (date: Date) => date.toISOString().slice(0, 10)

export default async function UnrentableUnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>
}) {
  const { unit: unitId } = await searchParams
  const { actor, facilities } = await getSwitcherData()

  const [rows, limits, unit] = await Promise.all([
    listUnrentableUnits(actor, facilities.map((facility) => facility.id)),
    getUnrentableLimits(),
    unitId
      ? prisma.unit.findUnique({
          where: { id: unitId },
          select: {
            id: true,
            number: true,
            facilityId: true,
            unrentableReason: true,
            unrentableNote: true,
            unrentableReviewAt: true,
            facility: { select: { name: true } },
          },
        })
      : null,
  ])
  const editing = unit && can(actor, 'units:edit', unit.facilityId) ? unit : null
  const mayExceed = editing ? can(actor, 'units:unrentable_override', editing.facilityId) : false
  const totalLost = rows.reduce((sum, row) => sum + (row.rentLostCents ?? 0), 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Unrentable units</h1>
        <Link href="/admin/units" className="text-sm underline underline-offset-2">
          All units
        </Link>
      </div>

      {editing && (
        <section aria-labelledby="mark-heading" className="border-input flex max-w-xl flex-col gap-3 rounded-lg border p-4">
          <h2 id="mark-heading" className="text-base font-medium">
            Mark {editing.number} unrentable — {editing.facility.name}
          </h2>
          <AdminForm
            action={markUnrentableAction}
            label={`Mark ${editing.number} unrentable`}
            className="flex flex-col gap-3"
          >
            <input type="hidden" name="facilityId" value={editing.facilityId} />
            <input type="hidden" name="unitId" value={editing.id} />
            <Field name="reason" label="Reason" as="select" required defaultValue={editing.unrentableReason ?? ''}>
              <option value="">Choose a reason</option>
              {UNRENTABLE_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {UNRENTABLE_REASON_LABELS[reason]}
                </option>
              ))}
            </Field>
            <Field
              name="note"
              label="Note"
              type="text"
              required
              defaultValue={editing.unrentableNote ?? ''}
              hint="What is wrong, or who is using it."
            />
            <Field
              name="reviewAt"
              label="Review by"
              type="date"
              required={!mayExceed}
              defaultValue={editing.unrentableReviewAt ? day(editing.unrentableReviewAt) : ''}
              hint={
                mayExceed
                  ? 'The day somebody looks at this unit again. Leave it empty to hold the unit with no date.'
                  : `The day somebody looks at this unit again, within ${limits.maxDays} days of it going unrentable. Later needs a district manager, and so does more than ${limits.maxUnits} unrentable units at one facility.`
              }
            />
            <div>
              <Button type="submit">Mark unrentable</Button>
            </div>
          </AdminForm>
        </section>
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No unit is marked unrentable.</p>
      ) : (
        <>
          <p className="text-sm">
            {rows.length} {rows.length === 1 ? 'unit' : 'units'}, {formatCents(totalLost)} of rent not
            collected at today&apos;s street rates.
          </p>
          <ScrollRegion aria-label="Unrentable units">
            <DataTable className="min-w-max">
              <DataTable.Head>
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Unit</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Facility</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Reason</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Set</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Days</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Rent lost</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Review by</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Action</th>
                </tr>
              </DataTable.Head>
              <tbody>
                {rows.map((row) => (
                  <DataTable.Row key={row.unitId} className="h-auto align-top">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {row.number}
                      <span className="text-muted-foreground block text-xs font-normal">{row.unitTypeName}</span>
                    </th>
                    <td className="px-3 py-2">{row.facilityName}</td>
                    <td className="px-3 py-2">
                      {row.reason ? UNRENTABLE_REASON_LABELS[row.reason] : 'No reason recorded'}
                      {row.note && <span className="text-muted-foreground block max-w-xs text-xs">{row.note}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {row.setAt ? day(row.setAt) : 'Not recorded'}
                      {row.setByName && <span className="text-muted-foreground block text-xs">{row.setByName}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.days ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.rentLostCents === null ? '—' : formatCents(row.rentLostCents)}
                    </td>
                    <td className="px-3 py-2">
                      {row.reviewAt ? day(row.reviewAt) : 'No date'}
                      {/* 1.4.1: words, never a colour. */}
                      {row.overdue && <span className="block text-xs font-medium">Review overdue</span>}
                    </td>
                    <td className="px-3 py-2">
                      {row.canEdit && (
                        <Link href={`/admin/units/unrentable?unit=${row.unitId}`} className="underline underline-offset-2">
                          Update<span className="sr-only"> {row.number} at {row.facilityName}</span>
                        </Link>
                      )}
                    </td>
                  </DataTable.Row>
                ))}
              </tbody>
            </DataTable>
          </ScrollRegion>
          <p className="text-muted-foreground max-w-prose text-xs text-pretty">
            To put a unit back on sale, set its status on the units screen.
          </p>
        </>
      )}
    </div>
  )
}
