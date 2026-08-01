import { calculateMoveInCost, type TaxRate } from '@storage/core/pricing'
import { formatRate } from '@/lib/format'

// PRD 01 §6.4 / US-301, and B-020's row: the price summary is the stepper's
// chrome, not the payment step's.
//
// It was originally scoped to B-025, which would have meant steps 1–4 shipping
// without a total — including the protection-plan step, where the monthly
// figure changes most. A renter must never first meet a number on the screen
// that asks for their card.
//
// The figures come from the same `calculateMoveInCost` the facility page uses
// (B-017). US-301 makes a disagreement between the two a release-blocking
// defect, which is only enforceable because there is one implementation.

export type PriceSummaryProps = {
  unitLabel: string
  facilityName: string
  webRateCents: number
  streetRateCents: number
  adminFeeCents?: number
  taxRates?: readonly TaxRate[]
  /// Once the renter has chosen at step 3. Added to the recurring total and
  /// shown as its own line, so the number that changed is identifiable rather
  /// than a bigger total the renter has to account for themselves.
  protectionPremiumCents?: number
  /// Rendered when a step has changed the totals, e.g. "Protection plan added".
  /// §6.4: a total that moves without an explicit cause is a defect, so the
  /// cause is stated rather than left to be inferred from a changed number.
  changeNote?: string
}

export function PriceSummary({
  unitLabel,
  facilityName,
  webRateCents,
  streetRateCents,
  adminFeeCents,
  taxRates = [],
  protectionPremiumCents,
  changeNote,
}: PriceSummaryProps) {
  const cost = calculateMoveInCost({ webRateCents, streetRateCents, adminFeeCents, taxRates })
  const premium = protectionPremiumCents ?? 0
  const dueToday = cost.totalDueTodayCents + premium
  const monthly = cost.ongoingMonthlyCents + premium

  return (
    <aside
      aria-labelledby="summary-heading"
      // Sticky at the bottom on mobile (§6.4 "collapsible on mobile"), in the
      // normal flow on wider screens. A <details> rather than a JS disclosure
      // so it works with the bundle disabled, like the rest of the public path.
      className="border-input bg-background sticky bottom-0 z-10 rounded-lg border p-4 sm:static"
    >
      <h2 id="summary-heading" className="sr-only">
        What you are paying
      </h2>

      <details className="group">
        <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-medium">
            Due today <span className="tabular-nums">{formatRate(dueToday)}</span>
          </span>
          <span className="text-muted-foreground text-sm">
            then <span className="tabular-nums">{formatRate(monthly)}</span>/mo
          </span>
        </summary>

        <p className="text-muted-foreground mt-3 text-sm">
          {unitLabel} at {facilityName}
        </p>

        <dl className="mt-3 flex flex-col gap-2 text-sm">
          {cost.lines.map((line) => (
            <div key={line.key} className="flex justify-between gap-4">
              <dt>{line.label}</dt>
              <dd className="tabular-nums">
                {line.key === 'protection'
                  ? protectionPremiumCents === undefined
                    ? 'chosen at checkout'
                    : premium === 0
                      ? 'your own cover'
                      : formatRate(premium)
                  : formatRate(line.amountCents)}
              </dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t pt-2 font-medium">
            <dt>Total due today</dt>
            <dd className="tabular-nums">{formatRate(dueToday)}</dd>
          </div>
        </dl>
      </details>

      {/* 4.1.3: rendered unconditionally and empty, so a total changing between
          steps is a mutation the screen reader announces rather than a node
          inserted already populated. */}
      <p role="status" className="mt-2 text-sm font-medium empty:hidden">
        {changeNote ?? ''}
      </p>
    </aside>
  )
}
