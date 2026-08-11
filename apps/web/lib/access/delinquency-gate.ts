import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { describeRestore, describeSuspension, gateDecision } from '@storage/core/access'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { daysPastDue } from '@storage/core/metrics'
import { effectsByLease } from '@/lib/admin/holds'
import { transitionGrant } from '@/lib/access/service'

// PRD 02 §4.6 US-45, decided as D-16 (B-098). Suspending gate access for
// non-payment, and restoring it the moment the balance clears.
//
// ── Why this is evaluated per TENANT, not per lease ──────────────────────────
//
// `AccessGrant` is one row per (facility, tenant) by PRD 03 FR-1's design, and
// that matches the physical reality: a shared gate either opens for someone or
// it does not, and there is no way to admit them for unit A while refusing unit
// B. So the decision is made on everything that tenant owes at that facility —
// the highest day count across their leases, and the sum of their balances.
//
// The alternative, suspending on any one delinquent lease, would lock a tenant
// out of a unit they had paid for. The alternative in the other direction,
// requiring every lease to be delinquent, would let a tenant keep the gate open
// indefinitely by keeping one cheap unit current.
//
// ── The restore SLA ─────────────────────────────────────────────────────────
//
// US-45 wants restore "within ~2 minutes of a qualifying payment, with no staff
// action". The nightly job cannot do that, so it is not what does: restore is
// called directly from the paths that settle money — the Stripe webhook and the
// counter payment — and runs in the same request. The nightly pass is a safety
// net for a balance that reached zero some other way (a credit, a waiver, a
// write-off), not the mechanism.

type RecordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => void

export type GateOutcome = { suspended: number; restored: number; unchanged: number }

type TenantState = {
  tenantId: string
  leaseIds: string[]
  daysPastDue: number
  balanceCents: number
  onHold: boolean
}

/// What every tenant at a facility owes, and how late they are.
async function tenantStates(facilityId: string, asOf: Date): Promise<TenantState[]> {
  const leases = await prisma.lease.findMany({
    where: { facilityId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: {
      id: true,
      tenantId: true,
      invoices: {
        // Rent invoices only for the AGE, matching B-047: a fee invoice is not
        // what a tenant is "days past due" on, and letting one drive the clock
        // would suspend access over a $20 fee raised this morning.
        where: { kind: 'rent' },
        select: { dueDate: true, totalCents: true, amountPaidCents: true },
      },
    },
  })
  if (leases.length === 0) return []

  const [balances, held] = await Promise.all([
    prisma.ledgerEntry.groupBy({
      by: ['leaseId'],
      where: { leaseId: { in: leases.map((lease) => lease.id) } },
      _sum: { amountCents: true },
    }),
    effectsByLease(leases.map((lease) => lease.id), 'halt_access_suspension', asOf),
  ])
  const balanceByLease = new Map(balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))

  const byTenant = new Map<string, TenantState>()
  for (const lease of leases) {
    const state = byTenant.get(lease.tenantId) ?? {
      tenantId: lease.tenantId,
      leaseIds: [],
      daysPastDue: 0,
      balanceCents: 0,
      onHold: false,
    }
    state.leaseIds.push(lease.id)
    // The HIGHEST day count across their leases here — a tenant is as late as
    // their latest unit.
    state.daysPastDue = Math.max(state.daysPastDue, daysPastDue(lease.invoices, asOf))
    state.balanceCents += balanceByLease.get(lease.id) ?? 0
    // A hold on ANY lease blocks suspension for the whole grant, because the
    // grant cannot be partially suspended. The safe direction.
    if (held.has(lease.id)) state.onHold = true
    byTenant.set(lease.tenantId, state)
  }
  return [...byTenant.values()]
}

/// Applies the rule to every tenant at a facility. The nightly pass.
export async function evaluateAccessSuspensions(
  facilityId: string,
  asOf: Date,
  recordItem: RecordItem,
): Promise<GateOutcome> {
  const outcome: GateOutcome = { suspended: 0, restored: 0, unchanged: 0 }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { accessSuspendDaysPastDue: true, accessRestoreAtOrBelowCents: true },
  })

  const states = await tenantStates(facilityId, asOf)
  if (states.length === 0) return outcome

  const grants = await prisma.accessGrant.findMany({
    where: { facilityId, tenantId: { in: states.map((state) => state.tenantId) } },
    select: { id: true, tenantId: true, state: true },
  })
  const grantByTenant = new Map(grants.map((grant) => [grant.tenantId!, grant]))

  // B-103. Tenants with a bank debit accepted but not yet settled. Cutting
  // somebody's gate access over money that has already left their account —
  // and that nothing they can do makes arrive faster — is the version of D-16
  // that ends in a complaint nobody can defend. Restoring is untouched: that
  // still needs the balance actually at zero, which unsettled money is not.
  const settlingTenants = await settlingTenantIds(facilityId)

  for (const state of states) {
    const grant = grantByTenant.get(state.tenantId)
    if (!grant) continue

    if (settlingTenants.has(state.tenantId) && grant.state !== 'suspended') {
      outcome.unchanged += 1
      recordItem({
        itemId: state.tenantId,
        ok: true,
        message: 'access suspension blocked — a bank payment is still settling',
      })
      continue
    }

    const decision = gateDecision({
      state: grant.state,
      daysPastDue: state.daysPastDue,
      balanceCents: state.balanceCents,
      suspendAtDays: facility.accessSuspendDaysPastDue,
      restoreAtOrBelowCents: facility.accessRestoreAtOrBelowCents,
      onHold: state.onHold,
    })

    if (decision.action === 'suspend') {
      await applySuspend(facilityId, grant.id, state, asOf)
      outcome.suspended += 1
      recordItem({
        itemId: state.tenantId,
        ok: true,
        message: describeSuspension(state.daysPastDue, asOf),
      })
    } else if (decision.action === 'restore') {
      await applyRestore(facilityId, grant.id, state.tenantId, state.leaseIds[0] ?? null, asOf)
      outcome.restored += 1
      recordItem({ itemId: state.tenantId, ok: true, message: describeRestore(asOf) })
    } else {
      outcome.unchanged += 1
      if (decision.reason === 'on_hold') {
        // Worth a line on the Billing Runs screen: a tenant who would have been
        // suspended and was not is exactly what an operator should be able to
        // see without asking.
        recordItem({
          itemId: state.tenantId,
          ok: true,
          message: 'access suspension blocked — lease is on hold',
        })
      }
    }
  }

  return outcome
}

