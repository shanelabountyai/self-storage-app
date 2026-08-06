// PRD 02 US-39.4, §4.11. Days past due and AR aging.
//
// §4.11's AC is unusually specific here, and for a reason worth keeping in
// view: "`daysPastDue(lease)` has exactly one definition, computed from the
// **original** invoice due date and never from the last retry attempt
// (US-20), and is used by the dashboard tile, the late-fee run, and every
// later delinquency consumer."
//
// The failure it guards against is concrete: a failed autopay retried on
// days +1/+3/+5 (US-20) moves *an* attempt date forward each time. Anchoring
// to that would reset the clock on every retry, so a lease 40 days delinquent
// would report as 2 days past due, and it would never reach the day-6 access
// suspension (US-45/D-16) or any later lien step at all. The tenant would
// simply stop being visible to the system that is supposed to escalate.

export type UnpaidInvoice = {
  /// When this invoice was ORIGINALLY due. Never a retry date, never a
  /// re-issue date, never "last touched".
  dueDate: Date
  totalCents: number
  amountPaidCents: number
}

export function outstandingCents(invoice: UnpaidInvoice): number {
  return Math.max(0, invoice.totalCents - invoice.amountPaidCents)
}

/// Days past due for a lease: measured from the OLDEST still-unpaid invoice.
///
/// Formula:
///   daysPastDue = whole days from (oldest unpaid invoice's original dueDate)
///                 to `asOf`, floored at 0
///
/// The oldest, not the newest: a tenant three months behind who pays exactly
/// this month's invoice is still three months behind, and anchoring to the
/// most recent unpaid bill would quietly reset them to current.
///
/// Returns 0 when nothing is unpaid. Callers that need to tell "current" from
/// "no invoices at all" should check the invoice list themselves — this
/// deliberately does not invent a null to mean two different things.
export function daysPastDue(invoices: readonly UnpaidInvoice[], asOf: Date): number {
  const unpaid = invoices.filter((invoice) => outstandingCents(invoice) > 0)
  if (unpaid.length === 0) return 0

  const oldestDue = unpaid.reduce(
    (oldest, invoice) => (invoice.dueDate < oldest ? invoice.dueDate : oldest),
    unpaid[0].dueDate,
  )

  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const days = Math.floor((startOfUtcDay(asOf).getTime() - startOfUtcDay(oldestDue).getTime()) / MS_PER_DAY)
  return Math.max(0, days)
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/// US-39.4's buckets, exactly as the PRD lists them: 0–10, 11–30, 31–60,
/// 61–90, 90+. Inclusive at both ends of each named range; `over90` is
/// strictly greater than 90, so a lease at exactly 90 days lands in `d61to90`
/// and there is no day that belongs to two buckets or to none.
export const AR_BUCKETS = ['d0to10', 'd11to30', 'd31to60', 'd61to90', 'over90'] as const
export type ArBucket = (typeof AR_BUCKETS)[number]

export function arBucketFor(days: number): ArBucket {
  if (days <= 10) return 'd0to10'
  if (days <= 30) return 'd11to30'
  if (days <= 60) return 'd31to60'
  if (days <= 90) return 'd61to90'
  return 'over90'
}

export type AgedBalance = { daysPastDue: number; outstandingCents: number }

export type ArAging = Record<ArBucket, number> & { totalCents: number }

/// Total outstanding money per bucket. The sum of the buckets always equals
/// `totalCents` — there is no "other" and nothing is dropped, which is what
/// makes this safe to put on a dashboard tile next to a total.
export function arAging(balances: readonly AgedBalance[]): ArAging {
  const aging = {
    d0to10: 0,
    d11to30: 0,
    d31to60: 0,
    d61to90: 0,
    over90: 0,
    totalCents: 0,
  }
  for (const balance of balances) {
    if (balance.outstandingCents <= 0) continue
    aging[arBucketFor(balance.daysPastDue)] += balance.outstandingCents
    aging.totalCents += balance.outstandingCents
  }
  return aging
}

export function sumArAging(agings: readonly ArAging[]): ArAging {
  return agings.reduce(
    (acc, aging) => ({
      d0to10: acc.d0to10 + aging.d0to10,
      d11to30: acc.d11to30 + aging.d11to30,
      d31to60: acc.d31to60 + aging.d31to60,
      d61to90: acc.d61to90 + aging.d61to90,
      over90: acc.over90 + aging.over90,
      totalCents: acc.totalCents + aging.totalCents,
    }),
    { d0to10: 0, d11to30: 0, d31to60: 0, d61to90: 0, over90: 0, totalCents: 0 },
  )
}
