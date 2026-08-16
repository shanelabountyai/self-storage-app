import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../packages/db'
import {
  generateReferralCode,
  mintInvite,
  qualifyReferral,
  usableInvite,
} from '../apps/web/lib/referrals/service'
import { REFERRAL_CODE_LENGTH } from '../packages/core/referrals'
import { generateInvoices } from '../apps/web/lib/billing/invoices'
import { processCommsEvent } from '../apps/web/lib/comms/service'
import { revenueReport } from '../apps/web/lib/admin/revenue-report'
import type { Actor } from '../apps/web/lib/rbac/actor'
import * as provider from '../apps/web/lib/comms/provider'
import { vi } from 'vitest'
import type { PermissionKey } from '@storage/db/rbac-catalog'

// B-100 / PRD 10 §5.1, §5.3, §5.4, §6.1, against real rows.
//
// The properties worth a database are the ones a pure test cannot see: the
// atomic single-use redemption, the fraud rules that are queries rather than
// booleans, and the rule that a refusal is always RECORDED rather than dropped.

const hasDatabase = Boolean(process.env.DATABASE_URL)
const describeDb = hasDatabase ? describe : describe.skip
const suffix = randomUUID().slice(0, 8)

let facilityId = ''
let otherFacilityId = ''
let unitTypeId = ''
let referrerId = ''
let referrerLeaseId = ''
let counter = 0

async function makeFacility(name: string): Promise<string> {
  const facility = await prisma.facility.create({
    data: {
      name,
      slug: `${name.toLowerCase()}-${suffix}`,
      addressLine1: '1 Storage Way',
      city: 'Austin',
      state: 'TX',
      postalCode: '78704',
      timezone: 'America/Chicago',
      // The refusal template requires `facility.phone` — "call us and we will
      // go through it with you" is the whole point of that message, and FR-9
      // fails a render loudly rather than sending one with a hole in it. A
      // facility without a phone is not a realistic fixture here.
      phone: '512-555-0100',
      // The program is off by default (§6.1), so every test that expects a
      // referral to work has to turn it on — which is itself the coverage for
      // "off by default" being real.
      referralEnabled: true,
    },
  })
  return facility.id
}

async function makeTenant(overrides: { email?: string; phone?: string | null } = {}) {
  counter += 1
  return prisma.tenant.create({
    data: {
      email: overrides.email ?? `ref-${suffix}-${counter}@example.com`,
      firstName: 'Ada',
      lastName: 'Renter',
      phone: overrides.phone === undefined ? `512555${String(2000 + counter).slice(-4)}` : overrides.phone,
    },
  })
}

async function makeLease(tenantId: string, atFacilityId = facilityId): Promise<string> {
  counter += 1
  const unit = await prisma.unit.create({
    data: { facilityId: atFacilityId, unitTypeId, number: `R-${suffix}-${counter}` },
  })
  const lease = await prisma.lease.create({
    data: {
      facilityId: atFacilityId,
      tenantId,
      unitId: unit.id,
      status: 'active',
      startDate: new Date('2026-08-01T00:00:00Z'),
      billingDay: 1,
      monthlyRateCents: 12_900,
    },
  })
  return lease.id
}

