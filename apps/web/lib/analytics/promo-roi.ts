import { prisma } from '@storage/db'
import {
  redemptionCost,
  roiTotals,
  type DiscountPeriod,
  type PromotionRoi,
} from '@storage/core/promotions'
import { reportableFacilities } from '@/lib/admin/reports'
import { can } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'

// PRD 04 §3.2 US-4 (B-082 part 4). Promo ROI: what each promotion gave away,
// and what it bought.
//
// Read from `PromoRedemption`, not from the analytics event log — the opposite
// of the funnel beside it, and deliberately. The funnel measures BEHAVIOUR and
// its steps must all come from one measurement, which is why it counts sessions
// and refuses to join to tables. This measures MONEY, where the record is the
// truth and a session count would be a worse answer to a question nobody asked.
// `promo_applied` exists in the event catalog and is fired nowhere; it would
// answer "how many people engaged with a promo", which is a different report
// and is not this one.
//
// `PromoRedemption.totalCents` carries a comment saying it was denormalised
// "so ROI reporting does not have to walk the JSON of every redemption". This
// is that reporting, and it uses it.

export type PromoRoiFilters = {
  facilityId?: string
  from: Date
  /// Exclusive.
  to: Date
}

export type PromoRoiReport = {
  rows: PromotionRoi[]
  totals: ReturnType<typeof roiTotals>
}

/// Lease statuses that mean "still paying us".
///
/// Named here rather than inlined as `!== 'ended'`: a lease in `pending` has
/// not started and must not be counted as recurring revenue the discount
/// bought, and lumping it in would flatter every promotion redeemed this week.
const RENTING: readonly string[] = ['active', 'delinquent', 'pending_auction']

export async function promoRoiReport(
  actor: Actor,
  filters: PromoRoiFilters,
): Promise<PromoRoiReport> {
  const facilities = await reportableFacilities(actor)
  // The same permission the funnel and the moves report use. Promo cost is
  // operational reporting, not financial: it is denominated in discount, and an
  // operator deciding whether to keep running a promotion needs it.
  const allowed = facilities.filter((facility) => can(actor, 'reports:operational', facility.id))
  const empty: PromoRoiReport = { rows: [], totals: roiTotals([]) }
  if (allowed.length === 0) return empty

  const facilityIds = filters.facilityId
    ? allowed.filter((facility) => facility.id === filters.facilityId).map((f) => f.id)
    : allowed.map((facility) => facility.id)
  if (facilityIds.length === 0) return empty

  const redemptions = await prisma.promoRedemption.findMany({
    where: {
      facilityId: { in: facilityIds },
      createdAt: { gte: filters.from, lt: filters.to },
    },
    select: {
      promotionId: true,
      totalCents: true,
      schedule: true,
      appliedPeriods: true,
      leaseId: true,
      promotion: { select: { name: true } },
      // Reading the lease here rather than in a second pass: the status and the
      // rent are what turn a discount into a trade, and a report that fetched
      // them separately could show a move-in count and a rent figure taken a
      // moment apart.
      lease: { select: { status: true, monthlyRateCents: true } },
      // B-168. What the minimum stay actually did. Null on every redemption
      // whose lease is still live, and on every promotion with no minimum stay
      // — "not decided yet" is not "recovered nothing".
      recaptureChargedCents: true,
      recaptureWaivedCents: true,
      // Read through the invoice rather than recomputed: CHARGED is a decision
      // and COLLECTED is what a tenant who had already left actually paid, and
      // conflating them is how a minimum stay looks like it is working.
      recaptureInvoice: { select: { amountPaidCents: true, status: true } },
    },
  })

  const byPromotion = new Map<string, PromotionRoi>()

  for (const redemption of redemptions) {
    let row = byPromotion.get(redemption.promotionId)
    if (!row) {
      row = {
        promotionId: redemption.promotionId,
        name: redemption.promotion.name,
        redemptions: 0,
        moveIns: 0,
        stillRenting: 0,
        committedCents: 0,
        realisedCents: 0,
        outstandingCents: 0,
        monthlyRentCents: 0,
        recaptureChargedCents: 0,
        recaptureWaivedCents: 0,
        recaptureCollectedCents: 0,
      }
      byPromotion.set(redemption.promotionId, row)
    }

    // The schedule is JSON. Coerced through a shape check rather than cast:
    // `redemptionCost` drops entries it cannot read, and handing it a
    // non-array would throw inside a report an operator opened to read a number.
    const periods: DiscountPeriod[] = Array.isArray(redemption.schedule)
      ? (redemption.schedule as unknown as DiscountPeriod[])
      : []
    const cost = redemptionCost(periods, redemption.appliedPeriods, redemption.totalCents)

    row.redemptions += 1
    row.recaptureChargedCents += redemption.recaptureChargedCents ?? 0
    row.recaptureWaivedCents += redemption.recaptureWaivedCents ?? 0
    row.recaptureCollectedCents += redemption.recaptureInvoice?.amountPaidCents ?? 0
    row.committedCents += cost.committedCents
    row.realisedCents += cost.realisedCents
    row.outstandingCents += cost.outstandingCents

    // A redemption with no lease was attached to a reservation that never
    // converted. It cost nothing and bought nothing, and counting it as a
    // move-in is the single easiest way to make a promotion look better than it
    // was.
    if (redemption.leaseId && redemption.lease) {
      row.moveIns += 1
      if (RENTING.includes(redemption.lease.status)) {
        row.stillRenting += 1
        row.monthlyRentCents += redemption.lease.monthlyRateCents
      }
    }
  }

  // Most expensive first — the promotion an operator needs to make a decision
  // about is the one giving the most away, whether or not it is working.
  const rows = [...byPromotion.values()].sort(
    (a, b) => b.realisedCents - a.realisedCents || b.committedCents - a.committedCents,
  )

  return { rows, totals: roiTotals(rows) }
}
