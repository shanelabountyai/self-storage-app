import { describe, expect, it } from 'vitest'
import { orderWalkInSizes, walkInSizeLabel } from '../apps/web/lib/admin/walk-in-sizes'

const t = (name: string, w: number, l: number, available: number, climateControlled = false) => ({
  name, widthFt: w, lengthFt: l, climateControlled, available,
})

describe('walk-in size list (B-403)', () => {
  it('sorts by square feet, sold-out last, and labels dimensions', () => {
    const out = orderWalkInSizes([t('Large', 10, 20, 2), t('Small', 5, 5, 0), t('Medium', 10, 10, 3, true)])
    expect(out.map((s) => s.name)).toEqual(['Medium', 'Large', 'Small'])
    expect(walkInSizeLabel(out[0]!)).toBe('10×10 · Climate · Medium')
    expect(walkInSizeLabel(out[2]!)).toBe('5×5 · Small')
  })
})
