import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '../apps/web/lib/rbac/actor'

// K4 (scorecard 2026-11-13). The two confirmation echoes that read a lease by
// id — the ledger correction echo and the ledger-exception acknowledgement
// subject — scope that read to the actor's facilities, so a lease outside them
// reads as missing even if the domain gate in front of it ever stopped refusing.

const leaseWheres: unknown[] = []
let sessionActor: Actor

vi.mock('@/lib/rbac/session', () => ({ requireStaffActor: async () => sessionActor }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@storage/db', () => ({
  prisma: {
    lease: {
      findFirst: async (args: { where: unknown }) => {
        leaseWheres.push(args.where)
        return { unit: { number: 'A-1' }, tenant: { firstName: 'Ada', lastName: 'Renter' } }
      },
      findUnique: async () => {
        throw new Error('unscoped lease.findUnique')
      },
    },
    ledgerEntry: { aggregate: async () => ({ _sum: { amountCents: 0 } }) },
  },
}))
vi.mock('@/lib/billing/corrections', () => ({
  postLedgerAdjustment: async () => ({ ok: true, balanceChangeCents: 1_000, entries: 0 }),
  writeOffOpenLeaseBalance: async () => ({ ok: true, amountCents: 1_000, invoicesMarked: 1 }),
  voidRentInvoice: async () => ({ ok: false, reason: 'not_found' }),
}))
vi.mock('@/lib/billing/invoices', () => ({ projectRentRebill: async () => null }))
vi.mock('@/lib/admin/ledger', () => ({ acknowledgeLedgerException: async () => ({ ok: true }) }))

const { adjustLedgerAction, writeOffLedgerAction } = await import(
  '../apps/web/app/admin/tenants/[tenantId]/ledger/[leaseId]/actions'
)
const { acknowledgeExceptionAction } = await import('../apps/web/app/admin/reports/ledger-exceptions/actions')

function staffAt(facilityId: string | null): Actor {
  return {
    kind: 'staff',
    staffUserId: 'staff-1',
    assignments: [
      {
        facilityId,
        roleKey: 'manager',
        rank: 20,
        permissions: new Set(),
        limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
      },
    ],
  } as unknown as Actor
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  leaseWheres.length = 0
})

describe('K4: lease echo reads are facility-scoped', () => {
  it('the correction echo reads the lease only within the actor facilities', async () => {
    sessionActor = staffAt('fac-1')
    const state = await adjustLedgerAction(
      { status: 'idle' } as never,
      form({ tenantId: 't1', leaseId: 'lease-1', amountDollars: '10.00', reasonCode: 'error' }),
    )
    expect(state.status).toBe('confirm')
    expect(leaseWheres).toEqual([{ id: 'lease-1', facilityId: { in: ['fac-1'] } }])
  })

  it('the write-off echo is scoped the same way', async () => {
    sessionActor = staffAt('fac-2')
    await writeOffLedgerAction({ status: 'idle' } as never, form({ tenantId: 't1', leaseId: 'lease-2', reasonCode: 'x' }))
    expect(leaseWheres).toEqual([{ id: 'lease-2', facilityId: { in: ['fac-2'] } }])
  })

  it('an all-facilities actor is unscoped by facility but still by id', async () => {
    sessionActor = staffAt(null)
    await writeOffLedgerAction({ status: 'idle' } as never, form({ tenantId: 't1', leaseId: 'lease-3', reasonCode: 'x' }))
    expect(leaseWheres).toEqual([{ id: 'lease-3' }])
  })

  it('the acknowledgement subject reads the lease only within the actor facilities', async () => {
    sessionActor = staffAt('fac-1')
    const state = await acknowledgeExceptionAction({ status: 'idle' } as never, form({ leaseId: 'lease-4', note: 'seen' }))
    expect(state.status).toBe('success')
    expect(leaseWheres).toEqual([{ id: 'lease-4', facilityId: { in: ['fac-1'] } }])
  })
})
