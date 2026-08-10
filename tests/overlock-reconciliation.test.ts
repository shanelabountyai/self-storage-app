import { describe, expect, it } from 'vitest'
import { classifyOverlock, type OverlockReconciliationInput } from '../packages/core/delinquency/overlock-reconciliation'

// B-060 / PRD 02 §4.6 US-36.

const NOW = new Date('2026-08-10T12:00:00Z')

function row(overrides: Partial<OverlockReconciliationInput> = {}): OverlockReconciliationInput {
  return {
    overlockId: 'ol-1',
    unitId: 'unit-1',
    unitNumber: 'A-101',
    leaseId: 'lease-1',
    appliedAt: null,
    createdAt: NOW,
    removalRequestedAt: null,
    ...overrides,
  }
}

describe('classifyOverlock', () => {
  it('is awaiting_apply the moment it is requested — should be locked, is not yet', () => {
    const result = classifyOverlock(row({ createdAt: NOW }), NOW)
    expect(result.state).toBe('awaiting_apply')
    expect(result.shouldBeLocked).toBe(true)
    expect(result.confirmedLocked).toBe(false)
    expect(result.mismatch).toBe(false)
  })

  it('flags a mismatch once an apply request has sat over 24h', () => {
    const requestedAt = new Date(NOW.getTime() - 25 * 60 * 60 * 1000)
    const result = classifyOverlock(row({ createdAt: requestedAt }), NOW)
    expect(result.mismatch).toBe(true)
    expect(result.ageHours).toBeCloseTo(25, 1)
  })

  it('does not flag an apply request under 24h old', () => {
    const requestedAt = new Date(NOW.getTime() - 23 * 60 * 60 * 1000)
    expect(classifyOverlock(row({ createdAt: requestedAt }), NOW).mismatch).toBe(false)
  })

  it('is confirmed and steady once applied, with no removal pending', () => {
    const result = classifyOverlock(row({ appliedAt: NOW }), NOW)
    expect(result.state).toBe('confirmed')
    expect(result.shouldBeLocked).toBe(true)
    expect(result.confirmedLocked).toBe(true)
    // The steady state is never a mismatch, whatever its age — a lock that has
    // been on for a year and should stay on is not a problem to flag.
    expect(classifyOverlock(row({ appliedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 400) }), NOW).mismatch).toBe(
      false,
    )
  })

  it('is awaiting_removal once cure asks for the lock to come off', () => {
    const result = classifyOverlock(row({ appliedAt: NOW, removalRequestedAt: NOW }), NOW)
    expect(result.state).toBe('awaiting_removal')
    // The reconciliation's whole point: system state has flipped (should no
    // longer be locked) while the physical state has not caught up yet.
    expect(result.shouldBeLocked).toBe(false)
    expect(result.confirmedLocked).toBe(true)
  })

  it('flags a mismatch once a removal request has sat over 24h', () => {
    const appliedAt = new Date(NOW.getTime() - 48 * 60 * 60 * 1000)
    const removalRequestedAt = new Date(NOW.getTime() - 25 * 60 * 60 * 1000)
    const result = classifyOverlock(row({ appliedAt, removalRequestedAt }), NOW)
    expect(result.mismatch).toBe(true)
  })

  it('measures removal age from the removal request, not from when the lock went on', () => {
    // Otherwise a lock that sat correctly applied for a month would read as an
    // instant mismatch the moment removal was asked for.
    const appliedAt = new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 30)
    const removalRequestedAt = new Date(NOW.getTime() - 60 * 60 * 1000)
    expect(classifyOverlock(row({ appliedAt, removalRequestedAt }), NOW).mismatch).toBe(false)
  })
})
