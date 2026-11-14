import { beforeEach, describe, expect, it, vi } from 'vitest'

// K5 (scorecard 2026-11-13). The anonymous reservation hold and the referral
// code lookup consult the DB-backed limiter, and a refused caller is answered
// without the write or the lookup happening. The limiter itself is covered
// against a real database in public-rate-limit-db.test.ts.

let allowed = true
const calls = { reserve: 0, invite: 0 }

vi.mock('@/lib/http/request-metadata', () => ({
  requestMetadata: async () => ({ ipAddress: '203.0.113.9', userAgent: null }),
}))
vi.mock('@/lib/http/rate-limit', () => ({
  mayReserve: async () => allowed,
  mayReadToken: async () => allowed,
}))
vi.mock('@/lib/reservations/reserve', () => ({
  createReservation: async () => {
    calls.reserve += 1
    return { ok: false, reason: 'sold_out' }
  },
}))
vi.mock('@/lib/facility/public-facility', () => ({
  publicFacilityBySlug: async () => ({ id: 'fac-1', slug: 'f' }),
  facilityPath: () => '/storage/tx/austin/f',
}))
vi.mock('@/lib/inventory/public-inventory', () => ({
  publicInventoryForFacility: async () => ({ unitTypes: [{ unitTypeId: 'ut-1', webRateCents: 10_000 }] }),
}))
vi.mock('@/lib/i18n/server', () => ({
  getLocale: async () => 'en',
  messages: async () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/referrals/service', () => ({
  usableInvite: async () => {
    calls.invite += 1
    return null
  },
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ set: () => {} }) }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
}))

const { reserveAction } = await import('../apps/web/app/(public)/storage/[state]/[city]/[slug]/reserve/actions')
const { GET: referralGet } = await import('../apps/web/app/r/[code]/route')

function reserveForm(): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries({
    slug: 'f',
    unitTypeId: 'ut-1',
    firstName: 'Ada',
    lastName: 'Renter',
    email: 'ada@example.com',
    phone: '5125550100',
    moveInDate: '2030-01-15',
  })) {
    data.set(key, value)
  }
  return data
}

beforeEach(() => {
  calls.reserve = 0
  calls.invite = 0
})

describe('K5: public limits are wired in', () => {
  it('a limited caller is refused a reservation hold before anything is written', async () => {
    allowed = false
    const state = await reserveAction({ status: 'idle' } as never, reserveForm())
    expect(state).toMatchObject({ status: 'error', message: 'err.reserveRateLimited' })
    expect(calls.reserve).toBe(0)
  })

  it('an allowed caller reaches createReservation', async () => {
    allowed = true
    await reserveAction({ status: 'idle' } as never, reserveForm())
    expect(calls.reserve).toBe(1)
  })

  it('a limited caller lands on search from a referral link without a lookup', async () => {
    allowed = false
    await expect(
      referralGet(new Request('http://localhost/r/ABCD2345'), { params: Promise.resolve({ code: 'ABCD2345' }) }),
    ).rejects.toThrow('REDIRECT /storage/search')
    expect(calls.invite).toBe(0)

    allowed = true
    await expect(
      referralGet(new Request('http://localhost/r/ABCD2345'), { params: Promise.resolve({ code: 'ABCD2345' }) }),
    ).rejects.toThrow('REDIRECT /storage/search')
    expect(calls.invite).toBe(1)
  })
})
