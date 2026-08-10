import { describe, expect, it } from 'vitest'
import {
  DERIVED_UNIT_STATUSES,
  MANUAL_UNIT_STATUSES,
  OCCUPYING_LEASE_STATUSES,
  canSetManualStatus,
  deriveUnitStatus,
  isRentable,
  type ManualUnitStatus,
  type UnitOccupancyFacts,
} from '../packages/core/inventory'

const VACANT: UnitOccupancyFacts = {
  activeLease: null,
  activeReservation: null,
  activeCheckoutLock: null,
  overlocked: false,
  blockingMaintenanceTicket: null,
}

const leased = (status = 'active'): UnitOccupancyFacts => ({
  ...VACANT,
  activeLease: { id: 'lease-1', status },
})
const held: UnitOccupancyFacts = { ...VACANT, activeReservation: { id: 'res-1' } }
/// A move-in in progress (B-020). A different event from a reservation, but to
/// anyone looking at the unit it means the same thing: spoken for.
const inCheckout: UnitOccupancyFacts = { ...VACANT, activeCheckoutLock: { id: 'co-1' } }
const overlocked: UnitOccupancyFacts = { ...leased(), overlocked: true }

describe('deriveUnitStatus — a checkout in progress holds the unit', () => {
  it('reads as reserved while the lock is live', () => {
    expect(deriveUnitStatus('available', inCheckout)).toBe('reserved')
  })

  it('outranks operator intent, exactly as a reservation does', () => {
    // B-010's documented precedence puts `reserved` above operational intent,
    // so a lock on a unit someone has since marked for maintenance still reads
    // as reserved. That is the existing contract, not a new one — asserted here
    // so the checkout lock cannot quietly diverge from the reservation it sits
    // beside.
    expect(deriveUnitStatus('maintenance', inCheckout)).toBe('reserved')
    expect(deriveUnitStatus('maintenance', inCheckout)).toBe(
      deriveUnitStatus('maintenance', held),
    )
  })

  it('ranks below a lease', () => {
    // Both at once should be impossible, but if the data ever says so the more
    // serious fact wins — the same precedence a reservation gets.
    const both: UnitOccupancyFacts = { ...leased(), activeCheckoutLock: { id: 'co-1' } }
    expect(deriveUnitStatus('available', both)).toBe('occupied')
  })

  it('is indistinguishable from a reservation in the derived status', () => {
    expect(deriveUnitStatus('available', inCheckout)).toBe(deriveUnitStatus('available', held))
  })
})

describe('deriveUnitStatus — operator intent when nothing occupies the unit', () => {
  it.each(MANUAL_UNIT_STATUSES)('a vacant unit shows its own %s intent', (intent) => {
    expect(deriveUnitStatus(intent, VACANT)).toBe(intent)
  })
})

describe('deriveUnitStatus — occupancy overrides intent', () => {
  it.each(OCCUPYING_LEASE_STATUSES)('a %s lease makes the unit occupied', (leaseStatus) => {
    expect(deriveUnitStatus('available', leased(leaseStatus))).toBe('occupied')
  })

  it('a held reservation makes the unit reserved', () => {
    expect(deriveUnitStatus('available', held)).toBe('reserved')
  })

  it('an overlock outranks the lease it implies', () => {
    expect(deriveUnitStatus('available', overlocked)).toBe('overlocked')
  })

  it('a lease outranks a reservation if both somehow exist', () => {
    const both: UnitOccupancyFacts = { ...leased(), activeReservation: { id: 'res-1' } }
    expect(deriveUnitStatus('available', both)).toBe('occupied')
  })
})

describe('deriveUnitStatus — intent survives occupancy', () => {
  // The reason operationalStatus is a separate column. If intent were
  // collapsed into the effective status, a maintenance unit that got leased
  // would come back as `available` when vacated — silently returning a unit
  // somebody deliberately took offline to the rentable pool.
  it.each(['maintenance', 'unrentable'] as const)(
    'a %s unit reads as occupied while leased, then returns to that intent',
    (intent: ManualUnitStatus) => {
      expect(deriveUnitStatus(intent, leased())).toBe('occupied')
      expect(deriveUnitStatus(intent, VACANT)).toBe(intent)
    },
  )
})

