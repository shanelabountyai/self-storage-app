import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  compareFacilities,
  getOrgDefault,
  pushOrgDefault,
  saveOrgDefault,
  templateOverrides,
} from '../apps/web/lib/admin/org-defaults'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-079 / PRD 02 US-4, against real rows. The properties only a database shows:
// a push writes ordinary effective-dated rows into the facility's OWN tables,
// a facility that already matches is not written to at all, and the facility
// scoping on a push is checked per facility rather than once for the batch.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityA = ''
let facilityB = ''
let staffId = ''

const EFFECTIVE = new Date('2026-09-01T00:00:00.000Z')

const FEES = { fees: [{ feeType: 'admin', amountCents: 2_500 }, { feeType: 'nsf', amountCents: 3_000 }] }

function actor(options: { allFacilities?: boolean; facilityIds?: string[] } = {}): Actor {
  const assignments = options.allFacilities
    ? [{ facilityId: null }]
    : (options.facilityIds ?? []).map((facilityId) => ({ facilityId }))

  return {
    kind: 'staff',
    staffUserId: staffId,
    assignments: assignments.map((assignment) => ({
      ...assignment,
      roleKey: 'owner',
      rank: 40,
      permissions: new Set<PermissionKey>(['org:defaults', 'facility:settings'] as never),
      limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
    })),
  }
}

