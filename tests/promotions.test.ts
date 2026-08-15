import { describe, expect, it } from 'vitest'
import {
  describeTerms,
  discountForPeriod,
  discountSchedule,
  evaluatePromotions,
  describeCodeOutcome,
  type PromotionCandidate,
} from '../packages/core/promotions'
import { buildInvoice } from '../packages/core/billing/invoice-lines'

// B-070 / PRD 04 §3.6 FR-PROMO-1/3, PRD 02 US-10.

const RENT = 12_900

describe('discountSchedule — FR-PROMO-1', () => {
  it('makes first-month-free the whole rent, once', () => {
    const schedule = discountSchedule({ type: 'free_months', value: 0, durationPeriods: 1 }, RENT)
    expect(schedule.periods).toEqual([{ periodIndex: 0, amountCents: RENT }])
    expect(schedule.totalCents).toBe(RENT)
  })

  it('spreads a percentage across the periods it covers', () => {
    const schedule = discountSchedule({ type: 'percent_off', value: 50, durationPeriods: 3 }, RENT)
    expect(schedule.periods.map((period) => period.periodIndex)).toEqual([0, 1, 2])
    expect(schedule.totalCents).toBe(3 * 6_450)
  })

  it('rounds the discount, so rent minus discount is whole cents', () => {
    // 33% of $129.00 is $42.57 exactly; the awkward case is a rate that does
    // not divide. An unrounded discount would leave a fraction of a cent on the
    // invoice and the total would not add up.
    const schedule = discountSchedule({ type: 'percent_off', value: 33, durationPeriods: 1 }, 9_999)
    expect(Number.isInteger(schedule.periods[0].amountCents)).toBe(true)
    expect(schedule.periods[0].amountCents).toBe(Math.round(9_999 * 0.33))
  })

  it('never discounts more than the rent', () => {
    // A $500-off promo on a $129 unit is $129 off. Otherwise the promotion
    // pays the tenant, which is not a promotion.
    const schedule = discountSchedule({ type: 'amount_off', value: 50_000, durationPeriods: 1 }, RENT)
    expect(schedule.periods[0].amountCents).toBe(RENT)
  })

  it('clamps a percentage above 100 and below 0', () => {
    expect(
      discountSchedule({ type: 'percent_off', value: 150, durationPeriods: 1 }, RENT).totalCents,
    ).toBe(RENT)
    expect(
      discountSchedule({ type: 'percent_off', value: -10, durationPeriods: 1 }, RENT).totalCents,
    ).toBe(0)
  })

  it('produces nothing for a zero-length promo', () => {
    expect(discountSchedule({ type: 'free_months', value: 0, durationPeriods: 0 }, RENT).periods).toEqual([])
  })

  it('answers what comes off a given period', () => {
    const schedule = discountSchedule({ type: 'percent_off', value: 50, durationPeriods: 2 }, RENT)
    expect(discountForPeriod(schedule, 0)).toBe(6_450)
    expect(discountForPeriod(schedule, 1)).toBe(6_450)
    // Period 2 is outside the promo — the tenant pays full price from then on.
    expect(discountForPeriod(schedule, 2)).toBe(0)
  })
})

describe('describeTerms — US-12 AC1', () => {
  it('says what each type actually does', () => {
    expect(describeTerms({ type: 'free_months', value: 0, durationPeriods: 1 })).toBe('First month free')
    expect(describeTerms({ type: 'free_months', value: 0, durationPeriods: 3 })).toBe('First 3 months free')
    expect(describeTerms({ type: 'percent_off', value: 25, durationPeriods: 1 })).toBe(
      '25% off the first month',
    )
    expect(describeTerms({ type: 'amount_off', value: 5_000, durationPeriods: 2 })).toBe(
      '$50 off the first 2 months',
    )
  })

  it('caps the stated amount at the rent it is describing', () => {
    // A badge saying "$500 off" on a $129 unit is a promise the invoice cannot
    // keep — the discount is capped, so the wording must be too.
    expect(describeTerms({ type: 'amount_off', value: 50_000, durationPeriods: 1 }, RENT)).toContain(
      '$129',
    )
  })
})

