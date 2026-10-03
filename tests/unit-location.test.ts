import { describe, expect, it } from 'vitest'
import { unitPlace } from '../apps/web/lib/checkout/unit-location'

const words = { building: (n: string) => `Building ${n}`, floor: (n: number) => `floor ${n}` }

describe('unitPlace (B-432)', () => {
  it('is silent for a ground-floor unit on a site with no buildings', () => {
    expect(unitPlace({ number: 'A-1', building: null, floor: 1 }, words)).toBeNull()
  })
  it('names the floor when there is no building but it is not floor 1', () => {
    expect(unitPlace({ number: 'A-1', building: null, floor: 3 }, words)).toBe('floor 3')
  })
  it('names building and floor together, floor 1 included', () => {
    expect(unitPlace({ number: 'A-1', building: 'B', floor: 1 }, words)).toBe('Building B, floor 1')
  })
})
