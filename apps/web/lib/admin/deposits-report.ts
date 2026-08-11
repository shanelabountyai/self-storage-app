import { prisma } from '@storage/db'
import { financialFacilities } from './reports'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 US-39 item 6 (B-078). "Deposits reconciliation — per day per
// facility: system-recorded payments by method (card batches from processor,
// cash, check) vs drawer close-outs and processor settlement records;
// variances flagged."
//
// Two of the three sides exist: what the system recorded, and what somebody
// counted. The third — the processor's own settlement file — has no importer
// (no Stripe payout reconciliation is built), so the card column is what WE
// recorded rather than what the processor says it paid out. The screen says
// so rather than implying a three-way tie-out that has not happened.

export type DepositsRow = {
  facilityId: string
  facilityName: string
  businessDate: string
  cashRecordedCents: number
  checksRecordedCents: number
  cardRecordedCents: number
  /// Null when no drawer was opened that day — which is itself the finding.
  countedCashCents: number | null
  expectedCashCents: number | null
  varianceCents: number | null
  note: string | null
  /// Cash or cheque taken with no drawer session open. US-33's whole point:
  /// money with no counted session behind it is unreconciled, and saying so
  /// is more useful than refusing the payment at the counter would have been.
  unreconciledCents: number
}

export type DepositsReport = {
  rows: DepositsRow[]
  totalVarianceCents: number
  totalUnreconciledCents: number
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function depositsReport(
  actor: Actor,
  from: Date,
  to: Date,
  facilityId?: string,
): Promise<DepositsReport> {
  const allowed = await financialFacilities(actor)
  const facilities = facilityId ? allowed.filter((f) => f.id === facilityId) : allowed
  if (facilities.length === 0) return { rows: [], totalVarianceCents: 0, totalUnreconciledCents: 0 }

  const facilityIds = facilities.map((f) => f.id)
  const nameById = new Map(facilities.map((f) => [f.id, f.name]))

  const [payments, sessions] = await Promise.all([
    prisma.payment.findMany({
      where: {
        facilityId: { in: facilityIds },
        receivedAt: { gte: from, lt: to },
        status: { in: ['succeeded', 'partially_refunded', 'refunded'] },
      },
      select: {
        facilityId: true,
        method: true,
        amountCents: true,
        changeCents: true,
        receivedAt: true,
        drawerSessionId: true,
        refundOfPaymentId: true,
      },
    }),
    prisma.drawerSession.findMany({
      where: { facilityId: { in: facilityIds }, businessDate: { gte: from, lt: to } },
    }),
  ])

  // Keyed by facility + day. Payments are bucketed by `receivedAt`'s UTC day
  // rather than the facility-local one, matching how `businessDate` is
  // stored for the session — a facility whose day boundary straddles UTC
  // midnight is the known imprecision, called out on the screen.
  type Bucket = Omit<DepositsRow, 'facilityId' | 'facilityName' | 'businessDate'>
  const buckets = new Map<string, Bucket>()
  const key = (facility: string, day: string) => `${facility}|${day}`

  const empty = (): Bucket => ({
    cashRecordedCents: 0,
    checksRecordedCents: 0,
    cardRecordedCents: 0,
    countedCashCents: null,
    expectedCashCents: null,
    varianceCents: null,
    note: null,
    unreconciledCents: 0,
  })

  for (const payment of payments) {
    const day = isoDay(payment.receivedAt)
    const bucket = buckets.get(key(payment.facilityId, day)) ?? empty()
    // A refund is money out; netting it keeps each column "what the drawer
    // or the processor actually moved".
    const signed = payment.refundOfPaymentId ? -payment.amountCents : payment.amountCents

    if (payment.method === 'cash') {
      bucket.cashRecordedCents += signed - (payment.changeCents ?? 0)
      if (!payment.drawerSessionId) bucket.unreconciledCents += signed - (payment.changeCents ?? 0)
    } else if (payment.method === 'check' || payment.method === 'money_order') {
      bucket.checksRecordedCents += signed
      if (!payment.drawerSessionId) bucket.unreconciledCents += signed
    } else {
      bucket.cardRecordedCents += signed
    }
    buckets.set(key(payment.facilityId, day), bucket)
  }

  for (const session of sessions) {
    const day = isoDay(session.businessDate)
    const bucket = buckets.get(key(session.facilityId, day)) ?? empty()
    // Several sessions in one day (a shift-change count-down) sum.
    bucket.countedCashCents = (bucket.countedCashCents ?? 0) + (session.countedCashCents ?? 0)
    bucket.expectedCashCents = (bucket.expectedCashCents ?? 0) + (session.expectedCashCents ?? 0)
    bucket.varianceCents = (bucket.varianceCents ?? 0) + (session.varianceCents ?? 0)
    if (session.note) bucket.note = bucket.note ? `${bucket.note}; ${session.note}` : session.note
    buckets.set(key(session.facilityId, day), bucket)
  }

  const rows: DepositsRow[] = [...buckets.entries()]
    .map(([composite, bucket]) => {
      const [facility, businessDate] = composite.split('|')
      return {
        facilityId: facility,
        facilityName: nameById.get(facility) ?? '—',
        businessDate,
        ...bucket,
      }
    })
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || a.facilityName.localeCompare(b.facilityName))

  return {
    rows,
    totalVarianceCents: rows.reduce((sum, row) => sum + (row.varianceCents ?? 0), 0),
    totalUnreconciledCents: rows.reduce((sum, row) => sum + row.unreconciledCents, 0),
  }
}