function promo(overrides: Partial<PromotionCandidate> = {}): PromotionCandidate {
  return {
    id: 'p1',
    name: 'Spring',
    type: 'percent_off',
    value: 50,
    durationPeriods: 1,
    status: 'active',
    displayMode: 'auto',
    facilityIds: [],
    unitTypeIds: [],
    newTenantOnly: false,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    termsText: null,
    codes: [],
    ...overrides,
  }
}

const context = {
  facilityId: 'f1',
  unitTypeId: 'u1',
  monthlyRateCents: RENT,
  isNewTenant: true,
  at: new Date('2026-06-15T00:00:00Z'),
}

describe('evaluatePromotions — FR-PROMO-3', () => {
  it('applies an automatic promo with no code', () => {
    const result = evaluatePromotions([promo()], context)
    expect(result.best?.promotion.id).toBe('p1')
    expect(result.best?.schedule.totalCents).toBe(6_450)
    expect(result.automatic).toHaveLength(1)
  })

  it('hides a code-gated promo until its code is typed', () => {
    const gated = promo({ displayMode: 'code', codes: ['spring25'] })

    const without = evaluatePromotions([gated], context)
    expect(without.best).toBeNull()
    // Invisible, not merely unapplied — a badge for a code-gated promo makes
    // the code pointless.
    expect(without.automatic).toHaveLength(0)

    const withCode = evaluatePromotions([gated], { ...context, code: 'SPRING25' })
    expect(withCode.best?.promotion.id).toBe('p1')
    expect(withCode.best?.code).toBe('spring25')
  })

  it('matches codes case-insensitively — FR-PROMO-2', () => {
    const gated = promo({ displayMode: 'code', codes: ['spring25'] })
    for (const typed of ['spring25', 'SPRING25', ' Spring25 ']) {
      expect(evaluatePromotions([gated], { ...context, code: typed }).best).not.toBeNull()
    }
  })

  it('tells a prospect why their code did not work', () => {
    // Watching the total not change is worse than being told.
    const wrongFacility = promo({ displayMode: 'code', codes: ['other'], facilityIds: ['f2'] })
    const result = evaluatePromotions([wrongFacility], { ...context, code: 'other' })
    expect(result.best).toBeNull()
    expect(result.codeOutcome).toEqual({ kind: 'rejected', rejection: 'not_for_this_facility' })
    expect(describeCodeOutcome(result.codeOutcome!)).toContain('different location')
  })

  it('reports an unknown code as unknown', () => {
    expect(evaluatePromotions([promo()], { ...context, code: 'nope' }).codeOutcome).toEqual({
      kind: 'rejected',
      rejection: 'unknown_code',
    })
  })

  // B-122. The third fate of a typed code, and the one a bare `rejection` had
  // no way to express: the code is real, it applies, and it is worth LESS than
  // the automatic promotion already on the unit. FR-PROMO-4 forbids stacking,
  // so keeping the better one is correct — and saying nothing about it leaves a
  // renter who typed a genuine code watching the total not move, which is the
  // exact complaint the rejection messages exist to prevent.
  it('keeps the better automatic offer and says so, rather than silently ignoring the code', () => {
    const generous = promo({ id: 'auto', value: 100 })
    const stingy = promo({ id: 'gated', displayMode: 'code', codes: ['meh'], value: 10 })

    const result = evaluatePromotions([generous, stingy], { ...context, code: 'meh' })

    expect(result.best?.promotion.id).toBe('auto')
    expect(result.codeOutcome?.kind).toBe('superseded')
    expect(describeCodeOutcome(result.codeOutcome!)).toContain('kept your better offer')
    // Not framed as a failure — the renter is better off than the code alone
    // would have made them.
    expect(describeCodeOutcome(result.codeOutcome!)).not.toContain('not')
  })

  it('reports a code that beats the automatic offer as applied', () => {
    const stingy = promo({ id: 'auto', value: 10 })
    const generous = promo({ id: 'gated', displayMode: 'code', codes: ['big'], value: 100 })

    const result = evaluatePromotions([stingy, generous], { ...context, code: 'big' })

    expect(result.best?.promotion.id).toBe('gated')
    expect(result.codeOutcome?.kind).toBe('applied')
    expect(describeCodeOutcome(result.codeOutcome!)).toContain('Code applied')
  })

  it('respects targeting, windows and the new-tenant flag', () => {
    expect(evaluatePromotions([promo({ facilityIds: ['f2'] })], context).best).toBeNull()
    expect(evaluatePromotions([promo({ unitTypeIds: ['u2'] })], context).best).toBeNull()
    expect(
      evaluatePromotions([promo({ newTenantOnly: true })], { ...context, isNewTenant: false }).best,
    ).toBeNull()
    expect(
      evaluatePromotions([promo({ endsAt: new Date('2026-06-01T00:00:00Z') })], context).best,
    ).toBeNull()
    expect(
      evaluatePromotions([promo({ startsAt: new Date('2026-07-01T00:00:00Z') })], context).best,
    ).toBeNull()
  })

  it('ignores a draft or paused promo', () => {
    expect(evaluatePromotions([promo({ status: 'draft' })], context).best).toBeNull()
    expect(evaluatePromotions([promo({ status: 'paused' })], context).best).toBeNull()
  })

  it('stops showing a promo that is already fully redeemed', () => {
    expect(
      evaluatePromotions([promo({ maxRedemptions: 10, redemptionCount: 10 })], context).best,
    ).toBeNull()
  })

  it('picks the most valuable when several apply', () => {
    const small = promo({ id: 'small', value: 10 })
    const big = promo({ id: 'big', type: 'free_months', value: 0, durationPeriods: 1 })
    expect(evaluatePromotions([small, big], context).best?.promotion.id).toBe('big')
  })

  it('keeps the badge a prospect was already reading when a code ties it', () => {
    const shown = promo({ id: 'shown' })
    const typed = promo({ id: 'typed', displayMode: 'code', codes: ['same'] })
    const result = evaluatePromotions([shown, typed], { ...context, code: 'same' })
    expect(result.best?.promotion.id).toBe('shown')
  })
})

