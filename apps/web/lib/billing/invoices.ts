import { prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { effectiveByGroup } from '@storage/core/facility-settings'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { nextInvoiceNumber } from '@/lib/billing/numbering'
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
        startDate: true,
        billingDay: true,
        monthlyRateCents: true,
        protectionCents: true,
        protectionPlanName: true,
        moveOutDate: true,
      },
    }),
    prisma.taxComponent.findMany({ where: { facilityId } }),
  ])

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

    for (const period of periodStartsBetween(
      facility.billingPolicy as BillingPolicy,
      lease.billingDay,
      leaseStart,
      through,
    )) {
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
    monthlyRateCents: number
    protectionCents: number
    protectionPlanName: string | null
  }
  period: BillingPeriod
  taxRates: { jurisdiction: string; rateBasisPoints: number }[]
  businessDate: Date
  prorateTo?: Date
}

/// Writes one invoice, its line items and its ledger charge in one
/// transaction, and returns the number it issued — or `'skipped'` when there
/// is nothing to bill, or when another run got to this period first.
async function createInvoiceForPeriod(input: CreateInput): Promise<string | 'skipped'> {
  const { facilityId, lease, period, taxRates, businessDate } = input

  const shouldProrate = input.prorateTo !== undefined && input.prorateTo.getTime() < period.end.getTime()
  const built = buildInvoice({
    period,
    charges: chargesFor(lease),
    taxRates,
    ...(shouldProrate ? { prorateFrom: period.start, prorateTo: input.prorateTo } : {}),
  })

  // Nothing to bill — a lease at zero rent with no protection. Recording a
  // zero invoice would put a $0.00 line in a tenant's history and an empty
  // charge on the ledger.
  if (built.totalCents === 0) return 'skipped'

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
