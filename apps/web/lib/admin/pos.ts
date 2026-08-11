import { prisma, type Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import {
  cashNeedsApproval,
  MANAGER_RANK,
  requiresAttribution,
  settleTender,
  type CounterMethod,
  type TenderProblem,
} from '@storage/core/pos'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { restoreAccessIfSettled } from '@/lib/access/delinquency-gate'
import { applyPayment, type AppliedPayment } from '@/lib/billing/allocation'
import { openSessionFor } from '@/lib/admin/drawer'

// PRD 02 §4.8 US-32. Money taken across the counter.
//
// Deliberately NOT a drawer session: D-1 keeps drawer open/close/over-short in
// Phase 2 (B-078). Everything here is either a column on `Payment` or a read
// over it, which is what the backlog row means by "this is a read over
// Payment; it is not a drawer session."

/// Hands out the next receipt number for a facility.
///
/// Must be called inside the same transaction that writes the payment. The
/// UPDATE takes a row lock that serialises concurrent counter staff, and —
/// unlike a Postgres sequence — a rollback returns the number to the pool, so
/// the series has no holes. That is the whole difference between "unique" and
/// "gapless", and the reason this is not `@default(autoincrement())`.
async function nextReceiptNumber(tx: Prisma.TransactionClient, facilityId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ nextNumber: number }[]>`
    INSERT INTO "receipt_counter" ("facilityId", "nextNumber", "updatedAt")
    VALUES (${facilityId}, 2, NOW())
    ON CONFLICT ("facilityId")
    DO UPDATE SET "nextNumber" = "receipt_counter"."nextNumber" + 1, "updatedAt" = NOW()
    RETURNING "nextNumber" - 1 AS "nextNumber"
  `
  return rows[0].nextNumber
}

export type CounterPaymentInput = {
  facilityId: string
  tenantId: string
  leaseId: string
  method: CounterMethod
  amountCents: number
  tenderedCents?: number | null
  checkNumber?: string | null
}

export type CounterPaymentResult =
  | {
      ok: true
      paymentId: string
      receiptNumber: number
      changeCents: number | null
      /// US-22: what this payment settled, by category, for the screen and the
      /// receipt.
      allocation: { label: string; amountCents: number }[]
      /// Money the tenant handed over beyond what they owe. Surfaced rather
      /// than silently allocated — see the note in packages/core/billing.
      unappliedCents: number
    }
  | { ok: false; problem: TenderProblem | 'lease_not_found' | 'needs_manager' | 'card_not_supported' }