/// US-45's ~2-minute restore, called inline from whichever path settled the
/// money rather than waiting for a nightly pass.
///
/// Safe to call on every payment: a grant that is not suspended produces no
/// transition, and `transitionGrant` treats a same-state move as a quiet no-op
/// rather than a second command to the hardware.
export async function restoreAccessIfSettled(
  tenantId: string,
  facilityId: string,
  asOf: Date = new Date(),
): Promise<boolean> {
  const grant = await prisma.accessGrant.findFirst({
    where: { facilityId, tenantId },
    select: { id: true, state: true },
  })
  if (!grant || grant.state !== 'suspended') return false

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { accessSuspendDaysPastDue: true, accessRestoreAtOrBelowCents: true },
  })
  const state = (await tenantStates(facilityId, asOf)).find((row) => row.tenantId === tenantId)
  if (!state) return false

  const decision = gateDecision({
    state: grant.state,
    daysPastDue: state.daysPastDue,
    balanceCents: state.balanceCents,
    suspendAtDays: facility.accessSuspendDaysPastDue,
    restoreAtOrBelowCents: facility.accessRestoreAtOrBelowCents,
    onHold: state.onHold,
  })
  if (decision.action !== 'restore') return false

  await applyRestore(facilityId, grant.id, tenantId, state.leaseIds[0] ?? null, asOf)
  return true
}

async function applySuspend(
  facilityId: string,
  grantId: string,
  state: TenantState,
  asOf: Date,
): Promise<void> {
  // The invoice that put them over — US-45 wants it named in the audit entry,
  // because "why was I locked out" has to be answerable from the record.
  const trigger = await prisma.invoice.findFirst({
    where: { leaseId: { in: state.leaseIds }, kind: 'rent', status: { in: ['open', 'partially_paid'] } },
    orderBy: { dueDate: 'asc' },
    select: { id: true, number: true, dueDate: true },
  })

  await transitionGrant(grantId, 'suspended', 'system:delinquency')

  await recordAudit({
    actor: { type: 'system', label: 'delinquency access rule' },
    action: 'access.suspended',
    entityType: 'AccessGrant',
    entityId: grantId,
    facilityId,
    reasonCode: 'collections_uneconomic',
    context: {
      tenantId: state.tenantId,
      daysPastDue: state.daysPastDue,
      balanceCents: state.balanceCents,
      triggeringInvoiceId: trigger?.id ?? null,
      triggeringInvoiceNumber: trigger?.number ?? null,
      summary: describeSuspension(state.daysPastDue, asOf),
    },
  })

  // No event emitted here on purpose: `transitionGrant` already emits
  // `access.suspended` for this transition, and a second one would notify the
  // tenant twice. The day count the notice needs is recomputed at send time
  // (FR-18) rather than carried on the event.
}

async function applyRestore(
  facilityId: string,
  grantId: string,
  tenantId: string,
  _leaseId: string | null,
  asOf: Date,
): Promise<void> {
  await transitionGrant(grantId, 'active', 'system:delinquency_cleared')

  await recordAudit({
    actor: { type: 'system', label: 'delinquency access rule' },
    action: 'access.restored',
    entityType: 'AccessGrant',
    entityId: grantId,
    facilityId,
    reasonCode: 'legal_requirement',
    context: { tenantId, summary: describeRestore(asOf) },
  })

  // As above: `transitionGrant` emits `access.restored` for this transition.
}

/// Tenants at this facility with a bank debit in flight (B-103).
///
/// Deliberately its own small query rather than reusing
/// `leasesWithSettlingPayment`: the gate is scoped per TENANT (one grant per
/// credential holder per facility, PRD 03 FR-1), and mapping to leases and back
/// would be two joins to answer a question about a person.
async function settlingTenantIds(facilityId: string): Promise<Set<string>> {
  const rows = await prisma.payment.findMany({
    where: { facilityId, status: 'processing' },
    select: { tenantId: true },
    distinct: ['tenantId'],
  })
  return new Set(rows.map((row) => row.tenantId))
}
