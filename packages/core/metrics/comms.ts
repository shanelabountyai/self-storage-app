// PRD 05 CN-19 / §7 success metrics. The comms delivery-rate definitions,
// written once — same rule as every other file in this directory: "no
// screen, tile, or export computes any of these inline."

export type MessageCounts = {
  sent: number
  delivered: number
  bounced: number
  failed: number
  suppressed: number
  cancelled: number
  deferred: number
}

export function emptyMessageCounts(): MessageCounts {
  return { sent: 0, delivered: 0, bounced: 0, failed: 0, suppressed: 0, cancelled: 0, deferred: 0 }
}

/// How many sends actually went out — the denominator for every rate below.
/// `queued` deliberately excluded: it means "the network call has not
/// resolved yet", not an attempt whose outcome is known.
export function totalAttempted(counts: MessageCounts): number {
  return counts.sent + counts.delivered + counts.bounced + counts.failed
}

/// Null rather than 0 when nothing was attempted — 0% delivery reads as a
/// failure, and "no sends this period" is not one. Every ratio below shares
/// this rule for the same reason `funnelFrom` (packages/core/analytics)
/// treats an empty top-of-funnel as unmeasured rather than 0%.
function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

/// PRD 05 §7: email delivery target ≥99%. `sent` counts too — the provider
/// accepted it and no bounce has (yet) proven otherwise, the same
/// optimistic-until-shown-otherwise reading `sent` already carries in
/// `MessageStatus`.
export function deliveryRate(counts: MessageCounts): number | null {
  return ratio(counts.sent + counts.delivered, totalAttempted(counts))
}

/// PRD 05 §7: bounce target <1%.
export function bounceRate(counts: MessageCounts): number | null {
  return ratio(counts.bounced, totalAttempted(counts))
}

/// PRD 05 §7: SMS delivery target ≥97%, i.e. failure <3%. Same denominator as
/// `deliveryRate`/`bounceRate` — `suppressed` (no consent, opted out) is a
/// different fact than a send that was attempted and failed, tracked
/// separately as an opt-out rate rather than folded in here.
export function smsFailureRate(counts: MessageCounts): number | null {
  return ratio(counts.failed, totalAttempted(counts))
}

/// PRD 05 FR-19: "alert to owner if >2% of a day's sends fail." Reads
/// "fail" as "did not succeed" — bounced and failed both count, since a
/// spike of either is the same underlying problem (a bad list, a broken
/// template, a provider outage) and an operator does not care which bucket
/// it landed in at 2am.
export function dailyFailureRateExceeds(counts: MessageCounts, threshold = 0.02): boolean {
  const attempted = totalAttempted(counts)
  return attempted > 0 && (counts.bounced + counts.failed) / attempted > threshold
}
