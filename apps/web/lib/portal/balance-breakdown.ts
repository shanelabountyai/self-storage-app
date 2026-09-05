import { prisma } from '@storage/db'
import { openItems, type LedgerRow } from '@storage/core/billing'

// PRD 01 US-702/US-703 §6.7 (B-232). What the balance on `/portal/pay` is
// actually made of.
//
// The screen was a two-row `<dl>` — "Balance $487.50", "Paying today $487.50" —
// while a past-due balance is rent plus a late fee plus possibly a lien-prep fee
// and a second month's rent. *What is this* is the question that gets asked
// before anybody pays, and nothing in the portal answered it: `/portal/statements`
// covers CLOSED months only, and the dashboard shows a total too.
//
// Two rules hold this together:
//
//  1. **The lines come off the same ledger read as the total**, through
//     `openItems`, so they sum to the balance by construction. A second
//     addition that agreed today is a second addition that can disagree.
//  2. **A tenant reads this, so it is written in a tenant's words.** The ledger
//     description of a rent charge is `Invoice INV-0007`, and a late fee's
//     invoice line is `Late fee (step 2) — 30+ days past due`. Neither is an
//     answer to "what is this"; both are expanded or rewritten below.

export type BreakdownLine = {
  /// What it is, in the tenant's words. Never a reason code, never a step
  /// number, never a bare invoice number.
  /// Null when the label is generated rather than stored — see `lateFee`.
  label: string | null
  /// B-260. True when this line is a late fee whose wording this file
  /// generates; the page prints it from the dictionary with `on`.
  lateFee?: boolean
  /// The facility-local day it happened, already written out.
  on: string
  /// Signed cents, the ledger's own convention: charges positive, payments and
  /// credits negative.
  amountCents: number
  /// A charge a tenant might reasonably want to argue with — a late fee, a
  /// lien-preparation fee, a lock cut. The screen puts the office's phone
  /// number on these lines rather than only at the foot of the page (2.4.4).
  disputable: boolean
}

export type BalanceBreakdown = {
  lines: BreakdownLine[]
  /// The sum of `lines`. Equal to the lease balance whenever that is positive;
  /// asserted rather than assumed by the caller — see `reconciles` below.
  totalCents: number
}

/// A late-fee line as the late-fee run writes it (`late-fees.ts:275`).
const LATE_FEE_LINE = /^Late fee \(step \d+\)/

function dayIn(timezone: string): (date: Date) => string {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return (date) => format.format(date)
}

/// True when the breakdown adds up to the balance it claims to explain.
///
/// `openItems` makes this true by construction, so a false here means the
/// ledger read and the balance read saw different rows — which is worth failing
/// visibly on a screen that then asks for money.
export function reconciles(breakdown: BalanceBreakdown, balanceCents: number): boolean {
  return breakdown.totalCents === balanceCents
}

/// The open items on one lease, ready to render.
///
/// Empty when the tenant owes nothing, which is what `openItems` returns for a
/// zero or credit balance — the pay screen has its own "you are all paid up"
/// branch above this and never reaches it.
export async function balanceBreakdownFor(
  leaseId: string,
  timezone: string,
): Promise<BalanceBreakdown> {
  const entries = await prisma.ledgerEntry.findMany({
    where: { leaseId },
    orderBy: { occurredAt: 'asc' },
    select: {
      id: true,
      type: true,
      amountCents: true,
      description: true,
      occurredAt: true,
      invoice: {
        select: {
          number: true,
          lineItems: {
            select: { type: true, description: true, amountCents: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  })

  const rows: LedgerRow[] = entries.map((entry) => ({
    id: entry.id,
    kind: entry.type,
    description: entry.description,
    occurredAt: entry.occurredAt,
    amountCents: entry.amountCents,
    invoiceNumber: entry.invoice?.number ?? null,
  }))

  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const day = dayIn(timezone)
  const lines: BreakdownLine[] = []

  for (const item of openItems(rows)) {
    const entry = byId.get(item.id)
    const on = day(item.occurredAt)
    const invoiceLines = entry?.invoice?.lineItems ?? []

    // A charge that came from an invoice is expanded into the invoice's own
    // lines — rent for the period, the protection premium, the tax on it. That
    // is the itemisation; the ledger row above it is one number called
    // "Invoice INV-0007", which is the thing this screen was already showing.
    //
    // Only for charges: a PAYMENT carries the invoice it was allocated to, and
    // expanding it would print the charges a second time, as negatives.
    if (item.kind === 'charge' && invoiceLines.length > 0) {
      for (const line of invoiceLines) {
        // A $0.00 line — a waived fee, a 100% discount — is noise on a screen
        // whose job is to explain a figure.
        if (line.amountCents === 0) continue
        lines.push({
          // B-260 (D-122): the "Late fee, assessed …" wording is GENERATED
          // here, so it becomes a token the page renders in the reader's
          // language. `line.description` beside it is not — it is what the
          // billing engine wrote onto the invoice and what the statement, the
          // receipt and every staff screen show, so translating it at display
          // would make this screen disagree with the record it is itemising.
          label: LATE_FEE_LINE.test(line.description) ? null : line.description,
          lateFee: LATE_FEE_LINE.test(line.description),
          on,
          amountCents: line.amountCents,
          disputable: line.type === 'fee',
        })
      }
      continue
    }

    lines.push({
      label: describeEntry(item.kind, item.description),
      lateFee: false,
      on,
      amountCents: item.amountCents,
      disputable: false,
    })
  }

  return { lines, totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0) }
}

/// A ledger row with no invoice behind it, said to a tenant.
///
/// `Move-in charges` and `Late fee waived — invoice INV-0007` are already
/// readable; an invoice number on its own is not, and neither is the empty
/// string. The kind is what carries the meaning for money going the other way,
/// because "Payment INV-0007" tells a tenant nothing they wanted to know.
function describeEntry(kind: LedgerRow['kind'], description: string): string {
  switch (kind) {
    case 'payment':
      return 'Payment received'
    case 'credit':
      return 'Credit applied'
    case 'write_off':
      return 'Written off'
    case 'refund':
      return 'Refunded to you'
    default:
      return description.trim() || 'Charge'
  }
}
