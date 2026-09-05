import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../packages/db'
import { broadcastAudience, sendBroadcast } from '../apps/web/lib/admin/broadcast'
import { suppress } from '../apps/web/lib/comms/service'
import * as provider from '../apps/web/lib/comms/provider'
import type { Actor } from '../apps/web/lib/rbac/actor'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// PRD 05 CN-21 (B-090 part 4). The manual broadcast, against the real seeded
// `broadcast.*` templates.
//
// Everything asserted here is a rule the send is supposed to inherit rather
// than reimplement — the dedupe, the idempotency, the marketing quiet-hours
// window and the suppression list — because "the broadcast quietly got its own
// copy of the rules" is the failure this whole design is arranged against.
//
// The clock is PINNED on every test that expects a marketing send to land:
// FR-MSG-5 refuses marketing before 8am and from 9pm facility-local against
// the real wall clock, so an unpinned suite passes between 8am and 9pm Central
// and fails outside it, as "expected 1 to be 0".

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let twoUnitTenantId = ''
let buildingBTenantId = ''
let buildingBEmail = ''
let staffUserId = ''

const actor = (): Actor => ({
  kind: 'staff',
  staffUserId,
  assignments: [
    {
      facilityId,
      roleKey: 'manager',
      rank: 20,
      permissions: new Set<PermissionKey>(['comms:broadcast']),
      limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
    },
  ],
})

let sends: { to: string; subject: string; text: string }[] = []
function fakeProvider(): provider.MessageProvider {
  return {
    name: 'test',
    async sendEmail(email) {
      sends.push({ to: email.to, subject: email.subject, text: email.text })
      return { ok: true, providerMessageId: `test_${sends.length}` }
    },
  }
}

/// 2pm Central — inside FR-MSG-5's marketing window, so a marketing broadcast
/// is expected to go out rather than be held.
const DAYTIME = new Date('2026-09-04T19:00:00.000Z')

