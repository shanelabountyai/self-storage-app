import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  createFacility,
  DuplicateSlugError,
  InvalidSlugError,
  InvalidTimezoneError,
} from '../apps/web/lib/admin/facility-settings'
import { facilityReadiness } from '../apps/web/lib/admin/facility-readiness'
import { ForbiddenError } from '../apps/web/lib/rbac/authorize'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-237 / PRD 02 US-3, US-4, US-29, against real rows.
//
// The property that matters is not "a facility row appears" — it is that the
// site is not born SILENT. A hand-inserted facility invoices rent, charges no
// late fee, runs no ladder and blocks every lien sale, with no error anywhere;
// the two halves of this item are that the org defaults arrive as ordinary
// effective-dated rows at birth, and that whatever did not arrive is named.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let staffId = ''

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

function input(key: string) {
  return {
    name: `New Site ${key} ${suffix}`,
    slug: `new-site-${key}-${suffix}`,
    addressLine1: '9 Storage Way',
    addressLine2: null,
    city: 'Austin',
    state: 'tx',
    postalCode: '78704',
    timezone: 'America/Chicago',
    phone: null,
    email: null,
    latitude: 30.2453,
    longitude: -97.7714,
  }
}

function create(key: string, options: Parameters<typeof actor>[0] = { allFacilities: true }) {
  return createFacility(actor(options), input(key))
}

describeDb('creating a facility (US-3)', () => {
  beforeAll(async () => {
    const staff = await prisma.staffUser.create({
      data: { email: `newfac-${suffix}@example.com`, firstName: 'Ada', lastName: 'Owner' },
    })
    staffId = staff.id
  })

  // Nothing to clean up: facilities and staff cannot be reclaimed once they
  // have audit history — `audit_log` is append-only and RESTRICT-references
  // both (B-185), so `npm run db:reset-test` is the only real cleanup. And this
  // suite deliberately owns no shared table to reset.

  it('refuses without an all-facilities assignment', async () => {
    // There is no facility to be assigned to yet, so a manager at three sites
    // adding a fourth to the portfolio is not a scoped act at all.
    await expect(createFacility(actor({ facilityIds: [] }), input('forbidden'))).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('refuses a slug that would not survive being printed on a sign', async () => {
    await expect(
      createFacility(actor({ allFacilities: true }), { ...input('bad'), slug: 'Austin South' }),
    ).rejects.toBeInstanceOf(InvalidSlugError)
  })

  it('refuses a slug another facility already uses', async () => {
    const first = await create('dupe')
    const taken = await prisma.facility.findUniqueOrThrow({ where: { id: first.id } })
    await expect(
      createFacility(actor({ allFacilities: true }), { ...input('dupe2'), slug: taken.slug }),
    ).rejects.toBeInstanceOf(DuplicateSlugError)
  })

  it('refuses a timezone nothing can format a due date in', async () => {
    await expect(
      createFacility(actor({ allFacilities: true }), { ...input('tz'), timezone: 'Mars/Olympus' }),
    ).rejects.toBeInstanceOf(InvalidTimezoneError)
  })

  it('normalizes the state, because compliance config is keyed on it', async () => {
    const { id } = await create('state')
    const facility = await prisma.facility.findUniqueOrThrow({ where: { id } })
    expect(facility.state).toBe('TX')
  })

  it('names the map position only when it is actually absent', async () => {
    const { id } = await create('nogeo')
    await prisma.facility.update({ where: { id }, data: { latitude: null } })
    expect((await facilityReadiness(id)).map((gap) => gap.kind)).toContain('geo')
  })

  it('drops a gap once the setting exists', async () => {
    const { id } = await create('fixed')
    expect((await facilityReadiness(id)).map((gap) => gap.kind)).toContain('tax')

    await prisma.taxComponent.create({
      data: {
        facilityId: id,
        jurisdiction: 'state',
        rateBasisPoints: 825,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    })
    expect((await facilityReadiness(id)).map((gap) => gap.kind)).not.toContain('tax')
  })

  it('does not count a rate that has not taken effect yet', async () => {
    // Effective-dated: a rate filed for next quarter bills nothing today, so
    // "configured" has to mean "in force", not "a row exists".
    const { id } = await create('future')
    await prisma.taxComponent.create({
      data: {
        facilityId: id,
        jurisdiction: 'state',
        rateBasisPoints: 825,
        effectiveFrom: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    expect((await facilityReadiness(id)).map((gap) => gap.kind)).toContain('tax')
  })

  it('writes an audit row naming the facility it created', async () => {
    const { id } = await create('audit')
    const row = await prisma.auditLog.findFirst({
      where: { action: 'facility.created', entityId: id },
    })
    expect(row).not.toBeNull()
    expect(row?.facilityId).toBe(id)
  })
})
