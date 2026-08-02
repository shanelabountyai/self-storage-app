import { describe, expect, it } from 'vitest'
import { canTransition, GRANT_STATES, isSystemCause, opensGate } from '../packages/core/access'

// B-027 / PRD 03 FR-1.

describe('grant state machine', () => {
  it('walks the lifecycle FR-1 describes', () => {
    expect(canTransition('pending', 'active').allowed).toBe(true)
    expect(canTransition('active', 'suspended').allowed).toBe(true)
    expect(canTransition('suspended', 'active').allowed).toBe(true)
    expect(canTransition('active', 'revoked').allowed).toBe(true)
  })

  it('treats revoked as final', () => {
    // A tenant who comes back gets a new grant. The history of why access
    // ended is evidence, and reviving a grant would erase it.
    for (const state of GRANT_STATES) {
      if (state === 'revoked') continue
      const verdict = canTransition('revoked', state)
      expect(verdict.allowed, `revoked → ${state}`).toBe(false)
      if (!verdict.allowed) expect(verdict.reason).toMatch(/final/)
    }
  })

  it('refuses to skip provisioning', () => {
    // pending → suspended would mean suspending access that was never granted.
    expect(canTransition('pending', 'suspended').allowed).toBe(false)
  })

  it('reports a same-state move as not-a-transition', () => {
    // A delinquency run that fires twice must not send a second command to the
    // controller; the caller treats this as a quiet no-op.
    for (const state of GRANT_STATES) {
      expect(canTransition(state, state).allowed).toBe(false)
    }
  })

  it('opens the gate only when active', () => {
    // Stated once, as a function. A second place spelling this `!== suspended`
    // would let a pending or revoked grant open a gate.
    expect(opensGate('active')).toBe(true)
    for (const state of ['pending', 'suspended', 'revoked'] as const) {
      expect(opensGate(state), state).toBe(false)
    }
  })

  it('distinguishes an automated cause from a person', () => {
    expect(isSystemCause('system:delinquency')).toBe(true)
    expect(isSystemCause('staff:user_123')).toBe(false)
  })
})