describeDb('broadcast (CN-21)', () => {
  beforeAll(async () => {
    const facility = await prisma.facility.create({
      data: {
        name: `Broadcast Test ${suffix}`,
        slug: `broadcast-${suffix}`,
        addressLine1: '1 Storage Way',
        city: 'Austin',
        state: 'TX',
        postalCode: '78704',
        timezone: 'America/Chicago',
        phone: '512-555-0100',
      },
    })
    facilityId = facility.id

    const staff = await prisma.staffUser.create({
      data: { email: `broadcast-staff-${suffix}@example.com`, firstName: 'Priya', lastName: 'Manager' },
    })
    staffUserId = staff.id

    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })

    async function tenantWithUnits(
      label: string,
      units: { number: string; building: string | null }[],
      status: 'active' | 'ended' = 'active',
    ) {
      const tenant = await prisma.tenant.create({
        data: {
          email: `broadcast-${label}-${suffix}@example.com`,
          firstName: 'Ada',
          lastName: label,
        },
      })
      for (const spec of units) {
        const unit = await prisma.unit.create({
          data: { facilityId, unitTypeId: unitType.id, number: spec.number, building: spec.building },
        })
        await prisma.lease.create({
          data: {
            facilityId,
            tenantId: tenant.id,
            unitId: unit.id,
            status,
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            monthlyRateCents: 12_900,
            billingDay: 1,
          },
        })
      }
      return tenant
    }

    // The multi-unit renter is the dedupe case: two leases, one person.
    twoUnitTenantId = (
      await tenantWithUnits('two-units', [
        { number: `A-01-${suffix}`, building: 'A' },
        { number: `A-02-${suffix}`, building: 'A' },
      ])
    ).id
    const bTenant = await tenantWithUnits('building-b', [{ number: `B-01-${suffix}`, building: 'B' }])
    buildingBTenantId = bTenant.id
    buildingBEmail = bTenant.email
    // A former tenant, who is not a channel (D-30).
    await tenantWithUnits('moved-out', [{ number: `C-01-${suffix}`, building: 'C' }], 'ended')
  })

  beforeEach(() => {
    sends = []
    vi.spyOn(provider, 'selectProvider').mockReturnValue(fakeProvider())
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.suppression.deleteMany({ where: { address: buildingBEmail } })
  })

  afterAll(async () => {
    if (!hasDatabase) return
    await prisma.message.deleteMany({ where: { facilityId } })
    await prisma.lease.deleteMany({ where: { facilityId } })
    await prisma.unit.deleteMany({ where: { facilityId } })
    await prisma.unitType.deleteMany({ where: { facilityId } })
    await prisma.tenant.deleteMany({ where: { email: { contains: `-${suffix}@example.com` } } })
    // The facility and the staff user are deliberately NOT deleted: this suite
    // writes an audit row against both, and `audit_log`'s append-only trigger
    // refuses the CASCADE (B-185). `npm run db:reset-test` is the reclaim.
    await prisma.$disconnect()
  })

  function input(overrides: Partial<Parameters<typeof sendBroadcast>[1]> = {}) {
    return {
      facilityId,
      templateKey: 'broadcast.notice',
      subject: 'Gate closed Thursday morning',
      message: 'The gate motor is being replaced on Thursday. The gate stays open 8am to noon.',
      filter: {},
      ...overrides,
    }
  }

  it('counts a two-unit tenant once, and leaves a former tenant out', async () => {
    const everyone = await broadcastAudience(actor(), facilityId, {})
    expect(everyone).toHaveLength(2)

    const multi = everyone.find((r) => r.tenantId === twoUnitTenantId)
    expect(multi?.unitNumbers).toHaveLength(2)
    expect(everyone.map((r) => r.tenantId)).not.toContain(
      // the ended lease's tenant is reachable by nothing here
      (await prisma.tenant.findFirstOrThrow({ where: { lastName: 'moved-out', email: { contains: suffix } } })).id,
    )
  })

  it('narrows to one building, and to specific units', async () => {
    const inB = await broadcastAudience(actor(), facilityId, { building: 'B' })
    expect(inB.map((r) => r.tenantId)).toEqual([buildingBTenantId])

    const byUnit = await broadcastAudience(actor(), facilityId, { unitNumbers: [`A-01-${suffix}`] })
    expect(byUnit.map((r) => r.tenantId)).toEqual([twoUnitTenantId])
  })

  it('sends one operational message per tenant, through the seeded template', async () => {
    const result = await sendBroadcast(actor(), input())
    expect(result).toMatchObject({ ok: true, recipients: 2, sent: 2, failed: 0 })

    expect(sends).toHaveLength(2)
    expect(sends[0].subject).toContain('Gate closed Thursday morning')
    // The frame is the template's, not the sender's.
    expect(sends[0].text).toContain('Hi Ada,')
    expect(sends[0].text).toContain('The gate motor is being replaced')
    expect(sends[0].text).toContain('1 Storage Way, Austin, TX 78704')
    // Operational mail carries no unsubscribe link — that is a marketing
    // control, and offering one on an outage notice invites a tenant to opt
    // out of the notices that matter.
    expect(sends[0].text).not.toContain('Unsubscribe:')
  })

  it('refuses to send the same announcement twice', async () => {
    await sendBroadcast(actor(), input())
    expect(sends).toHaveLength(2)

    sends = []
    const again = await sendBroadcast(actor(), input())
    // Same wording, same audience, same day: the second press reaches the
    // provider zero times, and still reports honestly on what exists.
    expect(sends).toHaveLength(0)
    expect(again).toMatchObject({ ok: true, recipients: 2, sent: 2 })
  })

  it('a marketing announcement carries an unsubscribe link and skips an unsubscribed tenant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(DAYTIME)

    await suppress({ channel: 'email', address: buildingBEmail, reason: 'unsubscribe' })

    const result = await sendBroadcast(
      actor(),
      input({ templateKey: 'broadcast.announcement', subject: 'Half price on your second month' }),
    )
    expect(result).toMatchObject({ ok: true, recipients: 2, sent: 1, suppressed: 1 })

    expect(sends).toHaveLength(1)
    expect(sends[0].text).toContain('Unsubscribe:')
    // US-13 AC2's other half: the postal address, appended by the send path
    // rather than written into a template an operator can edit away.
    expect(sends[0].text).toContain('1 Storage Way, Austin, TX 78704')
  })

  it('holds a marketing announcement back during quiet hours, and says so in the log', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 10pm Central — after FR-MSG-5's 9pm cutoff.
    vi.setSystemTime(new Date('2026-09-05T03:00:00.000Z'))

    const result = await sendBroadcast(
      actor(),
      input({ templateKey: 'broadcast.announcement', subject: 'Half price on your second month' }),
    )
    expect(result).toMatchObject({ ok: true, recipients: 2, sent: 0, cancelled: 2 })
    expect(sends).toHaveLength(0)

    const held = await prisma.message.findMany({ where: { facilityId }, select: { error: true } })
    expect(held.every((row) => row.error === 'skipped: marketing_quiet_hours')).toBe(true)
  })

  it('sends an operational notice at the same hour, because quiet hours are a marketing rule', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-05T03:00:00.000Z'))

    const result = await sendBroadcast(actor(), input({ subject: 'Water shut off overnight' }))
    expect(result).toMatchObject({ ok: true, sent: 2 })
  })

  it('refuses an empty message rather than mailing a blank one', async () => {
    expect(await sendBroadcast(actor(), input({ message: '   ' }))).toMatchObject({
      ok: false,
      problem: 'empty',
    })
    expect(sends).toHaveLength(0)
  })
})