describe('canSetManualStatus — what a human may set', () => {
  it.each(MANUAL_UNIT_STATUSES)('allows %s on a vacant unit', (target) => {
    expect(canSetManualStatus(target, VACANT)).toEqual({ allowed: true })
  })

  it.each(DERIVED_UNIT_STATUSES)('refuses %s even on a vacant unit', (target) => {
    const verdict = canSetManualStatus(target, VACANT)
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) throw new Error('unreachable')
    expect(verdict.reason).toMatch(/derived/i)
    // Nothing is blocking — the status itself is simply not settable, which is
    // a different error than "the unit is busy".
    expect(verdict.blocking).toBeNull()
  })

  it('refuses an unknown status', () => {
    expect(canSetManualStatus('banana', VACANT).allowed).toBe(false)
  })
})

describe('canSetManualStatus — names the blocking record (US-8 AC)', () => {
  it('refuses and names the lease', () => {
    const verdict = canSetManualStatus('available', leased())
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) throw new Error('unreachable')
    expect(verdict.blocking).toEqual({ type: 'lease', id: 'lease-1' })
    expect(verdict.reason).toContain('lease-1')
  })

  it('refuses and names the reservation', () => {
    const verdict = canSetManualStatus('maintenance', held)
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) throw new Error('unreachable')
    expect(verdict.blocking).toEqual({ type: 'reservation', id: 'res-1' })
    expect(verdict.reason).toContain('res-1')
  })

  it('refuses an overlocked unit, citing delinquency rather than the lease', () => {
    const verdict = canSetManualStatus('available', overlocked)
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) throw new Error('unreachable')
    expect(verdict.blocking?.type).toBe('overlock')
  })

  it.each(OCCUPYING_LEASE_STATUSES)(
    'refuses while a %s lease exists, not just an active one',
    (leaseStatus) => {
      expect(canSetManualStatus('available', leased(leaseStatus)).allowed).toBe(false)
    },
  )

  it('allows again once the lease has ended', () => {
    // `ended` is absent from OCCUPYING_LEASE_STATUSES, so the adapter reports
    // activeLease: null — matching the lease_one_active_per_unit index.
    expect(canSetManualStatus('available', VACANT)).toEqual({ allowed: true })
  })
})

describe('canSetManualStatus — a blocking maintenance ticket (B-060 / US-37)', () => {
  const ticketed: UnitOccupancyFacts = { ...VACANT, blockingMaintenanceTicket: { id: 'mt-1' } }

  it('refuses to reopen the unit while the ticket is open', () => {
    const verdict = canSetManualStatus('available', ticketed)
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) throw new Error('unreachable')
    expect(verdict.blocking).toEqual({ type: 'maintenance_ticket', id: 'mt-1' })
    expect(verdict.reason).toContain('mt-1')
  })

  it('does not block taking the unit further offline', () => {
    // The AC is specifically about `available` — a ticket should never stop an
    // operator marking a unit `maintenance` or `unrentable` on top of it.
    expect(canSetManualStatus('maintenance', ticketed)).toEqual({ allowed: true })
    expect(canSetManualStatus('unrentable', ticketed)).toEqual({ allowed: true })
  })

  it('is silent once nothing is blocking', () => {
    expect(canSetManualStatus('available', VACANT)).toEqual({ allowed: true })
  })
})

describe('isRentable', () => {
  it('is true only for available', () => {
    expect(isRentable('available')).toBe(true)
    for (const status of ['occupied', 'reserved', 'overlocked', 'maintenance', 'unrentable'] as const) {
      expect(isRentable(status), status).toBe(false)
    }
  })
})

describe('status vocabularies', () => {
  it('partition the six UnitStatus values with no overlap', () => {
    const all = [...MANUAL_UNIT_STATUSES, ...DERIVED_UNIT_STATUSES]
    expect(new Set(all).size).toBe(6)
  })
})
