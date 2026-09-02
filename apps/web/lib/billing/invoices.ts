import { prisma } from '@storage/db'

import { applyCreditToInvoice } from '@/lib/billing/credit'
import { emitEvent } from '@storage/core/events'
import { effectiveByGroup } from '@storage/core/facility-settings'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { nextInvoiceNumber } from '@/lib/billing/numbering'
import { discountForLeasePeriod, markDiscountApplied } from '@/lib/promotions/billing'
import { markReferralRewardApplied, referralRewardsForLease } from '@/lib/referrals/billing'
import { leaseChainIds } from '@/lib/billing/transfer-chain'
import {
  buildInvoice,
  formatInvoiceNumber,
  periodStartsBetween,
  type BillingPeriod,
  type BillingPolicy,
  type ChargeLine,
} from '@storage/core/billing'

// PRD 02 US-17 (B-044). The nightly recurring invoice run.
//
// Every figure on the invoice comes from `@storage/core/billing`; this file
// reads rows, hands them over, and writes the result. The same division B-042
// settled for metrics (D-25) and for the same reason — a total computed here
// as well as there is a total that will eventually disagree with itself.
//
// Idempotency is the unique constraint on `(leaseId, periodStart)`, not a
// check-then-insert. The run catches up missed business dates (FR-4), so a
// date that already generated must be unforgeable rather than merely checked.

type RecordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => void

/// The recurring charges on a lease.
///
/// Rent is taxable and the protection premium is not: Texas taxes self-storage
/// as a taxable service, and a protection plan is not rent. `calculateMoveInCost`
/// had to assume a single base before real invoices existed and said so in its
/// own comment — this is where that assumption gets replaced. Per-state
/// taxability of each component is configuration a second state will need
/// (D-10); one flag per line is the seam for it.
function chargesFor(lease: { monthlyRateCents: number; protectionCents: number; protectionPlanName: string | null }): ChargeLine[] {
  return [
    { type: 'rent', description: 'Rent', monthlyCents: lease.monthlyRateCents, taxable: true },
    {
      type: 'protection',
      description: lease.protectionPlanName ?? 'Protection plan',
      monthlyCents: lease.protectionCents,
      taxable: false,
    },
  ]
}

export type GenerateResult = { created: number; skipped: number }

