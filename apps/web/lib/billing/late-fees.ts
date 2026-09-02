import { prisma } from '@storage/db'

import { creditByTenant } from '@/lib/billing/credit'
import { effectiveByGroup } from '@storage/core/facility-settings'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { daysPastDue, outstandingCents } from '@storage/core/metrics'
import { lateFeeAmount, stepsDue, type LateFeeStep } from '@storage/core/billing'
import { recordAudit } from '@storage/core/audit'
import { effectsByLease } from '@/lib/admin/holds'
import { allChainIds, leaseChainIds } from '@/lib/billing/transfer-chain'
import { leasesWithSettlingPayment } from './allocation'
import { raiseFeeInvoice } from '@/lib/billing/fee-invoice'
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
///
/// Exported for B-208: `lateFeeStepsFor(...)[0].daysPastDue` is the day this
/// facility decided rent is genuinely late, and the payment-plan breach job
/// reads it rather than inventing a second number for the same idea (D-107).
export async function lateFeeStepsFor(facilityId: string, asOf: Date): Promise<LateFeeStep[]> {
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

  const steps = await lateFeeStepsFor(facilityId, businessDate)
  if (steps.length === 0) return result

  const leases = await prisma.lease.findMany({
    where: { facilityId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: {
      id: true,
      // B-225. Credit is held per tenant at a facility, not per lease.
      tenantId: true,
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

  // US-42. One query for the whole facility rather than one per lease.
  const onHold = await effectsByLease(
    leases.map((lease) => lease.id),
    'halt_late_fees',
    businessDate,
  )

  // B-103. A bank debit that has been accepted but has not settled yet.
  const settling = await leasesWithSettlingPayment(facilityId)

  // B-225. Money already in hand that no invoice has claimed.
  //
  // Invoice generation sweeps credit onto an invoice as it is issued, so in the
  // ordinary course this is zero by the time the ladder runs. It is read here
  // anyway because the two jobs are not ordered with respect to a payment taken
  // BETWEEN them: a tenant who pays at the counter on the 3rd, after the 1st's
  // invoice was raised, would otherwise be fee'd on the 5th for rent their
  // money already covers. Fee-ing somebody who has overpaid is the single worst
  // outcome in this file, so it is checked rather than assumed.
  const creditByTenantId = await creditByTenant(
    facilityId,
    leases.map((lease) => lease.tenantId),
  )

  // B-138. Which ladder steps have already been charged is read back from the
  // lease's own fee invoices — and a PAID one does not move through a transfer,
  // because it is settled history belonging where it was raised. D-86 moves the
  // arrears, so a transferred tenant arrives with the full `age` and, without
  // this, no record of the steps already charged: the ladder would charge step
  // 1 through N a second time, on the new lease, for the same delinquency.
  const chains = await leaseChainIds(leases.map((lease) => lease.id))
  const ownIds = new Set(leases.map((lease) => lease.id))
  const ancestorIds = allChainIds(chains).filter((id) => !ownIds.has(id))
  const ancestorFeeLines = ancestorIds.length
    ? await prisma.invoice.findMany({
        where: { leaseId: { in: ancestorIds }, kind: 'fee' },
        select: { leaseId: true, kind: true, lineItems: { select: { description: true } } },
      })
    : []
  const ancestorFeesByLease = new Map<string, typeof ancestorFeeLines>()
  for (const invoice of ancestorFeeLines) {
    ancestorFeesByLease.set(invoice.leaseId, [
      ...(ancestorFeesByLease.get(invoice.leaseId) ?? []),
      invoice,
    ])
  }

  for (const lease of leases) {
    // A hold declaring `halt_late_fees` stops assessment outright — a tenant on
    // a payment plan, in a billing dispute, or under an automatic stay does not
    // accrue fees while it stands (US-42).
    if (onHold.has(lease.id)) {
      result.skipped += 1
      recordItem({ itemId: lease.id, ok: true, message: 'late fee skipped — lease is on hold' })
      continue
    }

    // B-103. The money has left their bank account; nothing they can do makes
    // it arrive faster. Charging a fee for the four days it spends in transit
    // is the most avoidable way to make somebody who paid on time feel cheated.
    if (settling.has(lease.id)) {
      result.skipped += 1
      recordItem({
        itemId: lease.id,
        ok: true,
        message: 'late fee skipped — a bank payment is still settling',
      })
      continue
    }

    // Rent only, for the base AND the anchor. See the note at the top.
    const rentInvoices = lease.invoices.filter((invoice) => invoice.kind === 'rent')
    const overdue = rentInvoices
      .filter((invoice) => invoice.dueDate.getTime() <= businessDate.getTime())
      .reduce((sum, invoice) => sum + outstandingCents(invoice), 0)
    if (overdue <= 0) continue

    // B-225. Credit nets off what is overdue BEFORE the fee is sized, not just
    // before it is skipped. A percentage step charged on the gross would bill a
    // tenant 10% of rent they have already handed over — a smaller version of
    // the same wrong, and the one that would have survived a "skip if fully
    // covered" guard.
    //
    // Read-only on purpose: the ladder does not SPEND credit, it declines to
    // charge for money it can see. Spending is the invoice sweep's job and
    // autopay's, both of which run in a transaction that can record it; a fee
    // assessment quietly writing payment allocations would be money moving in a
    // job whose name says it charges rather than settles.
    //
    // `age` is deliberately NOT netted. How late a tenant is, is a fact about
    // dates; credit changes what they owe, not how long it has been owed, and a
    // partial credit must not reset a ladder that is three steps in.
    const credit = creditByTenantId.get(lease.tenantId) ?? 0
    const chargeable = overdue - credit
    if (chargeable <= 0) {
      result.skipped += 1
      recordItem({
        itemId: lease.id,
        ok: true,
        message: 'late fee skipped — credit on account covers what is overdue',
      })
      continue
    }

    const age = daysPastDue(rentInvoices, businessDate)
    const alreadyCharged = chargedSteps([
      ...lease.invoices,
      ...(chains.get(lease.id) ?? []).flatMap((id) => ancestorFeesByLease.get(id) ?? []),
    ])
    const due = stepsDue(age, steps, alreadyCharged)
    if (due.length === 0) continue

    const lines = due
      .map((step) => ({ step, amountCents: lateFeeAmount(step, chargeable) }))
      .filter((line) => line.amountCents > 0)
    if (lines.length === 0) {
      result.skipped += 1
      continue
    }

    const created = await raiseLateFeeInvoice(facilityId, lease.id, businessDate, lines)
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
/// The shape lives in `fee-invoice.ts` since B-167 — this is the late-fee
/// caller of it. **The `(leaseId, periodStart)` unique that used to make this
/// idempotent is now scoped to `kind: 'rent'`** (B-167), and losing it costs
/// nothing here: `chargedSteps` above reads back which ladder steps a lease has
/// already been charged from the fee line descriptions, which is what actually
/// stops a step being charged twice and always was. The catch below stays for
/// the invoice NUMBER, whose per-facility unique is untouched.
async function raiseLateFeeInvoice(
  facilityId: string,
  leaseId: string,
  businessDate: Date,
  lines: { step: LateFeeStep; amountCents: number }[],
): Promise<string | null> {
  try {
    const raised = await prisma.$transaction((tx) =>
      raiseFeeInvoice(tx, {
        facilityId,
        leaseId,
        on: businessDate,
        ledgerDescription: 'Late fee',
        lines: lines.map((line) => ({
          description: `Late fee (step ${line.step.step}) — ${line.step.daysPastDue}+ days past due`,
          amountCents: line.amountCents,
        })),
      }),
    )
    return raised.number
  } catch (error) {
    // Another run took this invoice number first — the unique constraint is the
    // real guarantee and losing that race is the correct outcome.
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
