import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { overlockReconciliation } from '@/lib/delinquency/overlock-reconciliation'

export const metadata = { title: 'Overlocks' }

// PRD 02 §4.6 US-36 (B-060). "A dedicated, always-current list of units that
// *should be* overlocked vs. *confirmed* overlocked (and the removal
// equivalent), reconciling system state with physical state."

const STATE_LABEL: Record<string, string> = {
  awaiting_apply: 'Should be locked — not yet confirmed',
  awaiting_removal: 'Should be removed — still confirmed locked',
  confirmed: 'Locked, steady',
}

function formatHours(hours: number): string {
  if (hours < 1) return 'under an hour'
  const whole = Math.round(hours)
  return `${whole} hour${whole === 1 ? '' : 's'}`
}

export default async function OverlocksPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <p className="text-muted-foreground text-sm">
        Pick a single facility above — overlock reconciliation is per-site.
      </p>
    )
  }

  const rows = await overlockReconciliation(actor, selected.facility.id)
  const mismatchCount = rows.filter((r) => r.mismatch).length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Overlocks — {selected.facility.name}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm text-pretty">
          Every unit the delinquency pipeline currently has locked, or has asked to have locked or
          unlocked — system state next to what staff have confirmed on the ground.
        </p>
      </div>

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
        <div className="overflow-x-auto">
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
        </div>
      )}
    </div>
  )
}