/// Generates every invoice due to be issued at this facility on this business
/// date.
///
/// "Due to be issued" is US-17's lead time: an invoice for a period starting on
/// D is created `invoiceLeadDays` before D (default 5), so the tenant is
/// notified before the money is wanted rather than on the day.
export async function generateInvoices(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<GenerateResult> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { billingPolicy: true, invoiceLeadDays: true, prorateOnMoveOut: true },
  })

  const through = new Date(businessDate.getTime() + facility.invoiceLeadDays * 86_400_000)

  const [leases, taxRows] = await Promise.all([
    prisma.lease.findMany({
      where: { facilityId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
      select: {
        id: true,
        // B-225. Credit on account belongs to the TENANT at a facility —
        // `Payment` carries no lease — so sweeping it onto a new invoice needs
        // the tenant this lease bills.
        tenantId: true,
        startDate: true,
        billingDay: true,
        monthlyRateCents: true,
        protectionCents: true,
        protectionPlanName: true,
        moveOutDate: true,
        transferredFromLeaseId: true,
      },
    }),
    prisma.taxComponent.findMany({ where: { facilityId } }),
  ])

  // B-162. Where each lease's tenancy actually began.
  //
  // The period index is what a promotion's schedule is keyed to ("period 0 is
  // free"), and it was counted from THIS lease's start — so a transfer restarted
  // it at zero. With the redemption now following the tenant (D-93), that would
  // have landed the remaining discounts on the wrong months: `appliedPeriods`
  // already holds 0 and 1, so the new lease's first two periods would be
  // silently skipped and month three's discount would arrive in month five.
  // Counting from the chain's origin makes the index describe the TENANCY,
  // which is what the promise was made about. Only the transferred leases need
  // the walk; everything else maps to itself.
  const transferred = leases.filter((lease) => lease.transferredFromLeaseId !== null)
  const chains = transferred.length
    ? await leaseChainIds(transferred.map((lease) => lease.id))
    : new Map<string, string[]>()
  const originStarts = new Map<string, Date>()
  if (chains.size > 0) {
    const origins = await prisma.lease.findMany({
      // `leaseChainIds` returns each chain oldest LAST.
      where: { id: { in: [...chains.values()].map((chain) => chain[chain.length - 1]) } },
      select: { id: true, startDate: true },
    })
    const startById = new Map(origins.map((row) => [row.id, row.startDate]))
    for (const [leaseId, chain] of chains) {
      const start = startById.get(chain[chain.length - 1])
      if (start) originStarts.set(leaseId, start)
    }
  }

  // Effective as of the business date being run, not today's date — a
  // catch-up run for last Tuesday must use last Tuesday's tax rates (FR-9).
  const taxRates = [...effectiveByGroup(taxRows, businessDate, (row) => row.jurisdiction).values()]
    .map((row) => ({ jurisdiction: row.jurisdiction, rateBasisPoints: row.rateBasisPoints }))
    .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction))

  let created = 0
  let skipped = 0

  for (const lease of leases) {
    // A lease start is stored as an instant; a period boundary is a calendar
    // day. Normalising here keeps the "did this period start before the lease"
    // comparison from turning on a time of day.
    const leaseStart = startOfDay(lease.startDate)

    // Counted from the TENANCY's first billed period, so a promotion's schedule
    // ("period 0 is free") lines up with the invoice that actually bills it.
    // Incremented for every period the generator yields, INCLUDING ones skipped
    // for a move-out — the index describes the calendar, not what got billed.
    //
    // B-162: on a transferred lease the count starts where the previous lease
    // left off. `billingDay` is carried across a transfer, so the two halves
    // sit on the same period boundaries and the offset is simply how many of
    // them elapsed before this lease opened.
    const originStart = originStarts.get(lease.id)
    //
    // `periodStartsBetween` yields the periods starting strictly AFTER its
    // `after` argument and up to and including `through` — which is exactly the
    // set already billed on the leases this one came from, since the first
    // period a lease bills is the first one after its own start (the move-in
    // payment covers the period it lands in). The cap is raised past the
    // 12-period default because a tenancy that has run for years before a
    // transfer would otherwise silently undercount.
    const offset = originStart
      ? periodStartsBetween(
          facility.billingPolicy as BillingPolicy,
          lease.billingDay,
          startOfDay(originStart),
          leaseStart,
          600,
        ).length
      : 0
    let periodIndex = offset - 1

    for (const period of periodStartsBetween(
      facility.billingPolicy as BillingPolicy,
      lease.billingDay,
      leaseStart,
      through,
    )) {
      periodIndex += 1
      // A scheduled move-out inside or before the period means the tenant is
      // not there for it. Billing a full month to someone who has given notice
      // for the 3rd is the invoice that generates the angry phone call, and
      // the credit that follows is a manual fix for a thing we knew.
      if (lease.moveOutDate && startOfDay(lease.moveOutDate).getTime() <= period.start.getTime()) {
        skipped += 1
        continue
      }

      const outcome = await createInvoiceForPeriod({
        facilityId,
        periodIndex,
        lease,
        period,
        taxRates,
        businessDate,
        // A move-out part-way through the period bills only the days used,
        // and ONLY where the facility prorates out. Where it does not, the
        // tenant pays the period they are in — the common lease term, and the
        // shipped default (D-10). Reading the setting here rather than always
        // prorating is the difference between honouring the lease and
        // silently rewriting it.
        prorateTo:
          facility.prorateOnMoveOut && lease.moveOutDate ? startOfDay(lease.moveOutDate) : undefined,
      })

      if (outcome === 'skipped') {
        skipped += 1
      } else {
        created += 1
        recordItem({ itemId: lease.id, ok: true, message: `invoice ${outcome} for ${iso(period.start)}` })
      }
    }
  }

  return { created, skipped }
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

