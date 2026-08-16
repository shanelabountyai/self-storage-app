import { prisma } from '@storage/db'
import { REFERRAL_REFUSAL_MESSAGES, type ReferralRefusal } from '@storage/core/referrals'

// PRD 10 §5.6 (B-101). What a referrer may see of their own referrals.
//
// The privacy rule is the load-bearing part: "the referee's identity beyond
// first name and initial is never shown. The referrer knowing their friend's
// unit number, balance or move-in date is a privacy leak the friend never
// agreed to." So the shaping happens HERE, in the query, rather than in the
// component — a page that received the whole tenant row and rendered part of it
// is one refactor away from leaking the rest.

export type ReferralRow = {
  id: string
  /// "Sam T." — §5.6's exact rule. Null when the invite has been shared but
  /// nobody has used it yet, because there is no friend to name.
  friend: string | null
  state: 'shared' | 'pending' | 'earned' | 'refused' | 'expired' | 'clawed_back'
  /// §5.6: "once qualified — the date the credit lands." Null until the reward
  /// reaches an invoice, and the caller says "your next invoice" instead.
  creditDate: Date | null
  rewardCents: number
  /// Plain language, from the same closed vocabulary the email and the staff
  /// record read. Null unless refused.
  refusedReason: string | null
}

function initialOf(lastName: string | null): string {
  const trimmed = (lastName ?? '').trim()
  return trimmed ? ` ${trimmed[0].toUpperCase()}.` : ''
}

export async function referralsForTenant(tenantId: string): Promise<ReferralRow[]> {
  const rows = await prisma.referral.findMany({
    where: { referrerTenantId: tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      state: true,
      refusedReason: true,
      referrerRewardCents: true,
      referrerRewardInvoiceId: true,
      // First name and last name ONLY. Not the unit, not the balance, not the
      // move-in date — see the note above.
      refereeTenant: { select: { firstName: true, lastName: true } },
    },
  })

  // The credit dates, in one query rather than a relation.
  //
  // `referrerRewardInvoiceId` is a plain column with no Prisma relation
  // declared, and adding one would mean a migration for a foreign key that
  // buys nothing this page cannot get here — the reward invoice is read in
  // exactly one place.
  const invoiceIds = rows
    .map((row) => row.referrerRewardInvoiceId)
    .filter((id): id is string => id !== null)
  const invoices = invoiceIds.length
    ? await prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, dueDate: true },
      })
    : []
  const dueById = new Map(invoices.map((invoice) => [invoice.id, invoice.dueDate]))

  return rows.map((row) => ({
    id: row.id,
    friend: row.refereeTenant
      ? `${row.refereeTenant.firstName}${initialOf(row.refereeTenant.lastName)}`
      : null,
    state: row.state,
    creditDate: row.referrerRewardInvoiceId
      ? (dueById.get(row.referrerRewardInvoiceId) ?? null)
      : null,
    rewardCents: row.referrerRewardCents,
    refusedReason:
      row.refusedReason && row.refusedReason in REFERRAL_REFUSAL_MESSAGES
        ? REFERRAL_REFUSAL_MESSAGES[row.refusedReason as ReferralRefusal]
        : null,
  }))
}

/// §5.6's states, in words a tenant reads rather than the enum.
///
/// The row makes this an accessibility requirement, not a style choice:
/// "referral state carried in words, never a coloured pill alone" (1.4.1) —
/// colour is never the only way this codebase says anything, and a pill with
/// no text is exactly that failure.
export const REFERRAL_STATE_LABELS: Record<ReferralRow['state'], string> = {
  shared: 'Invite shared — not used yet',
  pending: 'Moved in — waiting for their first payment to clear',
  earned: 'Credit earned',
  refused: 'No credit',
  expired: 'Invite expired unused',
  clawed_back: 'Credit reversed',
}

export type StaffReferralRow = {
  id: string
  /// Staff see BOTH full names — they are answering "why didn't I get my $50"
  /// at the counter, and §5.6's first-name-only rule is about what the
  /// REFERRER may see of their friend, not about what the operator may see of
  /// their own tenants.
  referrerName: string
  refereeName: string | null
  /// Which side of this referral the profile being viewed is on, so the screen
  /// can say "referred by" or "referred" rather than making a staffer work it
  /// out from two names.
  role: 'referrer' | 'referee'
  state: ReferralRow['state']
  /// §5.7 AC: "a referral record is visible on both tenants' profiles, with the
  /// reward state and, when refused, THE RULE THAT REFUSED IT."
  refusedReason: string | null
  refusedRule: string | null
  referrerRewardCents: number
  refereeRewardCents: number
  qualifiedAt: Date | null
}

/// Every referral either side of a tenant, for the staff profile.
export async function referralsForStaff(tenantId: string): Promise<StaffReferralRow[]> {
  const rows = await prisma.referral.findMany({
    where: { OR: [{ referrerTenantId: tenantId }, { refereeTenantId: tenantId }] },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      state: true,
      refusedReason: true,
      referrerTenantId: true,
      referrerRewardCents: true,
      refereeRewardCents: true,
      qualifiedAt: true,
      referrerTenant: { select: { firstName: true, lastName: true } },
      refereeTenant: { select: { firstName: true, lastName: true } },
    },
  })

  const fullName = (person: { firstName: string; lastName: string | null } | null) =>
    person ? `${person.firstName} ${person.lastName ?? ''}`.trim() : null

  return rows.map((row) => ({
    id: row.id,
    referrerName: fullName(row.referrerTenant) ?? 'Unknown',
    refereeName: fullName(row.refereeTenant),
    role: row.referrerTenantId === tenantId ? ('referrer' as const) : ('referee' as const),
    state: row.state,
    refusedReason:
      row.refusedReason && row.refusedReason in REFERRAL_REFUSAL_MESSAGES
        ? REFERRAL_REFUSAL_MESSAGES[row.refusedReason as ReferralRefusal]
        : null,
    // The rule's own key alongside the sentence. A staffer reading "already
    // referred" can match it to the rule in the PRD; the sentence alone is
    // what they read to the tenant.
    refusedRule: row.refusedReason,
    referrerRewardCents: row.referrerRewardCents,
    refereeRewardCents: row.refereeRewardCents,
    qualifiedAt: row.qualifiedAt,
  }))
}
