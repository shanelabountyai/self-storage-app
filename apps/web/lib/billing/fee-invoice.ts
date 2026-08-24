import { type Prisma, prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { formatInvoiceNumber } from '@storage/core/billing'
import { nextInvoiceNumber } from '@/lib/billing/numbering'

// PRD 02 §4.5 US-21 (B-167). The one way a fee is posted.
//
// Three copies of this shape existed before this item — late fees
// (`late-fees.ts`), the NSF fee (`reversals.ts`) and, had it been written
// alongside them, the ad-hoc charge — and each carried the same paragraph of
// reasoning in its own words. They are one function now, because the shape is
// load-bearing rather than incidental:
//
//   * **Its own `kind: 'fee'` invoice, never a line on the rent invoice.** An
//     invoice the tenant has already been sent must not change totals after
//     the fact, and `kind: 'fee'` is what stops a fee becoming the base for a
//     late fee — `assessLateFees` reads `rent` invoices only, for both the
//     base and the days-past-due anchor.
//   * **An invoice, never only a ledger entry.** Autopay collects invoices; a
//     charge posted to the ledger alone is never collected automatically and
//     `waivableFees`/`waiveFeeInvoice` cannot see it. That is exactly the
//     defect B-168 has to unpick for the promotional recapture.
//   * **A matching `charge` ledger entry in the same transaction**, so the
//     ledger screen and the notice claim reconcile against the invoice.
//
// Not taxable: no fee here is a taxable service in Texas the way rent is
// (D-10). A state that taxes them configures it where rent's taxability lives.

export type FeeInvoiceLine = {
  /// What the tenant reads on the invoice. Load-bearing for late fees, which
  /// read back which ladder steps they have charged from this text — see
  /// `chargedSteps`.
  description: string
  amountCents: number
}

export type RaisedFeeInvoice = { id: string; number: string; totalCents: number }

/// Raises one fee invoice carrying the given lines, plus its ledger entry and
/// its `invoice.created` event.
///
/// `on` is the day the fee is raised, and it is the invoice's issue date, due
/// date and period start all at once. **Due the day it is raised**: every fee
/// here charges for something that has already happened, and a grace period on
/// a late fee is a second schedule nobody configured.
///
/// Takes a transaction client because two of its three callers already have
/// one open — the NSF fee posts inside the reversal that caused it, and the
/// ad-hoc charge audits in the same breath as it charges.
export async function raiseFeeInvoice(
  tx: Prisma.TransactionClient,
  input: {
    facilityId: string
    leaseId: string
    on: Date
    lines: FeeInvoiceLine[]
    /// The ledger entry's own description, which is what the ledger screen and
    /// the lien claim show. Defaults to the first line's text.
    ledgerDescription?: string
  },
): Promise<RaisedFeeInvoice> {
  const total = input.lines.reduce((sum, line) => sum + line.amountCents, 0)
  const number = formatInvoiceNumber(await nextInvoiceNumber(tx, input.facilityId))

  const invoice = await tx.invoice.create({
    data: {
      facilityId: input.facilityId,
      leaseId: input.leaseId,
      number,
      kind: 'fee',
      status: 'open',
      issueDate: input.on,
      dueDate: input.on,
      periodStart: input.on,
      periodEnd: new Date(input.on.getTime() + 86_400_000),
      subtotalCents: total,
      taxCents: 0,
      totalCents: total,
      lineItems: {
        create: input.lines.map((line) => ({
          type: 'fee' as const,
          description: line.description,
          quantity: 1,
          unitAmountCents: line.amountCents,
          amountCents: line.amountCents,
        })),
      },
    },
  })

  await tx.ledgerEntry.create({
    data: {
      facilityId: input.facilityId,
      leaseId: input.leaseId,
      type: 'charge',
      amountCents: total,
      description: `${input.ledgerDescription ?? input.lines[0]?.description ?? 'Fee'} — invoice ${number}`,
      occurredAt: input.on,
      invoiceId: invoice.id,
    },
  })

  await emitEvent(
    {
      name: 'invoice.created',
      entityType: 'Invoice',
      entityId: invoice.id,
      facilityId: input.facilityId,
      payload: { leaseId: input.leaseId, number, totalCents: total, kind: 'fee' },
    },
    tx,
  )

  return { id: invoice.id, number, totalCents: total }
}

/// The same, opening its own transaction. For callers that have none.
export async function raiseFeeInvoiceStandalone(
  input: Parameters<typeof raiseFeeInvoice>[1],
): Promise<RaisedFeeInvoice> {
  return prisma.$transaction((tx) => raiseFeeInvoice(tx, input))
}

/// The effective-dated amount a facility charges for a fee type today, or null
/// when it has configured none.
///
/// Effective-dated like every other price here: the fee in force on `asOf`,
/// since the thing being charged for is happening then whatever date anything
/// else carries.
export async function scheduledFeeCents(
  facilityId: string,
  feeType: string,
  asOf: Date = new Date(),
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number | null> {
  const schedule = await client.feeSchedule.findFirst({
    where: { facilityId, feeType: feeType as never, effectiveFrom: { lte: asOf } },
    orderBy: { effectiveFrom: 'desc' },
    select: { amountCents: true },
  })
  if (!schedule || schedule.amountCents <= 0) return null
  return schedule.amountCents
}