describe('buildInvoice with a discount — US-12 AC2', () => {
  const period = { start: new Date('2026-07-01T00:00:00Z'), end: new Date('2026-08-01T00:00:00Z') }
  const charges = [
    { type: 'rent' as const, description: 'Rent', monthlyCents: 10_000, taxable: true },
  ]
  const taxRates = [{ jurisdiction: 'TX', rateBasisPoints: 825 }]

  it('taxes the discounted amount, not the gross', () => {
    // The one that matters. Taxing the gross and then subtracting collects a
    // state's tax on a sale that did not happen, on every discounted invoice.
    const full = buildInvoice({ period, charges, taxRates })
    const discounted = buildInvoice({ period, charges, taxRates, discountCents: 5_000 })

    expect(full.taxCents).toBe(825)
    expect(discounted.taxCents).toBe(413)
    expect(discounted.totalCents).toBe(10_000 - 5_000 + 413)
  })

  it('keeps the subtotal gross so the discount stays visible in reporting', () => {
    const built = buildInvoice({ period, charges, taxRates, discountCents: 5_000 })
    // B-055's revenue report reads "billed" from the lines and "given away"
    // separately; netting here would make the promotion invisible in the one
    // report that exists to price it.
    expect(built.subtotalCents).toBe(10_000)
    expect(built.discountCents).toBe(5_000)
  })

  it('writes the discount as a positive line', () => {
    const built = buildInvoice({
      period,
      charges,
      taxRates,
      discountCents: 5_000,
      discountDescription: 'First month free',
    })
    const line = built.lines.find((one) => one.type === 'discount')!
    expect(line.amountCents).toBe(5_000)
    expect(line.description).toBe('First month free')
  })

  it('caps the discount at the charges and never produces a credit', () => {
    const built = buildInvoice({ period, charges, taxRates, discountCents: 99_999 })
    expect(built.discountCents).toBe(10_000)
    expect(built.totalCents).toBe(0)
    expect(built.taxCents).toBe(0)
  })

  it('leaves an undiscounted invoice exactly as it was', () => {
    const built = buildInvoice({ period, charges, taxRates })
    expect(built.discountCents).toBe(0)
    expect(built.lines.some((line) => line.type === 'discount')).toBe(false)
    expect(built.totalCents).toBe(10_825)
  })
})
