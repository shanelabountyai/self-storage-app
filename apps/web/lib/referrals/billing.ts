import { prisma, type Prisma } from '@storage/db'

// PRD 10 §6.2 (B-100). The billing side of the hand-off.
//
// "Referral rewards reach invoices through the SAME structured-discount path
// B-070 builds for promotions. Marketing owns the definition and the
// qualification; billing owns the money. No second discount mechanism."
//
// So this file is deliberately the same shape as `lib/promotions/billing.ts`:
// answer one question for the invoice run — what comes off THIS invoice — and
// record that it was applied, inside the caller's transaction.
//
// The difference from a promotion is WHICH invoice each side's reward lands on
// (§3):
//
//   * the referee's comes off their FIRST rent invoice, which under anniversary
//     billing (D-27) is generated at move-in;
//   * the referrer's comes off their NEXT rent invoice after qualification,
//     which may be up to a month away — which is why the portal states the date
//     rather than saying "eventually".
//
// Both are expressed the same way: an earned referral with no invoice recorded
// for that side yet, on a lease that belongs to that side.

/// The description prefix every referral discount line carries.
///
/// The revenue report splits referral rewards from promotional discounts on
/// this (§5.7), because both are `type: 'discount'` line items — deliberately,
/// since to billing they are the same thing: money off an invoice. Exported so
/// the writer and the reader share one string rather than two that can drift.
export const REFERRAL_DISCOUNT_PREFIX = 'Referral credit'

export type ReferralReward = {
  referralId: string
  amountCents: number
  description: string
  /// Which side this reward belongs to, so the caller records it on the right
  /// column. Two columns rather than one, because a single "applied" flag
  /// cannot express "the referee has been paid and the referrer has not",
  /// which is the ordinary state for most of a month.
  side: 'referrer' | 'referee'
}

/// Every referral reward owed on this lease's next invoice.
///
/// A list, not a single reward, because a tenant can be both: somebody who was
/// referred last month and referred a friend this month is owed two, and the
/// invoice shows both lines (§5.5).
export async function referralRewardsForLease(
  leaseId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ReferralReward[]> {
  const lease = await client.lease.findUnique({
    where: { id: leaseId },
    select: { tenantId: true },
  })
  if (!lease) return []

  const rewards: ReferralReward[] = []

  // The referee's side: this lease IS the referred one, and the reward has not
  // been placed on an invoice yet.
  const asReferee = await client.referral.findFirst({
    where: {
      refereeLeaseId: leaseId,
      state: 'earned',
      refereeRewardInvoiceId: null,
      refereeRewardCents: { gt: 0 },
    },
    select: { id: true, refereeRewardCents: true },
  })
  if (asReferee) {
    rewards.push({
      referralId: asReferee.id,
      amountCents: asReferee.refereeRewardCents,
      description: `${REFERRAL_DISCOUNT_PREFIX} — welcome`,
      side: 'referee',
    })
  }

  // The referrer's side: they are the referrer on an earned referral whose
  // referrer reward has not landed. Matched on the TENANT rather than the
  // lease, because the referral records the referee's lease and the referrer's
  // credit belongs on whichever lease of theirs bills next.
  const asReferrer = await client.referral.findMany({
    where: {
      referrerTenantId: lease.tenantId,
      state: 'earned',
      referrerRewardInvoiceId: null,
      referrerRewardCents: { gt: 0 },
    },
    select: { id: true, referrerRewardCents: true },
    // Oldest first: a tenant owed several is paid in the order they earned
    // them, which is the order they will ask about.
    orderBy: { qualifiedAt: 'asc' },
  })
  for (const referral of asReferrer) {
    rewards.push({
      referralId: referral.id,
      amountCents: referral.referrerRewardCents,
      description: `${REFERRAL_DISCOUNT_PREFIX} — thank you`,
      side: 'referrer',
    })
  }

  return rewards
}

/// Records that a reward has been written onto an invoice.
///
/// Called inside the same transaction as the invoice, so a rolled-back invoice
/// never leaves a referral looking paid — the same rule and the same reason as
/// `markDiscountApplied` for promotions. Without it a re-run of the nightly
/// job would credit the same $50 twice.
export async function markReferralRewardApplied(
  tx: Prisma.TransactionClient,
  reward: ReferralReward,
  invoiceId: string,
): Promise<void> {
  await tx.referral.update({
    where: { id: reward.referralId },
    data:
      reward.side === 'referee'
        ? { refereeRewardInvoiceId: invoiceId }
        : { referrerRewardInvoiceId: invoiceId },
  })
}