/// Records a payment taken at the counter, posts it to the ledger, and issues
/// a receipt number — all in one transaction, so a failure anywhere leaves no
/// half-recorded money and no consumed receipt number.
export async function recordCounterPayment(
  actor: Actor,
  input: CounterPaymentInput,
): Promise<CounterPaymentResult> {
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff access required')
  assertFacilityAccess(actor, input.facilityId)
  if (!can(actor, 'payments:take', input.facilityId)) {
    throw new ForbiddenError('Missing permission payments:take', 'payments:take', input.facilityId)
  }

  // A card at the counter still has to go through Stripe — there is no
  // terminal integration, and recording a card payment by hand would create a
  // ledger entry with no money behind it. Said plainly rather than silently
  // accepted (US-32's card path needs a terminal, which is not in this item).
  if (input.method === 'card') return { ok: false, problem: 'card_not_supported' }

  const settled = settleTender(input)
  if (!settled.ok) return { ok: false, problem: settled.problem }

  const lease = await prisma.lease.findFirst({
    where: { id: input.leaseId, tenantId: input.tenantId, facilityId: input.facilityId },
    select: { id: true },
  })
  // Checked rather than trusted: the lease id comes from a form, and posting
  // to a lease that is not this tenant's at this facility is the same
  // mis-crediting bug B-035 fixed on the webhook side.
  if (!lease) return { ok: false, problem: 'lease_not_found' }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: input.facilityId },
    select: { cashApprovalThresholdCents: true },
  })

  if (cashNeedsApproval(input.method, settled.amountCents, facility.cashApprovalThresholdCents)) {
    const rank = Math.max(
      0,
      ...actor.assignments
        .filter((a) => a.facilityId === null || a.facilityId === input.facilityId)
        .map((a) => a.rank),
    )
    if (rank < MANAGER_RANK) return { ok: false, problem: 'needs_manager' }
  }

  // A one-element box rather than a `let`: TypeScript narrows a variable only
  // ever assigned inside a callback to `never` where it is read. Same shape as
  // the settlement path in lib/payments/reconcile.ts.
  const allocation: AppliedPayment[] = []

  // B-078 / US-33: "cash and check payments post to the drawer session where
  // one exists" (US-32's own AC, written to anticipate this). Read outside
  // the transaction because it is a plain lookup, and null is a legal answer
  // — a counter payment taken with no session open still records, and the
  // deposits report is what surfaces it as unreconciled rather than a refusal
  // here that would stop somebody taking money.
  const drawerSession = requiresAttribution(input.method)
    ? await openSessionFor(input.facilityId)
    : null

  const result = await prisma.$transaction(async (tx) => {
    const receiptNumber = await nextReceiptNumber(tx, input.facilityId)

    const payment = await tx.payment.create({
      data: {
        facilityId: input.facilityId,
        tenantId: input.tenantId,
        amountCents: settled.amountCents,
        method: input.method,
        // Cash in hand is settled the moment it is taken — unlike a card,
        // there is no asynchronous confirmation to wait for.
        status: 'succeeded',
        tenderedCents: settled.tenderedCents,
        changeCents: settled.changeCents,
        checkNumber: input.checkNumber?.trim() || null,
        // From the session actor, never a form field (US-32's own wording).
        receivedByStaffId: requiresAttribution(input.method) ? actor.staffUserId : null,
        receiptNumber,
        drawerSessionId: drawerSession?.id ?? null,
      },
    })

    await tx.ledgerEntry.create({
      data: {
        facilityId: input.facilityId,
        leaseId: lease.id,
        type: 'payment',
        // Signed: a payment reduces what is owed.
        amountCents: -settled.amountCents,
        description: `${input.method.replace('_', ' ')} payment, receipt #${receiptNumber}`,
        paymentId: payment.id,
      },
    })

    // US-22 (B-048). Counter payments were posting to the ledger and nothing
    // else, so every invoice stayed open however much cash came across the
    // desk — the balance moved and the invoices did not, which is exactly the
    // split that makes autopay re-charge and AR ageing lie. Allocated here in
    // the same transaction as the payment.
    //
    // `status: 'succeeded'` is already set on a counter payment (money is in
    // hand), so the recompute counts it immediately.
    allocation.push(await applyPayment(tx, {
      id: payment.id,
      tenantId: input.tenantId,
      facilityId: input.facilityId,
      amountCents: settled.amountCents,
    }))

    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: input.facilityId,
        action: 'payment.recorded',
        entityType: 'Payment',
        entityId: payment.id,
        context: {
          method: input.method,
          amountCents: settled.amountCents,
          receiptNumber,
          leaseId: lease.id,
        },
      },
      tx,
    )

    return { paymentId: payment.id, receiptNumber }
  })

  // US-45's ~2-minute restore. A tenant who has just paid at the counter must
  // be able to reach their unit before they have walked back to the car —
  // waiting for the 4am pass is the version of this that generates a phone
  // call. Best-effort and outside the transaction: a gate controller being
  // unreachable must never roll back money already in the drawer.
  try {
    await restoreAccessIfSettled(input.tenantId, input.facilityId)
  } catch {
    // Swallowed deliberately; the nightly pass is the net.
  }

  return {
    ok: true,
    ...result,
    changeCents: settled.changeCents,
    allocation: allocation[0]?.summary ?? [],
    unappliedCents: allocation[0]?.unappliedCents ?? 0,
  }
}

