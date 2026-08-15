import { randomInt } from 'node:crypto'
import { prisma, type Prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import {
  evaluateReferral,
  REFERRAL_REFUSAL_MESSAGES,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  type ReferralRefusal,
} from '@storage/core/referrals'

// PRD 10 §5.1/§5.3/§5.4/§6 (B-100). The referral engine.
//
// Marketing owns the definition and the qualification; billing owns the money,
// through the SAME structured-discount path promotions use (§6.2). Nothing here
// writes an invoice line — it decides who is owed what, and records it.

/// `randomInt` rather than `Math.random`: this is a bearer token worth $50 to
/// whoever holds it, and a predictable sequence is a way to mint free rentals.
/// Rejection-free because the alphabet length divides evenly into the range
/// `randomInt` draws from.
export function generateReferralCode(): string {
  let code = ''
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)]
  }
  return code
}

export type MintResult =
  | { ok: true; code: string; inviteId: string; expiresAt: Date }
  | { ok: false; reason: 'program_disabled' | 'no_active_lease' | 'open_invite_cap' }

/// §5.1. Mints a fresh single-use invite, which is what the act of sharing does.
///
/// The friction cost of single-use codes is nil precisely because minting is
/// the share: tapping "Invite a friend" creates the row and opens the share
/// sheet. There is no separate "generate a code" step to forget.
export async function mintInvite(tenantId: string): Promise<MintResult> {
  // §5.1 AC: "a tenant with no active lease sees why they cannot refer, not a
  // broken link." The facility comes from the lease rather than being passed
  // in — a referral is local (§5.4), so which site they rent at IS the program
  // that applies.
  const lease = await prisma.lease.findFirst({
    where: { tenantId, status: { not: 'ended' } },
    orderBy: { startDate: 'desc' },
    select: { facilityId: true },
  })
  if (!lease) return { ok: false, reason: 'no_active_lease' }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: lease.facilityId },
    select: {
      referralEnabled: true,
      referralInviteExpiryDays: true,
      referralOpenInviteCap: true,
    },
  })
  if (!facility.referralEnabled) return { ok: false, reason: 'program_disabled' }

  const now = new Date()
  // §5.4's cap counts OUTSTANDING invites — unredeemed and unexpired. An
  // expired one is not exposure any more, so counting it would slowly lock a
  // tenant out of a program they used correctly a year ago.
  const outstanding = await prisma.referralInvite.count({
    where: { referrerTenantId: tenantId, redeemedAt: null, expiresAt: { gt: now } },
  })
  if (outstanding >= facility.referralOpenInviteCap) return { ok: false, reason: 'open_invite_cap' }

  const expiresAt = new Date(now.getTime() + facility.referralInviteExpiryDays * 86_400_000)

  // Retry on the unique index rather than checking first: a check-then-write
  // races, and at 30^8 a collision is vanishingly rare but not impossible.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateReferralCode()
    try {
      const invite = await prisma.referralInvite.create({
        data: { code, referrerTenantId: tenantId, facilityId: lease.facilityId, expiresAt },
        select: { id: true },
      })
      return { ok: true, code, inviteId: invite.id, expiresAt }
    } catch {
      // Collision on `code`. Try another.
    }
  }
  throw new Error('could not mint a unique referral code after 5 attempts')
}

/// §5.1 AC: "a redeemed or expired code lands the visitor on the facility page
/// normally, with no error and no referral attached."
///
/// So this returns the invite only when it is genuinely usable, and the caller
/// treats null as "no referral" rather than as an error. A prospect must never
/// see "this code is dead" — that is a conversation between the business and
/// the tenant, not something to fail a stranger's page load with.
export async function usableInvite(code: string): Promise<{
  id: string
  facilityId: string
  referrerTenantId: string
  facilitySlug: string
} | null> {
  const trimmed = code.trim().toUpperCase()
  if (!trimmed) return null

  const invite = await prisma.referralInvite.findUnique({
    where: { code: trimmed },
    select: {
      id: true,
      facilityId: true,
      referrerTenantId: true,
      redeemedAt: true,
      expiresAt: true,
      facility: { select: { slug: true, referralEnabled: true } },
    },
  })
  if (!invite) return null
  if (invite.redeemedAt) return null
  if (invite.expiresAt.getTime() <= Date.now()) return null
  if (!invite.facility.referralEnabled) return null

  return {
    id: invite.id,
    facilityId: invite.facilityId,
    referrerTenantId: invite.referrerTenantId,
    facilitySlug: invite.facility.slug,
  }
}

