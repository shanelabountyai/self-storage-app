import { prisma } from '@storage/db'
import { daysPastDue } from '@storage/core/metrics'
import { facilityTasks, type TaskRow } from './tasks'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.6 US-26 (B-059). "Today's due steps grouped by type (overlocks to
// apply/remove, notices to mail, proofs to record), so nothing is missed."
//
// US-41's AC is explicit that this is a filtered view of the one `Task` list,
// not a table of its own — so this reads `facilityTasks` and groups, rather
// than querying `Task` again.

const GROUPS = [
  { type: 'overlock_apply', heading: 'Overlocks to apply' },
  { type: 'overlock_remove', heading: 'Overlocks to remove' },
  { type: 'delinquency_step', heading: 'Notices to mail, proofs to record' },
] as const

/// B-115 (UX review 2026-08-12, finding 9). Balance and days past due — the
/// figure this queue exists for, and the one it omitted. Every group here
/// filters to a Lease-entityType task (see GROUPS above), so `task.entityId`
/// is a lease id throughout; nothing here re-derives that, it relies on it.
export type DelinquencyTaskRow = TaskRow & { balanceCents: number; daysPastDue: number }
export type DelinquencyQueueGroup = { type: string; heading: string; tasks: DelinquencyTaskRow[] }

export async function delinquencyQueue(actor: Actor, facilityId: string): Promise<DelinquencyQueueGroup[]> {
  const tasks = await facilityTasks(actor, facilityId)
  const grouped = GROUPS.map((group) => ({
    ...group,
    tasks: tasks.filter((task) => task.type === group.type),
  })).filter((group) => group.tasks.length > 0)

  const leaseIds = [...new Set(grouped.flatMap((group) => group.tasks.map((task) => task.entityId)))]
  if (leaseIds.length === 0) return grouped as DelinquencyQueueGroup[]

  // Same two-query shape as `tenant-list.ts`: a ledger sum and an invoice age
  // are not columns, so they cost one batched query each rather than one per
  // row. `daysPastDue` reads from `@storage/core/metrics` (D-25) — the same
  // definition the dashboard tile and the delinquency report use — not
  // recomputed here, so a lease cannot read as current on one screen and late
  // on another.
  const [balances, leases] = await Promise.all([
    prisma.ledgerEntry.groupBy({
      by: ['leaseId'],
      where: { leaseId: { in: leaseIds } },
      _sum: { amountCents: true },
    }),
    prisma.lease.findMany({
      where: { id: { in: leaseIds } },
      select: { id: true, invoices: { select: { dueDate: true, totalCents: true, amountPaidCents: true } } },
    }),
  ])
  const balanceByLease = new Map(balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))
  const now = new Date()
  const agingByLease = new Map(leases.map((lease) => [lease.id, daysPastDue(lease.invoices, now)]))

  return grouped.map((group) => ({
    ...group,
    tasks: group.tasks.map((task) => ({
      ...task,
      balanceCents: balanceByLease.get(task.entityId) ?? 0,
      daysPastDue: agingByLease.get(task.entityId) ?? 0,
    })),
  }))
}
