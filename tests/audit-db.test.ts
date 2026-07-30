import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  findAuditEntries,
  MissingReasonCodeError,
  recordAudit,
} from '../packages/core/audit'

// The append-only guarantee only means something if the database enforces it,
// so it is tested against a real Postgres. Note that these entries are NOT
// cleaned up afterwards — they cannot be, which is the point.
const hasDatabase = Boolean(process.env.DATABASE_URL)

const correlationId = randomUUID()
let facilityId = ''
let staffId = ''

beforeAll(async () => {
  if (!hasDatabase) return
  const facility = await prisma.facility.create({
    data: {
      name: 'Audit Test',
      slug: `audit-test-${correlationId.slice(0, 8)}`,
      addressLine1: '1 Ledger Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      timezone: 'America/Chicago',
    },
  })
  facilityId = facility.id

  const staff = await prisma.staffUser.create({
    data: {
      email: `audit-${correlationId.slice(0, 8)}@example.com`,
      firstName: 'Ada',
      lastName: 'Auditor',
    },
  })
  staffId = staff.id
})

afterAll(async () => {
  if (!hasDatabase) return
  // The facility and staff user cannot be removed either: audit rows reference
  // them with onDelete: Restrict, and the rows are undeletable by design.
  await prisma.$disconnect()
})

const staffActor = () => ({ type: 'staff' as const, staffUserId: staffId })

describe.skipIf(!hasDatabase)('append-only enforcement', () => {
  it('refuses to update an entry', async () => {
    const entry = await recordAudit({
      actor: staffActor(),
      action: 'payment.recorded',
      entityType: 'Payment',
      entityId: 'p-immutable',
      facilityId,
      correlationId,
    })

    await expect(
      prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/i)

    const reread = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })
    expect(reread.action).toBe('payment.recorded')
  })

  it('refuses to delete an entry', async () => {
    const entry = await recordAudit({
      actor: staffActor(),
      action: 'payment.recorded',
      entityType: 'Payment',
      entityId: 'p-undeletable',
      facilityId,
      correlationId,
    })

    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/i,
    )
    await expect(
      prisma.auditLog.deleteMany({ where: { correlationId } }),
    ).rejects.toThrow(/append-only/i)
  })

  it('refuses to truncate the table', async () => {
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_log"')).rejects.toThrow(
      /append-only/i,
    )
  })

  it('blocks hard-deleting a facility that has audit history', async () => {
    // Restrict rather than SetNull, because nulling the column would itself be
    // an update the trigger rejects.
    await expect(prisma.facility.delete({ where: { id: facilityId } })).rejects.toThrow()
  })
})

describe.skipIf(!hasDatabase)('recording', () => {
  it('refuses a privileged action with no reason code', async () => {
    await expect(
      recordAudit({
        actor: staffActor(),
        action: 'fee.waived',
        entityType: 'Invoice',
        entityId: 'i-1',
        facilityId,
        correlationId,
      }),
    ).rejects.toBeInstanceOf(MissingReasonCodeError)

    await expect(
      recordAudit({
        actor: staffActor(),
        action: 'fee.waived',
        entityType: 'Invoice',
        entityId: 'i-1',
        facilityId,
        reasonCode: '   ',
        correlationId,
      }),
    ).rejects.toBeInstanceOf(MissingReasonCodeError)
  })

  it('stores only the changed fields, redacted', async () => {
    const entry = await recordAudit({
      actor: staffActor(),
      action: 'user.role_changed',
      entityType: 'StaffUser',
      entityId: staffId,
      facilityId,
      reasonCode: 'management_approval',
      correlationId,
      before: { firstName: 'Ada', passwordHash: 'old', status: 'active' },
      after: { firstName: 'Ada', passwordHash: 'new', status: 'suspended' },
    })

    expect(entry.before).toEqual({ passwordHash: '[redacted]', status: 'active' })
    expect(entry.after).toEqual({ passwordHash: '[redacted]', status: 'suspended' })
    expect(JSON.stringify(entry)).not.toContain('old')
  })

  it('merges extra context into the after value', async () => {
    const entry = await recordAudit({
      actor: staffActor(),
      action: 'fee.waived',
      entityType: 'Invoice',
      entityId: 'i-2',
      facilityId,
      reasonCode: 'customer_goodwill',
      correlationId,
      context: { amountCents: 2_500 },
    })
    expect(entry.after).toMatchObject({ amountCents: 2_500 })
  })

  it('labels non-staff actors so the row satisfies the actor constraint', async () => {
    const tenantEntry = await recordAudit({
      actor: { type: 'tenant', tenantId: 't-1' },
      action: 'password.reset_completed',
      entityType: 'Tenant',
      entityId: 't-1',
      correlationId,
    })
    expect(tenantEntry.actorType).toBe('tenant')
    expect(tenantEntry.actorLabel).toBe('tenant:t-1')

    const systemEntry = await recordAudit({
      actor: { type: 'system', label: 'billing-run' },
      action: 'notice.generated',
      entityType: 'Notice',
      entityId: 'n-1',
      facilityId,
      correlationId,
    })
    expect(systemEntry.actorType).toBe('system')
    expect(systemEntry.actorLabel).toBe('billing-run')
  })

  it('rejects a staff entry with no staff id at the database level', async () => {
    await expect(
      prisma.auditLog.create({
        data: {
          actorType: 'staff',
          actorStaffId: null,
          actorLabel: 'someone',
          entityType: 'Unit',
          entityId: 'u-1',
          action: 'unit.status_overridden',
        },
      }),
    ).rejects.toThrow()
  })
})

describe.skipIf(!hasDatabase)('querying', () => {
  it('filters by entity, action and facility', async () => {
    const byEntity = await findAuditEntries({ entityType: 'Payment', entityId: 'p-immutable' })
    expect(byEntity.length).toBeGreaterThanOrEqual(1)
    expect(byEntity.every((e) => e.entityType === 'Payment')).toBe(true)

    const byAction = await findAuditEntries({ action: 'fee.waived', facilityIds: [facilityId] })
    expect(byAction.every((e) => e.action === 'fee.waived')).toBe(true)

    const scoped = await findAuditEntries({ facilityIds: [facilityId] })
    expect(scoped.every((e) => e.facilityId === facilityId)).toBe(true)
  })

  it('returns nothing for an empty facility scope', async () => {
    // Matches the fail-closed behaviour of facilityScope() in B-004.
    expect(await findAuditEntries({ facilityIds: [] })).toEqual([])
  })

  it('filters by date range', async () => {
    const future = await findAuditEntries({ from: new Date(Date.now() + 60_000) })
    expect(future).toEqual([])

    const recent = await findAuditEntries({
      from: new Date(Date.now() - 10 * 60_000),
      facilityIds: [facilityId],
    })
    expect(recent.length).toBeGreaterThan(0)
  })

  it('returns newest first', async () => {
    const entries = await findAuditEntries({ facilityIds: [facilityId], limit: 50 })
    const times = entries.map((e) => e.occurredAt.getTime())
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })
})