/// The facts §5.4 judges, gathered from real rows.
///
/// Deliberately separate from `evaluateReferral`, which is pure: this is the
/// half that needs a database, and keeping the judgement out of it is what
/// lets every rule be tested without one.
async function gatherFacts(input: {
  inviteId: string
  refereeTenantId: string
  refereeFacilityId: string
  client: Prisma.TransactionClient | typeof prisma
}) {
  const { client } = input
  const invite = await client.referralInvite.findUniqueOrThrow({
    where: { id: input.inviteId },
    select: {
      redeemedAt: true,
      expiresAt: true,
      facilityId: true,
      referrerTenantId: true,
      referrerTenant: { select: { id: true, email: true, phone: true } },
    },
  })

  const facility = await client.facility.findUniqueOrThrow({
    where: { id: invite.facilityId },
    select: {
      referralEnabled: true,
      referralAnnualCap: true,
      referralCrossFacility: true,
    },
  })

  const referee = await client.tenant.findUniqueOrThrow({
    where: { id: input.refereeTenantId },
    select: { id: true, email: true, phone: true },
  })

  // §5.4's self-referral rule: "matched on email, phone (last 10 digits) and
  // payment fingerprint". Payment fingerprint is not reachable here — the
  // Stripe customer is on the tenant and the card fingerprint is not stored
  // (SAQ-A: the browser talks to Stripe directly). Email, phone and the tenant
  // id itself are what this build can match on, and that is stated rather than
  // silently narrowed.
  const last10 = (value: string | null) => (value ?? '').replace(/\D/g, '').slice(-10)
  const isSelfReferral =
    referee.id === invite.referrerTenantId ||
    referee.email.trim().toLowerCase() === invite.referrerTenant.email.trim().toLowerCase() ||
    (last10(referee.phone).length === 10 &&
      last10(referee.phone) === last10(invite.referrerTenant.phone))

  // "A referee who has ever held a lease at this org is not a new tenant."
  // Any lease at all, at any facility, in any state — including ended, which
  // is the whole point: otherwise a move-out and move-in pays $100.
  const priorLeases = await client.lease.count({
    where: { tenantId: referee.id, facilityId: { not: undefined } },
  })

  const alreadyReferred = await client.referral.count({
    where: { refereeTenantId: referee.id, state: { in: ['earned', 'pending'] } },
  })

  const yearAgo = new Date(Date.now() - 365 * 86_400_000)
  const qualifiedLast12Months = await client.referral.count({
    where: {
      referrerTenantId: invite.referrerTenantId,
      state: 'earned',
      qualifiedAt: { gte: yearAgo },
    },
  })

  return {
    invite,
    facility,
    facts: {
      programEnabled: facility.referralEnabled,
      isSelfReferral,
      // The referee's OWN new lease is in this count, so "has rented before"
      // means more than one.
      refereeHasPriorLease: priorLeases > 1,
      refereeAlreadyReferred: alreadyReferred > 0,
      referrerQualifiedLast12Months: qualifiedLast12Months,
      annualCap: facility.referralAnnualCap,
      inviteExpired: invite.expiresAt.getTime() <= Date.now(),
      inviteAlreadyRedeemed: invite.redeemedAt !== null,
      sameFacility: invite.facilityId === input.refereeFacilityId,
      crossFacilityAllowed: facility.referralCrossFacility,
    },
  }
}

export type QualifyResult =
  | { ok: true; referralId: string; referrerRewardCents: number; refereeRewardCents: number }
  | { ok: false; refusal: ReferralRefusal; message: string; referralId: string }
  | { ok: false; refusal: null; message: null; referralId: null }