describeDb('referral program core', () => {
  beforeAll(async () => {
    facilityId = await makeFacility('RefA')
    otherFacilityId = await makeFacility('RefB')
    const unitType = await prisma.unitType.create({
      data: { facilityId, name: `10x10 ${suffix}`, widthFt: 10, lengthFt: 10 },
    })
    unitTypeId = unitType.id
    // The other facility needs its own unit type for cross-facility leases.
    await prisma.unitType.create({
      data: { facilityId: otherFacilityId, name: `10x10b ${suffix}`, widthFt: 10, lengthFt: 10 },
    })

    const referrer = await makeTenant()
    referrerId = referrer.id
    referrerLeaseId = await makeLease(referrerId)
  })

  afterEach(async () => {
    await prisma.domainEvent.deleteMany({ where: { facilityId: { in: [facilityId, otherFacilityId] } } })
    await prisma.referral.deleteMany({ where: { facilityId: { in: [facilityId, otherFacilityId] } } })
    await prisma.referralInvite.deleteMany({
      where: { facilityId: { in: [facilityId, otherFacilityId] } },
    })
    await prisma.facility.updateMany({
      where: { id: { in: [facilityId, otherFacilityId] } },
      data: {
        referralEnabled: true,
        referralOpenInviteCap: 5,
        referralAnnualCap: 10,
        referralCrossFacility: false,
        referralRewardCents: 5000,
        refereeRewardCents: 5000,
        referralInviteExpiryDays: 60,
      },
    })
  })

  describe('minting — FR-REF-1', () => {
    it('mints a code of the right shape', async () => {
      const result = await mintInvite(referrerId)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')
      expect(result.code).toHaveLength(REFERRAL_CODE_LENGTH)
      expect(result.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]+$/)
    })

    it('refuses a tenant with no active lease, with a reason', async () => {
      // §5.1 AC: "a tenant with no active lease sees why they cannot refer,
      // not a broken link."
      const stranger = await makeTenant()
      const result = await mintInvite(stranger.id)
      expect(result).toEqual({ ok: false, reason: 'no_active_lease' })
    })

    it('refuses when the program is off at that facility', async () => {
      // Off by default (§6.1) — an operator turns it on knowingly.
      await prisma.facility.update({ where: { id: facilityId }, data: { referralEnabled: false } })
      const result = await mintInvite(referrerId)
      expect(result).toEqual({ ok: false, reason: 'program_disabled' })
    })

    it('caps outstanding invites', async () => {
      // §5.4: "minting a hundred and posting them all is the same attack
      // wearing a different hat."
      await prisma.facility.update({ where: { id: facilityId }, data: { referralOpenInviteCap: 2 } })
      expect((await mintInvite(referrerId)).ok).toBe(true)
      expect((await mintInvite(referrerId)).ok).toBe(true)
      expect(await mintInvite(referrerId)).toEqual({ ok: false, reason: 'open_invite_cap' })
    })

    it('does not count an EXPIRED invite against the cap', async () => {
      // Expired is not outstanding exposure any more. Counting it would slowly
      // lock a tenant out of a program they used correctly a year ago.
      await prisma.facility.update({ where: { id: facilityId }, data: { referralOpenInviteCap: 1 } })
      await prisma.referralInvite.create({
        data: {
          code: `OLD${suffix.slice(0, 5).toUpperCase()}`,
          referrerTenantId: referrerId,
          facilityId,
          expiresAt: new Date(Date.now() - 86_400_000),
        },
      })
      expect((await mintInvite(referrerId)).ok).toBe(true)
    })

    it('generates codes that do not collide across many draws', async () => {
      const codes = new Set(Array.from({ length: 500 }, () => generateReferralCode()))
      expect(codes.size).toBe(500)
    })
  })

  describe('/r/{code} lookup — FR-REF-1 AC', () => {
    it('resolves a live invite to its facility', async () => {
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      const found = await usableInvite(minted.code)
      expect(found?.facilityId).toBe(facilityId)
      expect(found?.referrerTenantId).toBe(referrerId)
    })

    it('is case-insensitive, because the code gets read aloud', async () => {
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      expect(await usableInvite(minted.code.toLowerCase())).not.toBeNull()
      expect(await usableInvite(` ${minted.code} `)).not.toBeNull()
    })

    it('returns nothing — not an error — for a dead, expired or unknown code', async () => {
      // §5.1 AC: "a prospect must never see 'this code is dead' — that is a
      // conversation between the business and the tenant, not something to
      // fail a stranger's page load with." Null here means "no referral", and
      // the route sends them to the facility page normally.
      expect(await usableInvite('NOSUCHCD')).toBeNull()
      expect(await usableInvite('')).toBeNull()

      const expired = await prisma.referralInvite.create({
        data: {
          code: `EXP${suffix.slice(0, 5).toUpperCase()}`,
          referrerTenantId: referrerId,
          facilityId,
          expiresAt: new Date(Date.now() - 1000),
        },
      })
      expect(await usableInvite(expired.code)).toBeNull()

      const spent = await prisma.referralInvite.create({
        data: {
          code: `USD${suffix.slice(0, 5).toUpperCase()}`,
          referrerTenantId: referrerId,
          facilityId,
          expiresAt: new Date(Date.now() + 86_400_000),
          redeemedAt: new Date(),
        },
      })
      expect(await usableInvite(spent.code)).toBeNull()
    })
  })

  describe('qualification — §4 and FR-REF-4', () => {
    async function refereeWithLease(overrides: Parameters<typeof makeTenant>[0] = {}, at = facilityId) {
      const referee = await makeTenant(overrides)
      const leaseId = await makeLease(referee.id, at)
      return { referee, leaseId }
    }

    it('earns both rewards and snapshots the amounts', async () => {
      await prisma.facility.update({
        where: { id: facilityId },
        data: { referralRewardCents: 2_500, refereeRewardCents: 7_500 },
      })
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      const { referee, leaseId } = await refereeWithLease()

      const result = await qualifyReferral({
        inviteId: minted.inviteId,
        refereeTenantId: referee.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: facilityId,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')
      // Separately configurable, because "give the new customer $75 and the
      // referrer $25" is a real campaign (§3).
      expect(result.referrerRewardCents).toBe(2_500)
      expect(result.refereeRewardCents).toBe(7_500)

      const row = await prisma.referral.findUniqueOrThrow({ where: { id: result.referralId } })
      expect(row.state).toBe('earned')
      expect(row.qualifiedAt).not.toBeNull()
      // Snapshotted: changing the program later must not rewrite what somebody
      // was already promised.
      await prisma.facility.update({
        where: { id: facilityId },
        data: { referralRewardCents: 1 },
      })
      const after = await prisma.referral.findUniqueOrThrow({ where: { id: result.referralId } })
      expect(after.referrerRewardCents).toBe(2_500)
    })

    it('consumes the invite on QUALIFICATION, not on the click', async () => {
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      // Clicking resolves the invite and must not spend it.
      await usableInvite(minted.code)
      expect(await usableInvite(minted.code)).not.toBeNull()

      const { referee, leaseId } = await refereeWithLease()
      await qualifyReferral({
        inviteId: minted.inviteId,
        refereeTenantId: referee.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: facilityId,
      })
      expect(await usableInvite(minted.code)).toBeNull()
    })

    it('refuses a self-referral by email and records it', async () => {
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      const referrer = await prisma.tenant.findUniqueOrThrow({ where: { id: referrerId } })
      // A different tenant row, same email — the first thing anyone tries.
      const { referee, leaseId } = await refereeWithLease({ email: referrer.email.toUpperCase() })

      const result = await qualifyReferral({
        inviteId: minted.inviteId,
        refereeTenantId: referee.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: facilityId,
      })

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.refusal).toBe('self_referral')
      // §5.4 AC: "a refused referral never silently drops."
      const row = await prisma.referral.findUniqueOrThrow({ where: { id: result.referralId! } })
      expect(row.state).toBe('refused')
      expect(row.refusedReason).toBe('self_referral')
    })

    it('refuses a self-referral by phone last-10', async () => {
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      const referrer = await prisma.tenant.findUniqueOrThrow({ where: { id: referrerId } })
      // Same number, written differently — which is how it would really arrive.
      const formatted = `(${referrer.phone!.slice(0, 3)}) ${referrer.phone!.slice(3, 6)}-${referrer.phone!.slice(6)}`
      const { referee, leaseId } = await refereeWithLease({ phone: formatted })

      const result = await qualifyReferral({
        inviteId: minted.inviteId,
        refereeTenantId: referee.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: facilityId,
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.refusal).toBe('self_referral')
    })

    it('refuses a referee who has rented here before', async () => {
      // "Otherwise a move-out and move-in pays $100."
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      const returning = await makeTenant()
      // An old, ended lease plus the new one.
      const old = await makeLease(returning.id)
      await prisma.lease.update({ where: { id: old }, data: { status: 'ended' } })
      const leaseId = await makeLease(returning.id)

      const result = await qualifyReferral({
        inviteId: minted.inviteId,
        refereeTenantId: returning.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: facilityId,
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.refusal).toBe('existing_tenant')
    })

    it('refuses a second referral of the same person, ever', async () => {
      const first = await mintInvite(referrerId)
      const second = await mintInvite(referrerId)
      if (!first.ok || !second.ok) throw new Error('unreachable')
      const { referee, leaseId } = await refereeWithLease()

      const earned = await qualifyReferral({
        inviteId: first.inviteId,
        refereeTenantId: referee.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: facilityId,
      })
      expect(earned.ok).toBe(true)

      const again = await qualifyReferral({
        inviteId: second.inviteId,
        refereeTenantId: referee.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: facilityId,
      })
      expect(again.ok).toBe(false)
      if (again.ok) throw new Error('unreachable')
      expect(again.refusal).toBe('already_referred')
    })

    it('refuses a different facility unless the operator opted in', async () => {
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      const { referee, leaseId } = await refereeWithLease({}, otherFacilityId)

      const refused = await qualifyReferral({
        inviteId: minted.inviteId,
        refereeTenantId: referee.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: otherFacilityId,
      })
      expect(refused.ok).toBe(false)
      if (refused.ok) throw new Error('unreachable')
      expect(refused.refusal).toBe('different_facility')
    })

    it('allows cross-facility when the operator opted in', async () => {
      await prisma.facility.update({
        where: { id: facilityId },
        data: { referralCrossFacility: true },
      })
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      const { referee, leaseId } = await refereeWithLease({}, otherFacilityId)

      const result = await qualifyReferral({
        inviteId: minted.inviteId,
        refereeTenantId: referee.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: otherFacilityId,
      })
      expect(result.ok).toBe(true)
    })

    it('refuses past the annual cap', async () => {
      await prisma.facility.update({ where: { id: facilityId }, data: { referralAnnualCap: 1 } })
      const first = await mintInvite(referrerId)
      const second = await mintInvite(referrerId)
      if (!first.ok || !second.ok) throw new Error('unreachable')

      const a = await refereeWithLease()
      expect(
        (await qualifyReferral({
          inviteId: first.inviteId,
          refereeTenantId: a.referee.id,
          refereeLeaseId: a.leaseId,
          refereeFacilityId: facilityId,
        })).ok,
      ).toBe(true)

      const b = await refereeWithLease()
      const capped = await qualifyReferral({
        inviteId: second.inviteId,
        refereeTenantId: b.referee.id,
        refereeLeaseId: b.leaseId,
        refereeFacilityId: facilityId,
      })
      expect(capped.ok).toBe(false)
      if (capped.ok) throw new Error('unreachable')
      expect(capped.refusal).toBe('annual_cap_reached')
    })

    it('records nothing for a code that does not exist', async () => {
      // A visitor arrived with a meaningless cookie. Nobody to tell, nothing
      // to record against — and crucially, the move-in still completes.
      const { referee, leaseId } = await refereeWithLease()
      const result = await qualifyReferral({
        inviteId: 'no-such-invite-id',
        refereeTenantId: referee.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: facilityId,
      })
      expect(result).toEqual({ ok: false, refusal: null, message: null, referralId: null })
      expect(await prisma.referral.count({ where: { facilityId } })).toBe(0)
    })

    it('gives one invite to exactly one friend under a race — §6.1', async () => {
      // The atomic conditional update. Two friends completing a move-in in the
      // same minute on the same posted code: one earns, one is refused with
      // the honest reason, and the invite is spent once.
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      const a = await refereeWithLease()
      const b = await refereeWithLease()

      const [first, second] = await Promise.all([
        qualifyReferral({
          inviteId: minted.inviteId,
          refereeTenantId: a.referee.id,
          refereeLeaseId: a.leaseId,
          refereeFacilityId: facilityId,
        }),
        qualifyReferral({
          inviteId: minted.inviteId,
          refereeTenantId: b.referee.id,
          refereeLeaseId: b.leaseId,
          refereeFacilityId: facilityId,
        }),
      ])

      const earned = [first, second].filter((r) => r.ok)
      expect(earned).toHaveLength(1)

      const invite = await prisma.referralInvite.findUniqueOrThrow({ where: { code: minted.code } })
      expect(invite.redeemedAt).not.toBeNull()

      // The loser is RECORDED, not dropped — the tenant can be told why.
      const refused = await prisma.referral.findMany({
        where: { inviteId: invite.id, state: 'refused' },
      })
      expect(refused).toHaveLength(1)
      expect(refused[0].refusedReason).toBe('invite_already_used')
    })
  })

  it('emits one event per RECIPIENT, so each message reaches the right person (§6.3)', async () => {
    // `processCommsEvent` resolves ONE recipient per event and runs every
    // matching rule against it. Two rules on a single `referral.qualified`
    // would both address the same person — which is how the referee's message
    // reaches the referrer. Splitting by recipient fits the architecture
    // instead of fighting it, and these assert the split is real.
    const minted = await mintInvite(referrerId)
    if (!minted.ok) throw new Error('unreachable')
    const referee = await makeTenant()
    const leaseId = await makeLease(referee.id)

    const earned = await qualifyReferral({
      inviteId: minted.inviteId,
      refereeTenantId: referee.id,
      refereeLeaseId: leaseId,
      refereeFacilityId: facilityId,
    })
    expect(earned.ok).toBe(true)

    const toReferrer = await prisma.domainEvent.findFirstOrThrow({
      where: { name: 'referral.qualified', facilityId },
      orderBy: { occurredAt: 'desc' },
    })
    // Entity is the TENANT being written to, so the existing resolver reaches
    // them — not the Referral, which has no resolver and never needed one.
    expect(toReferrer.entityType).toBe('Tenant')
    expect(toReferrer.entityId).toBe(referrerId)
    expect((toReferrer.payload as Record<string, unknown>).rewardCents).toBe(5_000)

    const toReferee = await prisma.domainEvent.findFirstOrThrow({
      where: { name: 'referral.reward_granted', facilityId },
      orderBy: { occurredAt: 'desc' },
    })
    expect(toReferee.entityType).toBe('Tenant')
    expect(toReferee.entityId).toBe(referee.id)
    expect((toReferee.payload as Record<string, unknown>).rewardCents).toBe(5_000)

    // And a refusal goes to the referrer, carrying the KEY rather than a
    // rendered sentence — so the message, the portal and the staff record can
    // never disagree about the same refusal.
    const second = await mintInvite(referrerId)
    if (!second.ok) throw new Error('unreachable')
    await qualifyReferral({
      inviteId: second.inviteId,
      refereeTenantId: referee.id,
      refereeLeaseId: leaseId,
      refereeFacilityId: facilityId,
    })
    const refused = await prisma.domainEvent.findFirstOrThrow({
      where: { name: 'referral.refused', facilityId },
      orderBy: { occurredAt: 'desc' },
    })
    expect(refused.entityId).toBe(referrerId)
    expect((refused.payload as Record<string, unknown>).refusal).toBe('already_referred')
  })

  it('splits referral rewards out of promotional discounts in the revenue report (§5.7)', async () => {
    // "One is acquisition cost and the other is a price decision" — the row's
    // own words. Merged, neither question is answerable, and the referral
    // figure is specifically the one compared against the aggregator fee it
    // displaces. Coupled to the description prefix the hand-off writes, which
    // is why both sides share one exported constant.
    const minted = await mintInvite(referrerId)
    if (!minted.ok) throw new Error('unreachable')
    const referee = await makeTenant()
    const leaseId = await makeLease(referee.id)
    await qualifyReferral({
      inviteId: minted.inviteId,
      refereeTenantId: referee.id,
      refereeLeaseId: leaseId,
      refereeFacilityId: facilityId,
    })

    await generateInvoices(facilityId, new Date('2026-08-28T12:00:00Z'), () => {})

    const actor: Actor = {
      kind: 'staff',
      staffUserId: 'test-staff',
      assignments: [
        {
          facilityId,
          roleKey: 'manager',
          rank: 20,
          permissions: new Set<PermissionKey>(['reports:financial']),
          limits: { maxFeeWaiverCents: 0, maxRefundCents: 0, maxCreditCents: 0 },
        },
      ],
    }
    const report = await revenueReport(actor, new Date('2026-08-01'), new Date('2026-10-01'))

    // Both sides paid $50, and every cent of it is referral rather than promo.
    expect(report.total.referralRewardsCents).toBe(10_000)
    expect(report.total.discountsCents).toBe(10_000)
    // The promotional share is what is left once referrals come out — zero
    // here, because no promotion was involved.
    expect(report.total.discountsCents - report.total.referralRewardsCents).toBe(0)
  })

  describe('the messages — §6.3', () => {
    // The real seeded templates and rules, end to end through the real
    // recipient resolvers. The property that matters is WHO each one reaches:
    // a referral says two different things to two different people, and the
    // failure this guards is the referee's message going to the referrer.
    const sends: { to: string; text: string; subject: string }[] = []

    beforeAll(() => {
      vi.spyOn(provider, 'selectProvider').mockImplementation(() => ({
        name: 'test',
        async sendEmail(email) {
          sends.push({ to: email.to, text: email.text ?? '', subject: email.subject ?? '' })
          return { ok: true, providerMessageId: `test_${sends.length}` }
        },
      }))
      vi.spyOn(provider, 'commsEnabled').mockReturnValue(true)
      vi.spyOn(provider, 'effectiveRecipient').mockImplementation((address: string) => address)
    })

    afterEach(() => {
      sends.length = 0
    })

    it('tells each side its own thing, at its own address', async () => {
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      const referee = await makeTenant()
      const leaseId = await makeLease(referee.id)
      await qualifyReferral({
        inviteId: minted.inviteId,
        refereeTenantId: referee.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: facilityId,
      })

      const referrer = await prisma.tenant.findUniqueOrThrow({ where: { id: referrerId } })
      const qualified = await prisma.domainEvent.findFirstOrThrow({
        where: { name: 'referral.qualified', facilityId },
      })
      const granted = await prisma.domainEvent.findFirstOrThrow({
        where: { name: 'referral.reward_granted', facilityId },
      })

      await processCommsEvent(qualified)
      await processCommsEvent(granted)

      const toReferrer = sends.find((send) => send.to === referrer.email)
      const toReferee = sends.find((send) => send.to === referee.email)
      expect(toReferrer, 'the referrer should have been written to').toBeTruthy()
      expect(toReferee, 'the referee should have been written to').toBeTruthy()

      // Each says the thing that belongs to that person, and the amounts come
      // from the referral's own snapshot rather than today's setting.
      expect(toReferrer!.text).toContain('has moved in')
      expect(toReferrer!.text).toContain('$50.00 comes off your next invoice')
      expect(toReferee!.text).toContain('Welcome')
      expect(toReferee!.text).toContain('$50.00 comes off your first invoice')
      // The one failure worth naming: crossing them over.
      expect(toReferee!.text).not.toContain('has moved in')
    })

    it('tells the referrer WHICH rule refused, in the words the record uses', async () => {
      // §5.4's AC as a message. A refusal that does not say what would have
      // qualified is a support call — the row forbids "not eligible" outright.
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      const referrer = await prisma.tenant.findUniqueOrThrow({ where: { id: referrerId } })
      // Find-or-create: an earlier test in this file already made a tenant on
      // the referrer's own email (that is what a self-referral IS), and
      // Tenant.email is unique. Tenants are deliberately not cleaned between
      // tests here — the fixtures are shared and cheap — so this reuses.
      const selfReferral =
        (await prisma.tenant.findFirst({
          where: { email: { equals: referrer.email, mode: 'insensitive' }, id: { not: referrerId } },
        })) ?? (await makeTenant({ email: referrer.email.toUpperCase() }))
      const leaseId = await makeLease(selfReferral.id)

      await qualifyReferral({
        inviteId: minted.inviteId,
        refereeTenantId: selfReferral.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: facilityId,
      })

      const refused = await prisma.domainEvent.findFirstOrThrow({
        where: { name: 'referral.refused', facilityId },
      })
      await processCommsEvent(refused)

      const message = sends.find((send) => send.to === referrer.email)
      expect(message, 'the referrer should have been told').toBeTruthy()
      // The exact sentence from the closed vocabulary — so the email, the
      // portal and the staff record cannot drift apart.
      expect(message!.text).toContain('A referral has to bring in someone new')
      expect(message!.text.toLowerCase()).not.toContain('not eligible')
    })
  })

  describe('the reward reaches an invoice — §6.2 and §5.5', () => {
    // The hand-off. Marketing decides who is owed; billing pays it, through the
    // SAME structured-discount path promotions use. There is no second
    // mechanism, and these prove the money actually arrives.

    async function earnReferral() {
      const minted = await mintInvite(referrerId)
      if (!minted.ok) throw new Error('unreachable')
      const referee = await makeTenant()
      const leaseId = await makeLease(referee.id)
      const result = await qualifyReferral({
        inviteId: minted.inviteId,
        refereeTenantId: referee.id,
        refereeLeaseId: leaseId,
        refereeFacilityId: facilityId,
      })
      if (!result.ok) throw new Error(`expected an earned referral, got ${result.refusal}`)
      return { refereeLeaseId: leaseId, referralId: result.referralId }
    }

    it('puts the referee credit on their invoice as its own line', async () => {
      const { refereeLeaseId, referralId } = await earnReferral()

      // Billed within the lead window of the SECOND period: under anniversary
      // billing (D-27) the move-in payment buys the first one, so the first
      // generated invoice is a month out. Getting this wrong makes every
      // assertion below fail with "no invoice", which reads like a broken
      // hand-off and is a wrong date.
      await generateInvoices(facilityId, new Date('2026-08-28T12:00:00Z'), () => {})

      const invoice = await prisma.invoice.findFirst({
        where: { leaseId: refereeLeaseId },
        include: { lineItems: true },
      })
      expect(invoice, 'the referee should have been invoiced').not.toBeNull()

      const discountLines = invoice!.lineItems.filter((line) => line.type === 'discount')
      expect(discountLines).toHaveLength(1)
      // §5.5: distinct descriptions, not one merged figure.
      expect(discountLines[0].description).toContain('Referral credit')
      expect(discountLines[0].amountCents).toBe(5_000)
      expect(invoice!.discountCents).toBe(5_000)

      // Recorded against the referral, so the nightly run cannot pay it twice.
      const referral = await prisma.referral.findUniqueOrThrow({ where: { id: referralId } })
      expect(referral.refereeRewardInvoiceId).toBe(invoice!.id)
    })

    it('never pays the same reward twice across nightly re-runs', async () => {
      // The catch-up path regenerates missed dates; without the recorded
      // invoice id this would credit $50 every night.
      const { refereeLeaseId } = await earnReferral()

      await generateInvoices(facilityId, new Date('2026-08-28T12:00:00Z'), () => {})
      await generateInvoices(facilityId, new Date('2026-08-28T12:00:00Z'), () => {})
      await generateInvoices(facilityId, new Date('2026-08-29T12:00:00Z'), () => {})

      const invoices = await prisma.invoice.findMany({
        where: { leaseId: refereeLeaseId },
        include: { lineItems: true },
      })
      const credits = invoices.flatMap((invoice) =>
        invoice.lineItems.filter((line) => line.description.includes('Referral credit')),
      )
      expect(credits).toHaveLength(1)
    })

    it('pays the referrer on their own next invoice, not the referee’s', async () => {
      await earnReferral()

      await generateInvoices(facilityId, new Date('2026-08-28T12:00:00Z'), () => {})

      const referrerInvoice = await prisma.invoice.findFirst({
        where: { leaseId: referrerLeaseId },
        include: { lineItems: true },
      })
      expect(referrerInvoice, 'the referrer should have been invoiced too').not.toBeNull()
      const thanks = referrerInvoice!.lineItems.filter((line) =>
        line.description.includes('Referral credit'),
      )
      expect(thanks).toHaveLength(1)
      expect(thanks[0].amountCents).toBe(5_000)
    })

    it('caps the stack at the rent — the floor is zero, never a credit', async () => {
      // §5.5's AC. A reward larger than the invoice takes it to zero and stops.
      await prisma.facility.update({
        where: { id: facilityId },
        data: { refereeRewardCents: 99_999 },
      })
      const { refereeLeaseId } = await earnReferral()

      await generateInvoices(facilityId, new Date('2026-08-28T12:00:00Z'), () => {})

      const invoice = await prisma.invoice.findFirstOrThrow({
        where: { leaseId: refereeLeaseId },
      })
      expect(invoice.totalCents).toBe(0)
      expect(invoice.discountCents).toBeLessThanOrEqual(invoice.subtotalCents)
      expect(invoice.totalCents).toBeGreaterThanOrEqual(0)
    })
  })

})