describeDb('org defaults (US-4)', () => {
  beforeAll(async () => {
    const staff = await prisma.staffUser.create({
      data: { email: `org-${suffix}@example.com`, firstName: 'Ada', lastName: 'Owner' },
    })
    staffId = staff.id

    for (const [index, key] of ['a', 'b'].entries()) {
      const facility = await prisma.facility.create({
        data: {
          name: `Org ${key.toUpperCase()} ${suffix}`,
          slug: `org-${key}-${suffix}`,
          addressLine1: `${index + 1} Storage Way`,
          city: 'Austin',
          state: 'TX',
          postalCode: '78704',
          timezone: 'America/Chicago',
        },
      })
      if (key === 'a') facilityA = facility.id
      else facilityB = facility.id
    }
  })

  beforeEach(async () => {
    await prisma.feeSchedule.deleteMany({ where: { facilityId: { in: [facilityA, facilityB] } } })
    await prisma.lateFeeRule.deleteMany({ where: { facilityId: { in: [facilityA, facilityB] } } })
    await prisma.orgDefault.deleteMany({})
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.feeSchedule.deleteMany({ where: { facilityId: { in: [facilityA, facilityB] } } })
    await prisma.lateFeeRule.deleteMany({ where: { facilityId: { in: [facilityA, facilityB] } } })
    await prisma.orgDefault.deleteMany({})
    // Facility and staff stay: `audit_log` is append-only and
    // RESTRICT-references the facility.
  })

  it('refuses to save a default without an all-facilities assignment', async () => {
    // Setting what the other nine sites charge is not a three-site manager's
    // decision. `can()` asked with a null facilityId is what enforces it.
    await expect(
      saveOrgDefault(actor({ facilityIds: [facilityA] }), {
        scope: 'fee_schedule',
        label: 'Nope',
        payload: FEES,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('changes nothing at any facility until it is pushed', async () => {
    await saveOrgDefault(actor({ allFacilities: true }), {
      scope: 'fee_schedule',
      label: '2026 fee review',
      payload: FEES,
    })

    expect(await prisma.feeSchedule.count({ where: { facilityId: facilityA } })).toBe(0)
    expect((await getOrgDefault('fee_schedule'))?.label).toBe('2026 fee review')
  })

  it('flags a facility that has never been pushed to as missing, not overridden', async () => {
    await saveOrgDefault(actor({ allFacilities: true }), {
      scope: 'fee_schedule',
      label: 'Fees',
      payload: FEES,
    })

    const rows = await compareFacilities(actor({ allFacilities: true }), 'fee_schedule')
    const a = rows.find((row) => row.facilityId === facilityA)
    expect(a?.report.matches).toBe(false)
    expect(a?.report.missing).toEqual(['admin', 'nsf'])
    expect(a?.report.differences).toEqual([])
  })

  it('writes effective-dated rows into the facility’s own table', async () => {
    const who = actor({ allFacilities: true })
    await saveOrgDefault(who, { scope: 'fee_schedule', label: 'Fees', payload: FEES })

    const results = await pushOrgDefault(who, {
      scope: 'fee_schedule',
      facilityIds: [facilityA],
      effectiveFrom: EFFECTIVE,
    })
    expect(results.map((r) => r.outcome)).toEqual(['pushed'])

    const rows = await prisma.feeSchedule.findMany({
      where: { facilityId: facilityA },
      orderBy: { feeType: 'asc' },
    })
    expect(rows.map((row) => [row.feeType, row.amountCents, row.effectiveFrom.toISOString()])).toEqual([
      ['admin', 2_500, EFFECTIVE.toISOString()],
      ['nsf', 3_000, EFFECTIVE.toISOString()],
    ])
  })

  it('reports a facility as matching once it has been pushed to', async () => {
    const who = actor({ allFacilities: true })
    await saveOrgDefault(who, { scope: 'fee_schedule', label: 'Fees', payload: FEES })
    await pushOrgDefault(who, {
      scope: 'fee_schedule',
      facilityIds: [facilityA],
      // Dated in the past so it is in force NOW — the comparison is against
      // what is live today, not against a future-dated row nobody has felt.
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    })

    const rows = await compareFacilities(who, 'fee_schedule')
    expect(rows.find((row) => row.facilityId === facilityA)?.report.matches).toBe(true)
    expect(rows.find((row) => row.facilityId === facilityB)?.report.matches).toBe(false)
  })

  it('does not write to a facility that already matches', async () => {
    const who = actor({ allFacilities: true })
    await saveOrgDefault(who, { scope: 'fee_schedule', label: 'Fees', payload: FEES })
    const past = new Date('2026-01-01T00:00:00.000Z')
    await pushOrgDefault(who, { scope: 'fee_schedule', facilityIds: [facilityA], effectiveFrom: past })

    const second = await pushOrgDefault(who, {
      scope: 'fee_schedule',
      facilityIds: [facilityA],
      effectiveFrom: EFFECTIVE,
    })

    // An effective-dated table is append-only. Pushing unconditionally would
    // file an identical row every time somebody pressed the button, and the fee
    // history an auditor reads would fill with changes that changed nothing.
    expect(second.map((r) => r.outcome)).toEqual(['already_matched'])
    expect(await prisma.feeSchedule.count({ where: { facilityId: facilityA } })).toBe(2)
  })

  it('overwrites a local override on the next push', async () => {
    const who = actor({ allFacilities: true })
    await saveOrgDefault(who, { scope: 'fee_schedule', label: 'Fees', payload: FEES })
    await prisma.feeSchedule.create({
      data: {
        facilityId: facilityA,
        feeType: 'admin',
        amountCents: 9_900,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    })

    const before = await compareFacilities(who, 'fee_schedule')
    expect(before.find((row) => row.facilityId === facilityA)?.report.differences).toEqual(['admin'])

    await pushOrgDefault(who, {
      scope: 'fee_schedule',
      facilityIds: [facilityA],
      effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
    })

    const after = await compareFacilities(who, 'fee_schedule')
    expect(after.find((row) => row.facilityId === facilityA)?.report.matches).toBe(true)
    // The override is not deleted — the history says the site charged $99 for
    // a month, which is what happened.
    expect(await prisma.feeSchedule.count({ where: { facilityId: facilityA, feeType: 'admin' } })).toBe(2)
  })

  it('checks facility access per facility, not once for the batch', async () => {
    // The ids arrive from a form. A manager must not reach a facility they hold
    // no assignment for by adding its id to the POST.
    await saveOrgDefault(actor({ allFacilities: true }), {
      scope: 'fee_schedule',
      label: 'Fees',
      payload: FEES,
    })

    const partial: Actor = {
      kind: 'staff',
      staffUserId: staffId,
      assignments: [
        {
          facilityId: null,
          roleKey: 'owner',
          rank: 40,
          permissions: new Set<PermissionKey>(['org:defaults'] as never),
          limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
        },
        {
          facilityId: facilityA,
          roleKey: 'manager',
          rank: 20,
          permissions: new Set<PermissionKey>(['facility:settings'] as never),
          limits: { maxFeeWaiverCents: null, maxRefundCents: null, maxCreditCents: null },
        },
      ],
    }

    const results = await pushOrgDefault(partial, {
      scope: 'fee_schedule',
      facilityIds: [facilityA, facilityB],
      effectiveFrom: EFFECTIVE,
    })

    expect(results.find((r) => r.facilityId === facilityA)?.outcome).toBe('pushed')
    expect(results.find((r) => r.facilityId === facilityB)?.outcome).toBe('forbidden')
    expect(await prisma.feeSchedule.count({ where: { facilityId: facilityB } })).toBe(0)
  })

  it('pushes a late-fee ladder as one row per rung', async () => {
    const who = actor({ allFacilities: true })
    await saveOrgDefault(who, {
      scope: 'late_fee_ladder',
      label: 'Ladder',
      payload: {
        ladder: [
          { step: 1, daysPastDue: 10, amountCents: 2_000, percentBasisPoints: 0, basis: 'flat', capCents: null },
          { step: 2, daysPastDue: 30, amountCents: 2_000, percentBasisPoints: 1_000, basis: 'greater', capCents: 5_000 },
        ],
      },
    })

    await pushOrgDefault(who, {
      scope: 'late_fee_ladder',
      facilityIds: [facilityA],
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    })

    const rows = await prisma.lateFeeRule.findMany({
      where: { facilityId: facilityA },
      orderBy: { step: 'asc' },
    })
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      step: 2,
      daysPastDue: 30,
      percentBasisPoints: 1_000,
      basis: 'greater',
      capCents: 5_000,
    })
    expect((await compareFacilities(who, 'late_fee_ladder')).find((r) => r.facilityId === facilityA)?.report.matches).toBe(true)
  })

  it('audits the push once per facility', async () => {
    const who = actor({ allFacilities: true })
    await saveOrgDefault(who, { scope: 'fee_schedule', label: 'Fees', payload: FEES })
    await pushOrgDefault(who, {
      scope: 'fee_schedule',
      facilityIds: [facilityA, facilityB],
      effectiveFrom: EFFECTIVE,
    })

    // "What changed HERE and who did it" is the question the log gets asked; a
    // single org-level row listing two facility ids does not answer it.
    for (const facilityId of [facilityA, facilityB]) {
      const entry = await prisma.auditLog.findFirst({
        where: { action: 'org_default.pushed', entityId: facilityId },
        orderBy: { occurredAt: 'desc' },
      })
      expect(entry?.facilityId).toBe(facilityId)
    }
  })

  it('lists which facilities override a message template', async () => {
    const who = actor({ allFacilities: true })
    const template = await prisma.messageTemplate.create({
      data: {
        key: `org_test_${suffix}`,
        channel: 'email',
        classification: 'transactional',
        facilityId: facilityA,
        bodyText: 'Local wording.',
        requiredMergeFields: [],
      },
    })

    const rows = await templateOverrides(who)
    expect(rows.find((row) => row.facilityId === facilityA)?.keys).toContain(template.key)
    expect(rows.find((row) => row.facilityId === facilityB)?.keys).toEqual([])

    await prisma.messageTemplate.delete({ where: { id: template.id } })
  })
})