/// §4. "A referral qualifies when the referee's move-in is complete AND their
/// first payment has cleared."
///
/// Not at reservation (a free hold costs nothing and expires on its own, and
/// paying $50 a hold is a business somebody discovers within a week), not at
/// move-in alone (a card later declined would have paid out on a rental that
/// produced no money), not at signature.
///
/// §5.4 AC: "a refused referral never silently drops. The referee's move-in
/// completes at the standard rate with the reason logged." So every path here
/// returns having WRITTEN something — an earned referral or a refused one with
/// its reason — and none of them throws into the move-in.
export async function qualifyReferral(input: {
  /// The invite's id, as the checkout session carries it. An id rather than a
  /// code because the session snapshotted what `/r/{code}` resolved — passing
  /// the code again would mean resolving it a second time, and a code that had
  /// been redeemed in between would resolve to nothing rather than to the
  /// refusal the tenant is owed an explanation for.
  inviteId: string
  refereeTenantId: string
  refereeLeaseId: string
  refereeFacilityId: string
}): Promise<QualifyResult> {
  const invite = await prisma.referralInvite.findUnique({
    where: { id: input.inviteId },
    select: { id: true, referrerTenantId: true, facilityId: true },
  })
  // No such code. Nothing to record against and nobody to tell — the visitor
  // simply arrived with a cookie that means nothing.
  if (!invite) return { ok: false, refusal: null, message: null, referralId: null }

  const gathered = await gatherFacts({
    inviteId: invite.id,
    refereeTenantId: input.refereeTenantId,
    refereeFacilityId: input.refereeFacilityId,
    client: prisma,
  })
  const verdict = evaluateReferral(gathered.facts)

  if (!verdict.qualifies) {
    const refused = await prisma.referral.create({
      data: {
        inviteId: invite.id,
        referrerTenantId: invite.referrerTenantId,
        refereeTenantId: input.refereeTenantId,
        refereeLeaseId: input.refereeLeaseId,
        facilityId: invite.facilityId,
        state: 'refused',
        refusedReason: verdict.refusal,
      },
      select: { id: true },
    })
    // §6.3: the referrer is told WHY, in plain language. The refusal key
    // travels on the payload rather than the rendered sentence, so the message
    // and the staff record can never say different things about the same
    // refusal.
    await emitEvent({
      name: 'referral.refused',
      entityType: 'Referral',
      entityId: refused.id,
      facilityId: invite.facilityId,
      payload: {
        referrerTenantId: invite.referrerTenantId,
        refereeTenantId: input.refereeTenantId,
        refusal: verdict.refusal,
      },
    })

    return { ok: false, refusal: verdict.refusal, message: verdict.message, referralId: refused.id }
  }

  // Both amounts snapshotted at qualification (§6.1), for the same reason a
  // promo schedule is: changing the program next quarter must not silently
  // rewrite what somebody was already promised.
  const rewards = await prisma.facility.findUniqueOrThrow({
    where: { id: invite.facilityId },
    select: { referralRewardCents: true, refereeRewardCents: true },
  })

  // §6.1: "Redeeming an invite is atomic. A conditional update — mark redeemed
  // WHERE redeemedAt IS NULL — is what makes 'one use' true against two
  // friends completing a move-in in the same minute, rather than a
  // check-then-write that both pass."
  return prisma.$transaction(async (tx) => {
    const referral = await tx.referral.create({
      data: {
        inviteId: invite.id,
        referrerTenantId: invite.referrerTenantId,
        refereeTenantId: input.refereeTenantId,
        refereeLeaseId: input.refereeLeaseId,
        facilityId: invite.facilityId,
        state: 'earned',
        qualifiedAt: new Date(),
        referrerRewardCents: rewards.referralRewardCents,
        refereeRewardCents: rewards.refereeRewardCents,
      },
      select: { id: true },
    })

    const claimed = await tx.referralInvite.updateMany({
      where: { id: invite.id, redeemedAt: null },
      data: { redeemedAt: new Date(), redeemedByReferralId: referral.id },
    })

    // Somebody else got there first, in the same instant. The loser becomes a
    // refusal with the honest reason rather than a second payout — and it is
    // recorded, not dropped, so the tenant can be told.
    if (claimed.count === 0) {
      await tx.referral.update({
        where: { id: referral.id },
        data: {
          state: 'refused',
          refusedReason: 'invite_already_used' satisfies ReferralRefusal,
          qualifiedAt: null,
          referrerRewardCents: 0,
          refereeRewardCents: 0,
        },
      })
      return {
        ok: false as const,
        refusal: 'invite_already_used' as ReferralRefusal,
        message: REFERRAL_REFUSAL_MESSAGES.invite_already_used,
        referralId: referral.id,
      }
    }

    // Inside the transaction, like every other event this codebase emits from
    // one: an event for a referral that rolled back would tell two people about
    // money nobody owes.
    await emitEvent(
      {
        name: 'referral.qualified',
        entityType: 'Referral',
        entityId: referral.id,
        facilityId: invite.facilityId,
        payload: {
          referrerTenantId: invite.referrerTenantId,
          refereeTenantId: input.refereeTenantId,
          referrerRewardCents: rewards.referralRewardCents,
          refereeRewardCents: rewards.refereeRewardCents,
        },
      },
      tx,
    )

    return {
      ok: true as const,
      referralId: referral.id,
      referrerRewardCents: rewards.referralRewardCents,
      refereeRewardCents: rewards.refereeRewardCents,
    }
  })
}
