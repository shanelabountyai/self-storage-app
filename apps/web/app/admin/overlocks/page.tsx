import Link from 'next/link'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { overlockReconciliation } from '@/lib/delinquency/overlock-reconciliation'
import { overlockRollup } from '@/lib/admin/rollups'
import { FacilityRollup } from '@/components/admin/facility-rollup'
import { ScrollRegion } from '@/components/ui/scroll-region'

export const metadata = { title: 'Overlocks' }

// PRD 02 §4.6 US-36 (B-060). "A dedicated, always-current list of units that
// *should be* overlocked vs. *confirmed* overlocked (and the removal
// equivalent), reconciling system state with physical state."

const STATE_LABEL: Record<string, string> = {
  awaiting_apply: 'Should be locked — not yet confirmed',
  awaiting_removal: 'Should be removed — still confirmed locked',
  confirmed: 'Locked, steady',
  // B-169. The finding this screen could not previously make. Named for the
  // consequence rather than the mechanism — an operator reads "out of
  // inventory" and knows why it matters.
  stuck_no_lease: 'Locked with no tenant — out of inventory',
}

function formatHours(hours: number): string {
  if (hours < 1) return 'under an hour'
  const whole = Math.round(hours)
  return `${whole} hour${whole === 1 ? '' : 's'}`
}

export default async function OverlocksPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string }>
}) {
  const { facility: facilityParam } = await searchParams
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  // B-235. Drill in from the roll-up without switching the persistent context.
  const requested = facilityParam ? facilities.find((one) => one.id === facilityParam) : undefined
  const selected = requested
    ? { mode: 'single' as const, facility: requested }
    : resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex flex-col gap-4">
        <FacilityRollup heading="Overlocks to reconcile" rows={await overlockRollup(actor)} />
        <p className="text-muted-foreground text-sm">
          Open a facility to reconcile its locks — a lock is on a unit at one site, so there is no
          combined list.
        </p>
      </div>
    )
  }

  const rows = await overlockReconciliation(actor, selected.facility.id)
  const mismatchCount = rows.filter((r) => r.mismatch).length
  const stuckCount = rows.filter((r) => r.state === 'stuck_no_lease').length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Overlocks — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Every unit the delinquency pipeline currently has locked, or has asked to have locked or
          unlocked — system state next to what staff have confirmed on the ground.
        </p>
      </div>

      {/* B-169. Its own banner above the 24-hour one, because it is a
          different problem with a different remedy: these units are not
          rentable and nothing was chasing them. The nightly sweep
          (`delinquency.stuck-overlocks`) queues the removals; this says how
          many are waiting for somebody to walk out. */}
      {stuckCount > 0 && (
        <p role="alert" className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-red-950">
          <span className="font-semibold">
            {stuckCount} {stuckCount === 1 ? 'unit is' : 'units are'} locked with no tenant
          </span>
          <span className="mt-1 block text-sm text-pretty">
            The lease has ended and the lock is still on, so the unit cannot be rented. A removal is
            queued for each of them on{' '}
            <Link href="/admin/tasks?type=overlock_remove" className="underline underline-offset-2">
              the task list
            </Link>
            .
          </span>
        </p>
      )}

      {mismatchCount > 0 && (
        <p role="alert" className="rounded-lg border-2 border-red-500 bg-red-50 p-4 text-red-950">
          <span className="font-semibold">{mismatchCount} mismatched over 24 hours</span>
          <span className="mt-1 block text-sm text-pretty">
            System and physical state disagree, and have for over a day.
          </span>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No live overlocks at this facility.</p>
      ) : (
        <ScrollRegion aria-label="Live overlocks">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="pb-2 font-normal">Unit</th>
                <th scope="col" className="pb-2 font-normal">State</th>
                <th scope="col" className="pb-2 font-normal">Age</th>
                <th scope="col" className="pb-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.overlockId} className="border-t align-middle">
                  <th scope="row" className="py-2 text-left font-medium">{row.unitNumber}</th>
                  <td className="py-2">{STATE_LABEL[row.state]}</td>
                  <td className="py-2">{formatHours(row.ageHours)}</td>
                  <td className="py-2">
                    {/* 1.4.1: text, not a colour swatch. */}
                    {row.mismatch ? (
                      <span className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-900">
                        Mismatch
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">On track</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </div>
  )
}
