import Link from 'next/link'
import { getSwitcherData } from '@/lib/admin/context'
import { resolveSelectedFacility } from '@/lib/admin/facility-selection-logic'
import { hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { formatCents } from '@/lib/format'
import { UnitsSubnav } from '@/components/admin/units-subnav'
import { AdminForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import {
  COOLDOWN_DAYS,
  MIN_UNITS_FOR_SUGGESTION,
  type SuggestionReason,
} from '@storage/core/pricing'
import { rateSuggestionsForFacility, type RateSuggestionRow } from '@/lib/pricing/rate-suggestions'
import { applySuggestedRateAction } from './actions'

export const metadata = { title: 'Street rates' }

// PRD 02 US-12 (B-088 part 1). "Rules-based revenue management: automatic
// street-rate suggestions from occupancy per unit type, one-click apply."
//
// The screen's job is to make a price change a decision rather than a reflex,
// so every row says what the rule concluded AND why — including, on most rows,
// why it concluded nothing.

/// Why no suggestion, in the operator's words. Each is a different sentence on
/// purpose: "wait" and "you already did this" and "nobody wants these units"
/// are three different situations and one generic "no suggestion" would make
/// the screen useless for the two that need action.
const QUIET_REASONS: Record<Exclude<SuggestionReason, 'raise'>, string> = {
  no_rate: 'No street rate has ever been published for this type — set one first.',
  too_few_units: `Fewer than ${MIN_UNITS_FOR_SUGGESTION} rentable units, so occupancy here does not mean much yet.`,
  change_scheduled: 'A rate change is already scheduled for this type.',
  cooling_off: `The current rate has not been on sale for ${COOLDOWN_DAYS} days yet — give the last change time to show up in occupancy.`,
  demand_is_soft: 'Occupancy is not high enough to support a rise. If these are sitting empty, a promotion is the lever, not a lower street rate.',
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

function SuggestionCell({ row, facilityId }: { row: RateSuggestionRow; facilityId: string }) {
  const { suggestion } = row

  if (suggestion.reason !== 'raise') {
    return <p className="text-muted-foreground text-pretty">{QUIET_REASONS[suggestion.reason]}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-pretty">
        Occupancy is {percent(row.occupancyRatio)} and the rate has held for{' '}
        {row.daysSinceRateChange} days. Suggested:{' '}
        <strong>{formatCents(suggestion.suggestedStreetRateCents!)}</strong> street (
        {Math.round(suggestion.increase! * 100)}% up), {formatCents(suggestion.suggestedWebRateCents!)}{' '}
        online.
      </p>
      <AdminForm
        action={applySuggestedRateAction}
        label={`Apply the suggested rate for ${row.unitTypeName}`}
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="unitTypeId" value={row.unitTypeId} />
        <input type="hidden" name="unitTypeName" value={row.unitTypeName} />
        {/* Pre-filled, and editable on purpose. "One-click apply" should not
            mean the operator can only accept the arithmetic — the rule proposes
            and the person prices. */}
        <label className="flex flex-col gap-1 text-xs">
          Street $
          <input
            name="streetRateDollars"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={(suggestion.suggestedStreetRateCents! / 100).toFixed(2)}
            className="border-input bg-background h-9 w-24 rounded-md border px-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Online $
          <input
            name="webRateDollars"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={(suggestion.suggestedWebRateCents! / 100).toFixed(2)}
            className="border-input bg-background h-9 w-24 rounded-md border px-2"
          />
        </label>
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </AdminForm>
    </div>
  )
}

export default async function AdminStreetRatesPage() {
  const { actor, facilities, cookieValue, canSeeAll } = await getSwitcherData()
  const selected = resolveSelectedFacility(cookieValue, facilities, canSeeAll)

  if (selected.mode !== 'single') {
    return (
      <div className="flex max-w-5xl flex-col gap-6">
        <UnitsSubnav />
        <p className="text-muted-foreground text-sm">
          Pick a specific facility above — rates are set per facility.
        </p>
      </div>
    )
  }

  if (!hasPermissionAnywhere(actor, ['rates:street:propose'])) {
    return (
      <div className="flex max-w-5xl flex-col gap-6">
        <UnitsSubnav />
        <p className="text-muted-foreground text-sm">You don&apos;t have access to street rates.</p>
      </div>
    )
  }

  const facilityId = selected.facility.id
  const { rows, upliftCents } = await rateSuggestionsForFacility(actor, facilityId)
  const raises = rows.filter((row) => row.suggestion.reason === 'raise')

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <UnitsSubnav />

      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">{selected.facility.name} street rates</h1>
        {/* The single most important sentence on the page. An operator who
            thinks this raises their existing tenants will either never touch it
            or will touch it once and be very angry — and US-11's tenant
            increases are a genuinely different screen with a notice period. */}
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          This is the price a <strong>new</strong> tenant is quoted. Changing it never touches
          anybody already renting — raising an existing tenant is a different job with its own
          notice period, on{' '}
          <Link href="/admin/rate-increases" className="underline underline-offset-2">
            Rate Increases
          </Link>
          .
        </p>
      </header>

      {raises.length > 0 && (
        <p className="border-input rounded-md border p-3 text-sm text-pretty">
          {raises.length} {raises.length === 1 ? 'type looks' : 'types look'} underpriced. Applying
          every suggestion would be worth about{' '}
          <strong>{formatCents(upliftCents)} a month</strong> — but only once the units concerned
          turn over, because a street rate is what the <em>next</em> tenant pays.
        </p>
      )}

      <div tabIndex={0} className="overflow-x-auto">
        <table className="w-full min-w-3xl text-left text-sm">
          <caption className="sr-only">
            Every unit type at {selected.facility.name}, its occupancy, its current street rate and
            what the rule suggests
          </caption>
          <thead>
            <tr className="border-input border-b">
              <th scope="col" className="py-2 pr-4 font-medium">Type</th>
              <th scope="col" className="py-2 pr-4 font-medium">Occupancy</th>
              <th scope="col" className="py-2 pr-4 font-medium">Street / online</th>
              <th scope="col" className="py-2 pr-4 font-medium">Suggestion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.unitTypeId} className="border-input border-b align-top">
                <td className="py-2 pr-4">{row.unitTypeName}</td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {/* Never the ratio alone: 100% of two units and 94% of forty
                      are the same colour and different facts (FR-23). */}
                  {percent(row.occupancyRatio)}
                  <span className="text-muted-foreground block text-xs">
                    {row.occupiedCount} of {row.rentableCount} rentable
                  </span>
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {row.streetRateCents > 0 ? (
                    <>
                      {formatCents(row.streetRateCents)}
                      <span className="text-muted-foreground block text-xs">
                        {formatCents(row.webRateCents)} online
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Not set</span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  <SuggestionCell row={row} facilityId={facilityId} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="text-muted-foreground py-3">
                  This facility has no unit types yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
