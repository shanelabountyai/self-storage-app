import { prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { effectiveByGroup } from '@storage/core/facility-settings'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { daysPastDue, outstandingCents } from '@storage/core/metrics'
import { formatInvoiceNumber, lateFeeAmount, stepsDue, type LateFeeStep } from '@storage/core/billing'
import { recordAudit } from '@storage/core/audit'
import { nextInvoiceNumber } from '@/lib/billing/numbering'
import { checkMonetaryAuthority } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 US-21 (B-047). Assessing late fees automatically.
//
// US-21 says these are "applied automatically by the delinquency engine", and
// that engine is B-057 in Phase 2 — so this is the MVP path: a nightly job that
// reads the same `daysPastDue` every other consumer reads (D-25) and raises the
// steps that have come due. When B-057 lands it drives these same functions
// from a timeline stage rather than reimplementing the arithmetic.
//
// ── The two things that stop this compounding on its own ─────────────────────
//
// 1. A late fee is raised as its own invoice with `kind: 'fee'`, and the base
//    for a late fee is RENT invoices only. Without that split, an unpaid fee
//    would itself age and earn fees, and a balance would grow with nobody
//    having decided it should.
// 2. `daysPastDue` anchors to the oldest unpaid RENT invoice's ORIGINAL due
//    date, never to a fee or a retry attempt — the same rule the whole billing
//    engine turns on.

type RecordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => void

/// The steps in force at a facility on a given date, one per step number.
async function stepsFor(facilityId: string, asOf: Date): Promise<LateFeeStep[]> {
  const rows = await prisma.lateFeeRule.findMany({ where: { facilityId } })
  // Effective-dated per step (FR-9), so changing only the second fee leaves the
  // first alone.
  return [...effectiveByGroup(rows, asOf, (row) => String(row.step)).values()]
    .map((row) => ({
      step: row.step,
      daysPastDue: row.daysPastDue,
      amountCents: row.amountCents,
      percentBasisPoints: row.percentBasisPoints,
      basis: row.basis as LateFeeStep['basis'],
      capCents: row.capCents,
    }))
    .sort((a, b) => a.step - b.step)
}

export type AssessResult = { charged: number; skipped: number }

/// Raises every late-fee step that has come due at this facility.
///
/// Idempotent twice over: the step numbers already charged against a lease are
/// read back from the fee invoices themselves, and the fee invoice for a given
/// day collides on `Invoice`'s own `(leaseId, periodStart)` unique constraint.
/// The run is re-runnable and catch-up-safe like every other billing job.
export async function assessLateFees(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<AssessResult> {
  const result: AssessResult = { charged: 0, skipped: 0 }

  const steps = await stepsFor(facilityId, businessDate)
  if (steps.length === 0) return result

  const leases = await prisma.lease.findMany({
    where: { facilityId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: {
      id: true,
      invoices: {
        select: {
          id: true,
          kind: true,
          dueDate: true,
          totalCents: true,
          amountPaidCents: true,
          lineItems: { select: { description: true } },
        },
      },
    },
  })

  for (const lease of leases) {
    // Rent only, for the base AND the anchor. See the note at the top.
    const rentInvoices = lease.invoices.filter((invoice) => invoice.kind === 'rent')
    const overdue = rentInvoices
      .filter((invoice) => invoice.dueDate.getTime() <= businessDate.getTime())
      .reduce((sum, invoice) => sum + outstandingCents(invoice), 0)
    if (overdue <= 0) continue

    const age = daysPastDue(rentInvoices, businessDate)
    const alreadyCharged = chargedSteps(lease.invoices)
    const due = stepsDue(age, steps, alreadyCharged)
    if (due.length === 0) continue

    const lines = due
      .map((step) => ({ step, amountCents: lateFeeAmount(step, overdue) }))
      .filter((line) => line.amountCents > 0)
    if (lines.length === 0) {
      result.skipped += 1
      continue
    }

    const created = await raiseFeeInvoice(facilityId, lease.id, businessDate, lines)
    if (created === null) {
      result.skipped += 1
      continue
    }

    result.charged += lines.length
    recordItem({
      itemId: lease.id,
      ok: true,
      message: `late fee ${created} — ${lines.map((line) => `step ${line.step.step} ${formatCents(line.amountCents)}`).join(', ')} (${age} days past due)`,
    })
  }

  return result
}

/// Which steps a lease has already been charged.
///
/// Read back from the fee line descriptions, which carry the step number in a
/// fixed prefix. Held in the description rather than a column because a line
/// item is generic across every fee type and a `lateFeeStep` column would be
/// null on every other one — and the description is what a tenant reads on the
/// invoice anyway, so it has to say which fee this is regardless.
function chargedSteps(invoices: { kind: string; lineItems: { description: string }[] }[]): number[] {
  const steps: number[] = []
  for (const invoice of invoices) {
    if (invoice.kind !== 'fee') continue
    for (const line of invoice.lineItems) {
      const match = /^Late fee \(step (\d+)\)/.exec(line.description)
      if (match) steps.push(Number(match[1]))
    }
  }
  return steps
}

/// One fee invoice per lease per business date, carrying whichever steps came
/// due that day.
///
/// Its own invoice rather than a line appended to the rent invoice: an invoice
/// the tenant has already been sent must not change totals after the fact, and
/// autopay collects invoices — a fee posted only to the ledger would never be
/// charged automatically. `periodStart` is the day the fee was raised, which
/// also makes `Invoice`'s existing `(leaseId, periodStart)` constraint the
/// idempotency guard for free.
async function raiseFeeInvoice(
  facilityId: string,
  leaseId: string,
  businessDate: Date,
  lines: { step: LateFeeStep; amountCents: number }[],
): Promise<string | null> {
  const total = lines.reduce((sum, line) => sum + line.amountCents, 0)

  try {
    return await prisma.$transaction(async (tx) => {
      const number = formatInvoiceNumber(await nextInvoiceNumber(tx, facilityId))
      const invoice = await tx.invoice.create({
        data: {
          facilityId,
          leaseId,
          number,
          kind: 'fee',
          status: 'open',
          issueDate: businessDate,
          // Due the day it is raised: the fee is for lateness that has already
          // happened, and a grace period on a late fee is a second late fee
          // schedule nobody configured.
          dueDate: businessDate,
          periodStart: businessDate,
          periodEnd: new Date(businessDate.getTime() + 86_400_000),
          subtotalCents: total,
          // Late fees are not a taxable service in Texas the way rent is
          // (D-10). A state that taxes them configures it where rent's
          // taxability lives — one flag per line in `buildInvoice`.
          taxCents: 0,
          totalCents: total,
          lineItems: {
            create: lines.map((line) => ({
              type: 'fee' as const,
              description: `Late fee (step ${line.step.step}) — ${line.step.daysPastDue}+ days past due`,
              quantity: 1,
              unitAmountCents: line.amountCents,
              amountCents: line.amountCents,
            })),
          },
        },
      })

      await tx.ledgerEntry.create({
        data: {
          facilityId,
          leaseId,
          type: 'charge',
          amountCents: total,
          description: `Late fee — invoice ${number}`,
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
          payload: { leaseId, number, totalCents: total, kind: 'fee' },
        },
        tx,
      )

      return number
    })
  } catch (error) {
    // Another run raised today's fee invoice first — the unique constraint is
    // the real guarantee and losing that race is the correct outcome.
    if (isUniqueConstraintError(error)) return null
    throw error
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// ── Waiving a fee (US-21's second AC) ────────────────────────────────────────

export type WaiveResult =
  | { ok: true; amountCents: number }
  | {
      ok: false
      reason: 'not_found' | 'already_settled' | 'forbidden' | 'over_limit' | 'missing_reason'
      limitCents?: number
      /// RBAC-2: over-limit routes to the next role up rather than simply
      /// failing, so the refusal carries who can approve it. Null when the
      /// actor already holds the highest rank that could.
      escalateToRank?: number | null
    }

/// Waives a fee invoice in full.
///
/// Three gates, and all three are US-21's own words — "waiving a late fee
/// requires the fee-waive permission and a reason code; waivers are
/// audit-logged and reportable":
///
///   * `fees:waive` AT this facility, and within the actor's monetary limit for
///     a fee waiver (RBAC-2). A counter staffer with a $0 limit cannot waive a
///     $20 fee, and the refusal says which rank can.
///   * A reason code, enforced here AND by `recordAudit` — `fee.waived` is in
///     the catalog as `requiresReason: true`, so a caller that forgot would be
///     refused by the audit layer anyway. Two guards because the money moves
///     before the audit write, and refusing early is the cheaper failure.
///   * The fee must still be outstanding. Waiving something already paid is a
///     refund, which is B-048's, with its own permission and its own limit.
///
/// The waiver is a `credit` ledger entry rather than a deletion or an edit —
/// the invoice stays, the charge stays, and the credit that cancelled it is
/// visible next to both. An invoice that quietly vanished is exactly what an
/// auditor asks about.
export async function waiveFeeInvoice(
  actor: Actor,
  invoiceId: string,
  input: { reasonCode: string; note?: string },
): Promise<WaiveResult> {
  if (!input.reasonCode?.trim()) return { ok: false, reason: 'missing_reason' }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      kind: true,
      number: true,
      facilityId: true,
      leaseId: true,
      status: true,
      totalCents: true,
      amountPaidCents: true,
    },
  })
  if (!invoice || invoice.kind !== 'fee') return { ok: false, reason: 'not_found' }

  const outstanding = invoice.totalCents - invoice.amountPaidCents
  if (outstanding <= 0 || invoice.status === 'void') return { ok: false, reason: 'already_settled' }

  const decision = checkMonetaryAuthority(actor, 'fee_waiver', outstanding, invoice.facilityId)
  if (!decision.allowed) {
    return decision.reason === 'forbidden'
      ? { ok: false, reason: 'forbidden' }
      : { ok: false, reason: 'over_limit', limitCents: decision.limitCents, escalateToRank: decision.escalateToRank }
  }

  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.create({
      data: {
        facilityId: invoice.facilityId,
        leaseId: invoice.leaseId,
        type: 'credit',
        // Signed: a credit reduces what is owed.
        amountCents: -outstanding,
        description: `Late fee waived — invoice ${invoice.number}`,
        invoiceId: invoice.id,
      },
    })

    // `void`, not `paid`: nobody paid it. The distinction is what makes the
    // revenue report able to tell forgiven money from collected money.
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'void' } })

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'fee.waived',
        entityType: 'Invoice',
        entityId: invoice.id,
        facilityId: invoice.facilityId,
        reasonCode: input.reasonCode,
        context: {
          leaseId: invoice.leaseId,
          number: invoice.number,
          amountCents: outstanding,
          note: input.note ?? null,
        },
      },
      tx,
    )
  })

  return { ok: true, amountCents: outstanding }
}
