import { describe, expect, it } from 'vitest'
import { isKnownEvent, UnknownEventError } from '../packages/core/events'

describe('event catalog', () => {
  it('recognizes catalog names and rejects invented ones', () => {
    expect(isKnownEvent('lease.moved_in')).toBe(true)
    expect(isKnownEvent('lease.movedIn')).toBe(false)
  })
})

describe('UnknownEventError', () => {
  it('preserves the offending event name without it being clobbered', () => {
    // Regression: an earlier version used a constructor-parameter-property
    // called `name`, which collided with (and was overwritten by) the
    // `this.name = 'UnknownEventError'` line that follows it — the actual
    // event name was silently discarded.
    const error = new UnknownEventError('bogus.event')
    expect(error.eventName).toBe('bogus.event')
    expect(error.name).toBe('UnknownEventError')
    expect(error.message).toContain('bogus.event')
  })
})
