import { describe, expect, it } from 'vitest'
import {
  HOLD_TYPES,
  effectsOf,
  hasEffect,
  holdIsActive,
  holdTypeSpec,
} from '../packages/core/holds'

// PRD 02 §4.4 US-42 (B-096). The catalog and the evaluation.

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function hold(overrides: Partial<Parameters<typeof holdIsActive>[0]> = {}) {
  return {
    type: 'bankruptcy',
    effectiveFrom: d('2026-09-01'),
    effectiveTo: null as Date | null,
    liftedAt: null as Date | null,
    ...overrides,
  }
}

describe('the catalog', () => {
  it('declares effects for every type, so no type is decorative', () => {
    for (const spec of HOLD_TYPES) {
      expect(spec.effects.length, `${spec.type} declares no effects`).toBeGreaterThan(0)
    }
  })

  it('gives every type a banner note written for whoever opens the profile next', () => {
    for (const spec of HOLD_TYPES) {
      expect(spec.bannerNote.length, `${spec.type}`).toBeGreaterThan(20)
    }
  })

  it('protects the two types US-42 names, and only by declaring it', () => {
    expect(holdTypeSpec('military_scra')!.liftRequiresManager).toBe(true)
    expect(holdTypeSpec('bankruptcy')!.liftRequiresManager).toBe(true)
    expect(holdTypeSpec('dispute')!.liftRequiresManager).toBe(false)
  })

  it('blocks auction on every type where a sale would be the unrecoverable mistake', () => {
    // Selling a servicemember's goods, a debtor's under a stay, or a dead
    // person's is the one action with no way back.
    for (const type of ['military_scra', 'bankruptcy', 'deceased', 'litigation']) {
      expect(holdTypeSpec(type)!.effects, type).toContain('block_auction')
    }
  })

  it('keeps a billing dispute narrow', () => {
    // A dispute about a charge is not a reason to stop taking a payment the
    // tenant chose to make, nor to change the gate policy.
    const effects = holdTypeSpec('dispute')!.effects
    expect(effects).toContain('halt_late_fees')
    expect(effects).not.toContain('halt_autopay')
    expect(effects).not.toContain('halt_access_suspension')
  })

  it('makes do-not-contact a channel instruction, not forbearance', () => {
    // It stops the sending, not the owing.
    const effects = holdTypeSpec('do_not_contact')!.effects
    expect(effects).toContain('halt_dunning')
    expect(effects).not.toContain('halt_late_fees')
  })

  it('requires an estate contact only where US-42 says', () => {
    expect(holdTypeSpec('deceased')!.requiresEstateContact).toBe(true)
    expect(HOLD_TYPES.filter((spec) => spec.requiresEstateContact)).toHaveLength(1)
  })
})

describe('holdIsActive', () => {
  it('is active between its dates', () => {
    expect(holdIsActive(hold(), d('2026-09-15'))).toBe(true)
  })

  it('is not active before it starts', () => {
    expect(holdIsActive(hold(), d('2026-08-31'))).toBe(false)
  })

  it('is not active once it has ended', () => {
    expect(holdIsActive(hold({ effectiveTo: d('2026-09-10') }), d('2026-09-10'))).toBe(false)
    expect(holdIsActive(hold({ effectiveTo: d('2026-09-10') }), d('2026-09-09'))).toBe(true)
  })

  it('stays lifted even when its end date is still in the future', () => {
    // The bug this prevents: a manager lifts a hold early and it comes back to
    // life because someone also set an end date next year.
    const lifted = hold({ effectiveTo: d('2027-01-01'), liftedAt: d('2026-09-05') })
    expect(holdIsActive(lifted, d('2026-09-15'))).toBe(false)
  })

  it('treats an open-ended hold as running until lifted', () => {
    expect(holdIsActive(hold(), d('2030-01-01'))).toBe(true)
  })
})

describe('effectsOf', () => {
  it('unions concurrent holds rather than letting one win', () => {
    // US-42: "multiple concurrent holds are allowed and each is evaluated
    // independently" — so a narrow hold can never weaken a broad one.
    const effects = effectsOf(
      [hold({ type: 'dispute' }), hold({ type: 'bankruptcy' })],
      d('2026-09-15'),
    )
    expect(effects.has('block_auction')).toBe(true)
    expect(effects.has('halt_autopay')).toBe(true)
  })

  it('a narrow hold beside a lifted broad one does not inherit its reach', () => {
    const effects = effectsOf(
      [hold({ type: 'dispute' }), hold({ type: 'bankruptcy', liftedAt: d('2026-09-02') })],
      d('2026-09-15'),
    )
    expect(effects.has('halt_late_fees')).toBe(true)
    expect(effects.has('block_auction')).toBe(false)
  })

  it('ignores an unknown type rather than freezing the account', () => {
    // The catalog is code, not user input — a typo is caught when the hold is
    // placed. Failing closed here would let one silently freeze an account.
    expect(effectsOf([hold({ type: 'not_a_real_type' })], d('2026-09-15')).size).toBe(0)
  })

  it('is empty when nothing is in force', () => {
    expect(effectsOf([], d('2026-09-15')).size).toBe(0)
    expect(effectsOf([hold({ liftedAt: d('2026-09-02') })], d('2026-09-15')).size).toBe(0)
  })
})

describe('hasEffect', () => {
  it('answers the one question every consumer asks', () => {
    expect(hasEffect([hold({ type: 'payment_plan' })], 'halt_late_fees', d('2026-09-15'))).toBe(true)
    expect(hasEffect([hold({ type: 'payment_plan' })], 'block_auction', d('2026-09-15'))).toBe(false)
  })
})