export type DailySummaryRow = {
  paymentId: string
  receiptNumber: number | null
  method: string
  amountCents: number
  checkNumber: string | null
  receivedAt: Date
  tenantName: string
  staffName: string | null
}

export type DailySummary = {
  businessDate: string
  facilityName: string
  rows: DailySummaryRow[]
  totalsByMethod: { method: string; count: number; totalCents: number }[]
  totalCents: number
}

/// US-32's deposit slip: every payment taken on one facility-local day.
///
/// The window is computed in the facility's own timezone, not UTC — a payment
/// taken at 7pm in Austin belongs to that day's deposit, and a UTC day
/// boundary would file it under tomorrow.
export async function dailyPaymentsSummary(
  actor: Actor,
  facilityId: string,
  businessDate: string,
): Promise<DailySummary> {
  assertFacilityAccess(actor, facilityId)
  if (!can(actor, 'payments:take', facilityId) && !can(actor, 'reports:financial', facilityId)) {
    throw new ForbiddenError('Missing permission to read the day’s payments', 'payments:take', facilityId)
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { name: true, timezone: true },
  })

  const { start, end } = facilityDayBounds(businessDate, facility.timezone)

  const payments = await prisma.payment.findMany({
    where: {
      facilityId,
      status: { in: ['succeeded', 'partially_refunded', 'refunded'] },
      receivedAt: { gte: start, lt: end },
    },
    orderBy: { receivedAt: 'asc' },
    select: {
      id: true,
      receiptNumber: true,
      method: true,
      amountCents: true,
      checkNumber: true,
      receivedAt: true,
      tenant: { select: { firstName: true, lastName: true } },
      receivedByStaff: { select: { firstName: true, lastName: true } },
    },
  })

  const rows: DailySummaryRow[] = payments.map((payment) => ({
    paymentId: payment.id,
    receiptNumber: payment.receiptNumber,
    method: payment.method,
    amountCents: payment.amountCents,
    checkNumber: payment.checkNumber,
    receivedAt: payment.receivedAt,
    tenantName: `${payment.tenant.firstName} ${payment.tenant.lastName}`,
    staffName: payment.receivedByStaff
      ? `${payment.receivedByStaff.firstName} ${payment.receivedByStaff.lastName}`
      : null,
  }))

  const byMethod = new Map<string, { count: number; totalCents: number }>()
  for (const row of rows) {
    const current = byMethod.get(row.method) ?? { count: 0, totalCents: 0 }
    byMethod.set(row.method, { count: current.count + 1, totalCents: current.totalCents + row.amountCents })
  }

  return {
    businessDate,
    facilityName: facility.name,
    rows,
    totalsByMethod: [...byMethod.entries()]
      .map(([method, totals]) => ({ method, ...totals }))
      .sort((a, b) => a.method.localeCompare(b.method)),
    totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  }
}

/// The UTC instants bounding one facility-local calendar day.
///
/// Derived by asking Intl what the facility's offset actually was on that
/// date, rather than assuming a fixed one — the alternative silently files an
/// hour of payments under the wrong day twice a year.
export function facilityDayBounds(businessDate: string, timezone: string): { start: Date; end: Date } {
  const [year, month, day] = businessDate.split('-').map(Number)
  const guess = Date.UTC(year, month - 1, day)
  const offsetMs = timezoneOffsetMs(new Date(guess), timezone)
  const start = new Date(guess + offsetMs)
  // Recomputed from the day's real start so a DST transition inside the day
  // still lands on the following midnight rather than 23 or 25 hours later.
  const nextGuess = Date.UTC(year, month - 1, day + 1)
  const end = new Date(nextGuess + timezoneOffsetMs(new Date(nextGuess), timezone))
  return { start, end }
}

function timezoneOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return at.getTime() - asUtc
}
