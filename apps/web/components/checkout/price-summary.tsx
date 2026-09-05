import { Fragment } from 'react'
import { calculateMoveInCost, type TaxRate } from '@storage/core/pricing'
import { formatRate } from '@/lib/format'
import { translate, type Dictionary, type MessageKey } from '@/lib/i18n'
import { costLineLabel } from '@/lib/pricing/cost-line-copy'

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
  /// B-106 part 5. Every unit in the basket, in the order it was added.
  ///
  /// The row requires the summary to itemise per unit, and the totals are
  /// derived from this list rather than passed alongside it — the alternative
  /// was a summed `webRateCents` prop next to a `units` prop for display, which
  /// is two sources for one number and exactly how a summary starts disagreeing
  /// with the charge. US-301 makes that disagreement release-blocking.
  units: readonly {
    id: string
    /// The unit number once claimed; the size alone before that.
    name: string
    label: string
    rateCents: number
    streetRateCents: number
  }[]
  facilityName: string
  adminFeeCents?: number
  taxRates?: readonly TaxRate[]
  /// Once the renter has chosen at step 3. Added to the recurring total and
  /// shown as its own line, so the number that changed is identifiable rather
  /// than a bigger total the renter has to account for themselves.
  protectionPremiumCents?: number
  /// The promotion this checkout locked at "Rent now", in cents off the first
  /// period, with the terms as its label. Passed through rather than
  /// re-evaluated so the summary, the amount due and the redemption all agree.
  promoDiscountCents?: number
  promoTerms?: string
  /// Rendered when a step has changed the totals, e.g. "Protection plan added".
  /// §6.4: a total that moves without an explicit cause is a defect, so the
  /// cause is stated rather than left to be inferred from a changed number.
  changeNote?: string
  dict: Dictionary
}

export function PriceSummary({
  units,
  facilityName,
  adminFeeCents,
  taxRates = [],
  protectionPremiumCents,
  promoDiscountCents,
  promoTerms,
  changeNote,
  dict,
}: PriceSummaryProps) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(dict, key, vars)
  // The same arithmetic `amountDueToday` does, and deliberately the same shape:
  // the admin fee and the tax are charged ONCE for the checkout (the fee opens
  // an account; the tax follows the summed rent it is levied on), while the
  // protection premium is per unit under D-52.
  const webRateCents = units.reduce((sum, unit) => sum + unit.rateCents, 0)
  const streetRateCents = units.reduce((sum, unit) => sum + unit.streetRateCents, 0)

  const cost = calculateMoveInCost({
    webRateCents,
    streetRateCents,
    adminFeeCents,
    taxRates,
    promoDiscountCents,
    promoTerms,
  })
  const premiumPerUnit = protectionPremiumCents ?? 0
  const premium = premiumPerUnit * units.length
  const dueToday = cost.totalDueTodayCents + premium
  const monthly = cost.ongoingMonthlyCents + premium

  return (
    <aside
      aria-labelledby="summary-heading"
      // Sticky at the bottom on EVERY viewport. It used to drop to `static`
      // above `sm`, which on a single-column page resolves to "the last element
      // on the page" — so the desktop reading of §6.4's persistent summary was
      // a total the renter had to scroll to, on the steps where it moves most.
      // `sticky` keeps the element in flow, so it reserves its own space and
      // never covers the content below it; a <details> rather than a JS
      // disclosure so it works with the bundle disabled, like the rest of the
      // public path.
      className="border-input bg-background sticky bottom-0 z-10 rounded-lg border p-4"
    >
      <h2 id="summary-heading" className="sr-only">
        {t('summary.heading')}
      </h2>

      <details className="group">
        <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-medium">
            {t('summary.dueToday')} <span className="tabular-nums">{formatRate(dueToday)}</span>
          </span>
          <span className="text-muted-foreground text-sm">
            {t('summary.then')} <span className="tabular-nums">{formatRate(monthly)}</span>
            {t('card.perMonth')}
          </span>
        </summary>

        <p className="text-muted-foreground mt-3 text-sm">
          {t('summary.unitsAt', {
            units:
              units.length === 1
                ? units[0].label
                : t('summary.nUnits', { count: units.length }),
            facility: facilityName,
          })}
        </p>

        <dl className="mt-3 flex flex-col gap-2 text-sm">
          {cost.lines.map((line) => (
            // A Fragment, not a wrapping <div>: a <dl> may directly contain
            // <div> groups, but nesting the per-unit rows inside ANOTHER <div>
            // (or, as this first did, inside a nested <dl>) puts the <dt>/<dd>
            // outside any list their own <dl> owns. axe caught it; the fix is
            // to keep every group a direct child.
            <Fragment key={line.key}>
              <div className="flex justify-between gap-4">
                <dt>{costLineLabel(dict, line, promoTerms)}</dt>
                <dd className="tabular-nums">
                  {line.key === 'protection' ? (
                    protectionPremiumCents === undefined ? (
                      t('summary.chosenAtCheckout')
                    ) : premium === 0 ? (
                      t('summary.ownCover')
                    ) : (
                      <>
                        {formatRate(premium)}
                        {/* D-52 makes the premium multiply, and §6.4 makes
                            that a disclosure rather than a nicety: a renter
                            who chose one $12 plan must not meet $36 with
                            nothing saying why. Inside the <dd> because a <p>
                            is not a legal child of a <dl>. */}
                        {units.length > 1 && (
                          <span className="text-muted-foreground block text-xs">
                            {t('summary.perUnitTimes', {
                              each: formatRate(premiumPerUnit),
                              count: units.length,
                            })}
                          </span>
                        )}
                      </>
                    )
                  ) : (
                    formatRate(line.amountCents)
                  )}
                </dd>
              </div>

              {/* The row's criterion: the summary ITEMISES per unit. Only worth
                  rendering once there is more than one — for a single unit the
                  breakdown would restate the line directly above it. Rendered
                  as further groups in the SAME list, indented, so a
                  screen-reader user meets the rent total and then its parts
                  rather than two unrelated lists of numbers. */}
              {units.length > 1 &&
                line.key === 'rent' &&
                units.map((unit) => (
                  <div key={unit.id} className="text-muted-foreground flex justify-between gap-4">
                    <dt className="pl-4">{unit.name}</dt>
                    <dd className="tabular-nums">{formatRate(unit.rateCents)}</dd>
                  </div>
                ))}
            </Fragment>
          ))}
          <div className="flex justify-between gap-4 border-t pt-2 font-medium">
            <dt>{t('summary.totalDueToday')}</dt>
            <dd className="tabular-nums">{formatRate(dueToday)}</dd>
          </div>
        </dl>
      </details>

      {/* 4.1.3: rendered unconditionally and empty, so a total changing between
          steps is a mutation the screen reader announces rather than a node
          inserted already populated. `empty:mt-0` and NOT `empty:hidden` —
          `display:none` would pull it out of the accessibility tree until it
          had text, which is the very thing this comment claims it does not do
          (see the note in `gate-code-panel.tsx`). */}
      <p role="status" className="mt-2 text-sm font-medium empty:mt-0">
        {changeNote ?? ''}
      </p>
    </aside>
  )
}
