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
  /// When this invoice was ORIGINALLY due. Never a retry date, never "last
  /// touched". A REISSUE is a different invoice row with its own original due
  /// date — B-338 gives it the date it was raised, so the ladder counts from a
  /// date the tenant could have paid by.
  dueDate: Date
  totalCents: number
  amountPaidCents: number
  /// B-338. A cancelled invoice is not owed, whatever its figures still say.
  status: string
}

/// B-338. A voided or written-off invoice owes NOTHING, and this is the only
/// place that can be said once.
///
/// `void` and `uncollectible` leave `totalCents` and `amountPaidCents` exactly
/// as they were — the row stays as evidence, which is `voidRentInvoice`'s and
/// `writeOffOpenLeaseBalance`'s whole design — so the subtraction alone reads a
/// cancelled charge as still outstanding. Every delinquency consumer routes
/// through here, and each was reading its own unfiltered `lease.invoices`: the
/// late-fee ladder charged steps on a voided invoice and `daysPastDue` anchored
/// to it, so B-338's "the reissue is due today" would have changed nothing —
/// the ORIGINAL still set the clock. A `rent_only` timeline dunned on it too.
/// The write-off case is the same defect with the same shape: the ledger entry
/// zeroes the balance, the invoice figures do not.
///
/// One guard here rather than a status filter in each of a dozen queries, which
/// is what let them drift apart in the first place. `paid` and `draft` are left
/// to the arithmetic: a paid invoice already nets to zero, and nothing in this
/// codebase issues a draft.
export function outstandingCents(invoice: UnpaidInvoice): number {
  if (invoice.status === 'void' || invoice.status === 'uncollectible') return 0
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

// ── B-195. Aging that says whether anyone is chasing it ─────────────────────
//
// A bucket total answers "how much" and never "what is being done about it",
// and the two leases behind one figure can be in opposite situations: one is
// working its way up the dunning ladder, the other has been halted behind a
// bankruptcy hold nobody has opened in four months. Summed together the
// number means neither, and a regional looking at $40,000 in the 90+ bucket
// cannot tell which one they are looking at.
//
// Split, never replaced: `total` is still reported, still equals the old
// figure, and is still what ties out against the ledger. `chased + halted`
// equals it in every bucket by construction — the same guarantee `arAging`
// gives for buckets summing to `totalCents`, and for the same reason.

export type HaltableBalance = AgedBalance & {
  /// Whether a hold declaring `halt_dunning` is in force on this lease. The
  /// caller decides that (it is a database question); this only partitions.
  halted: boolean
}

export type ArAgingSplit = {
  /// Money the delinquency ladder is still working.
  chased: ArAging
  /// Money behind a hold — a plan, a bankruptcy, a deployment, a death.
  halted: ArAging
  /// The two together. Equal to `arAging` over the same balances.
  total: ArAging
}

export function arAgingSplit(balances: readonly HaltableBalance[]): ArAgingSplit {
  const chased = arAging(balances.filter((balance) => !balance.halted))
  const halted = arAging(balances.filter((balance) => balance.halted))
  return { chased, halted, total: sumArAging([chased, halted]) }
}

export function sumArAgingSplit(splits: readonly ArAgingSplit[]): ArAgingSplit {
  return {
    chased: sumArAging(splits.map((split) => split.chased)),
    halted: sumArAging(splits.map((split) => split.halted)),
    total: sumArAging(splits.map((split) => split.total)),
  }
}
