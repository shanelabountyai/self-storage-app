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
    leaseEnded: false,
    ...overrides,
  }
}

describe('classifyOverlock', () => {
  // B-169. The state this list could not express, and the one that costs
  // sellable inventory: a lock on a unit with no tenant, which
  // `deriveUnitStatus` reports as `overlocked` — so system and physical agreed
  // and both were wrong.
  it('flags a lock on a unit whose lease has ended, immediately', () => {
    const applied = new Date('2026-08-10T11:00:00Z')
    const result = classifyOverlock(row({ appliedAt: applied, leaseEnded: true }), NOW)
    expect(result.state).toBe('stuck_no_lease')
    expect(result.shouldBeLocked).toBe(false)
    expect(result.confirmedLocked).toBe(true)
    // One hour old, and already flagged: every other mismatch here waits 24
    // hours because it is somebody not having got there yet. This one is a
    // unit out of inventory with nothing in any queue about it.
    expect(result.mismatch).toBe(true)
  })

  it('does not call it stuck once a removal has actually been asked for', () => {
    const result = classifyOverlock(
      row({
        appliedAt: new Date('2026-08-09T11:00:00Z'),
        leaseEnded: true,
        removalRequestedAt: new Date('2026-08-10T11:00:00Z'),
      }),
      NOW,
    )
    expect(result.state).toBe('awaiting_removal')
  })

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