type CreateInput = {
  facilityId: string
  lease: {
    id: string
    tenantId: string
    monthlyRateCents: number
    protectionCents: number
    protectionPlanName: string | null
  }
  period: BillingPeriod
  taxRates: { jurisdiction: string; rateBasisPoints: number }[]
  businessDate: Date
  prorateTo?: Date
  /// PRD 04 US-12 AC2. Which billed period this is for the lease, counted from
  /// zero, so a promotion's snapshotted schedule can say what comes off it.
  periodIndex: number
}

/// Writes one invoice, its line items and its ledger charge in one
/// transaction, and returns the number it issued — or `'skipped'` when there
/// is nothing to bill, or when another run got to this period first.
async function createInvoiceForPeriod(input: CreateInput): Promise<string | 'skipped'> {
  const { facilityId, lease, period, taxRates, businessDate } = input

  const shouldProrate = input.prorateTo !== undefined && input.prorateTo.getTime() < period.end.getTime()

  // PRD 04 US-12 AC2's structured discount instruction, read from the snapshot
  // taken at redemption rather than from the promotion — which may have been
  // edited or ended since, and must not retroactively change what a tenant was
  // promised.
  const discount = await discountForLeasePeriod(lease.id, input.periodIndex)

  // PRD 10 §6.2 (B-100). Referral rewards ride the SAME structured-discount
  // path, as their own lines rather than merged into the promotion's — §5.5
  // requires "two separate discount lines with distinct descriptions". They
  // stack: a promotion is a price the business advertises, a referral reward
  // is payment for work a tenant did.
  const rewards = await referralRewardsForLease(lease.id)

  const built = buildInvoice({
    period,
    charges: chargesFor(lease),
    taxRates,
    ...(shouldProrate ? { prorateFrom: period.start, prorateTo: input.prorateTo } : {}),
    ...(discount ? { discountCents: discount.amountCents, discountDescription: discount.description } : {}),
    ...(rewards.length > 0
      ? {
          extraDiscounts: rewards.map((reward) => ({
            amountCents: reward.amountCents,
            description: reward.description,
          })),
        }
      : {}),
  })

  // Nothing to bill — a lease at zero rent with no protection. Recording a
  // zero invoice would put a $0.00 line in a tenant's history and an empty
  // charge on the ledger.
  //
  // Tested on the SUBTOTAL, not the total (B-100). A lease with real charges
  // that a discount happens to cover in full is a different thing entirely
  // from a lease with nothing to charge: the tenant owes nothing this month
  // BECAUSE of a credit, and that is precisely the invoice they should be able
  // to see. Skipping it also lost the record that the credit had been
  // applied — `markReferralRewardApplied` runs inside the transaction below —
  // so a reward larger than one month's rent would have been re-applied in
  // full every month, forever. Found by the stack-cap test, which is the only
  // place a discount legitimately equals the charges.
  if (built.subtotalCents === 0) return 'skipped'

  try {
    return await prisma.$transaction(async (tx) => {
      const sequence = await nextInvoiceNumber(tx, facilityId)
      const number = formatInvoiceNumber(sequence)

      const invoice = await tx.invoice.create({
        data: {
          facilityId,
          leaseId: lease.id,
          number,
          // `open` rather than `draft`: this is money owed, and a draft status
          // would leave it invisible to every balance and ageing query that
          // B-042 already built against real invoices.
          status: 'open',
          issueDate: businessDate,
          dueDate: period.start,
          periodStart: period.start,
          periodEnd: period.end,
          subtotalCents: built.subtotalCents,
          discountCents: built.discountCents,
          taxCents: built.taxCents,
          totalCents: built.totalCents,
          lineItems: {
            create: built.lines.map((line) => ({
              type: line.type,
              description: line.description,
              quantity: line.quantity,
              unitAmountCents: line.unitAmountCents,
              amountCents: line.amountCents,
            })),
          },
        },
      })

      await tx.ledgerEntry.create({
        data: {
          facilityId,
          leaseId: lease.id,
          type: 'charge',
          // Signed: a charge increases what is owed.
          amountCents: built.totalCents,
          description: `Invoice ${number}`,
          occurredAt: businessDate,
          invoiceId: invoice.id,
        },
      })

      // B-225. Money the tenant has already handed over, spent on the invoice
      // the moment it is issued.
      //
      // This is the sweep that closes the oldest money gap in the tree.
      // `applyPayment` has returned `unappliedCents` since B-044 and nothing
      // read it: a tenant who paid $600 in December for six months was issued
      // January's invoice at full value, charged a late fee on it, and had
      // their card charged again — a chargeback produced by their own money.
      //
      // INSIDE the transaction, and after the ledger entry, on purpose. A
      // rolled-back invoice must not leave allocations pointing at an invoice
      // that does not exist, and the charge has to be on the books before the
      // credit can settle it — the same ordering the promotion and referral
      // marks below rely on, and for the same reason.
      //
      // It does not emit a payment event or write a ledger entry of its own:
      // no money moved. The cash arrived, and was recorded, when the tenant
      // handed it over; this only decides which invoice it was for.
      await applyCreditToInvoice(tx, {
        tenantId: lease.tenantId,
        facilityId,
        invoiceId: invoice.id,
      })

      await emitEvent(
        {
          name: 'invoice.created',
          entityType: 'Invoice',
          entityId: invoice.id,
          facilityId,
          payload: {
            leaseId: lease.id,
            number,
            totalCents: built.totalCents,
            dueDate: iso(period.start),
          },
        },
        tx,
      )

      // Inside the transaction, so a rolled-back invoice never leaves a
      // promotion looking spent — and a re-run of the nightly job then cannot
      // discount the same period a second time.
      if (discount) await markDiscountApplied(tx, discount.redemptionId, input.periodIndex)

      // Same transaction, same reason: a rolled-back invoice must never leave a
      // referral looking paid, or the next nightly run credits the same $50 a
      // second time.
      //
      // Recorded for every reward that was OFFERED, including one the stack cap
      // reduced to nothing. That is deliberate: §5.5 caps the stack at the
      // rent, so a reward can legitimately be worth zero on a small invoice,
      // and leaving it unmarked would carry it forward to be paid in full next
      // month — turning a capped reward into a deferred one nobody promised.
      for (const reward of rewards) await markReferralRewardApplied(tx, reward, invoice.id)

      return number
    })
  } catch (error) {
    // Another run generated this period between the look-up and the insert —
    // the unique constraint is the real guarantee, and losing that race is the
    // correct outcome, not an error. The consumed invoice number goes back to
    // the pool with the rollback, which is the whole point of the counter.
    if (isUniqueConstraintError(error)) return 'skipped'
    throw error
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}

/// US-17's "notify the tenant" side and PRD 05 CN-1/CN-2's reminders.
///
/// Emits `invoice.due_soon` and `invoice.due_today` from the invoice's own due
/// date. Deliberately event-only and deliberately here rather than in comms:
/// PRD 05 CN-3 requires the ladder be driven by billing-engine events, never a
/// comms-side calendar. B-050 owns which of these become emails.
export async function emitDueReminders(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<void> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { invoiceLeadDays: true },
  })

  const soon = new Date(businessDate.getTime() + facility.invoiceLeadDays * 86_400_000)

  const due = await prisma.invoice.findMany({
    where: {
      facilityId,
      status: { in: ['open', 'partially_paid'] },
      dueDate: { in: [businessDate, soon] },
    },
    select: { id: true, dueDate: true, number: true, totalCents: true, amountPaidCents: true },
  })

  for (const invoice of due) {
    const today = invoice.dueDate.getTime() === businessDate.getTime()
    // Already settled invoices are not chased. `status` alone would be enough
    // once B-048 maintains it, but the amounts are the fact and the status is
    // the summary of it.
    if (invoice.amountPaidCents >= invoice.totalCents) continue

    await emitEvent({
      name: today ? 'invoice.due_today' : 'invoice.due_soon',
      entityType: 'Invoice',
      entityId: invoice.id,
      facilityId,
      payload: {
        number: invoice.number,
        dueDate: iso(invoice.dueDate),
        outstandingCents: invoice.totalCents - invoice.amountPaidCents,
      },
    })
    recordItem({
      itemId: invoice.id,
      ok: true,
      message: today ? `invoice ${invoice.number} due today` : `invoice ${invoice.number} due soon`,
    })
  }
}
