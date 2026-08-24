import { prisma, type Prisma } from '@storage/db'

// PRD 02 §4.4 US-14 (transfer) / §4.6 US-25 (B-138, D-86). Where a lease's
// collections state lives after a transfer.
//
// D-86 moved the unpaid INVOICES onto the new lease, which is what keeps the
// balance, the aging buckets and `daysPastDue` correct with no reader changed.
// Two pieces of state are not invoices and deliberately did not move:
//
//   * `DelinquencyStepRun` — the evidence that a notice went out on a date,
//     against a lease that names a unit. Re-pointing it would make the record
//     of a served notice name a unit it never named, which is the one thing a
//     lien file cannot survive (D-63's rule, applied to our own rows).
//   * A PAID late-fee invoice, which records that step N of the fee ladder has
//     already been charged. It is settled history and belongs where it was
//     raised — but the ladder still has to know it happened, or the tenant is
//     charged step 1 through N a second time on the new lease.
//
// So both readers walk this link instead. Ancestors only: a lease's collections
// position depends on what came BEFORE it, never on a lease it was transferred
// into.

/// How many transfers back this will walk. A tenant downsizing twice while
/// behind is real; a hundred-lease chain is a data problem, and stopping is
/// better than looping. Nothing here writes, so the worst case of the cap being
/// hit is the oldest steps reading as unexecuted — the same behaviour as before
/// this file existed.
const MAX_HOPS = 10

/// For each lease id, its own id followed by every lease it was transferred out
/// of, oldest last. A lease that has never been transferred into maps to just
/// itself, which is what makes every caller's code identical either way.
export async function leaseChainIds(
  leaseIds: readonly string[],
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, string[]>> {
  const chains = new Map<string, string[]>(leaseIds.map((id) => [id, [id]]))
  // The frontier is keyed by the ORIGINATING lease so one query per hop serves
  // every chain at once, rather than one query per lease per hop.
  let frontier = new Map<string, string>(leaseIds.map((id) => [id, id]))

  for (let hop = 0; hop < MAX_HOPS && frontier.size > 0; hop += 1) {
    const rows = await client.lease.findMany({
      where: { id: { in: [...frontier.keys()] }, transferredFromLeaseId: { not: null } },
      select: { id: true, transferredFromLeaseId: true },
    })
    const next = new Map<string, string>()
    for (const row of rows) {
      const root = frontier.get(row.id)
      const parent = row.transferredFromLeaseId
      if (!root || !parent) continue
      // A cycle cannot happen through `completeTransfer` — the new lease is
      // created after the old one — but a hand-edited row must not hang a
      // nightly job.
      if (chains.get(root)?.includes(parent)) continue
      chains.get(root)?.push(parent)
      next.set(parent, root)
    }
    frontier = next
  }

  return chains
}

/// The ids in every chain, flattened and deduplicated — what a caller passes to
/// a single `in` query before mapping the rows back through the chains.
export function allChainIds(chains: Map<string, string[]>): string[] {
  return [...new Set([...chains.values()].flat())]
}

/// The same walk FORWARD: a lease's own id followed by every lease it was
/// later transferred into, newest last.
///
/// B-157 / D-85. The ancestor walk above serves a reader standing on the
/// tenant's CURRENT lease asking what came before it. An `AuctionCase` is the
/// opposite case: it stays pinned to the lease and unit the served notice
/// named — that anchoring is the whole evidentiary point and must not move —
/// so it is standing at the OLD end of the chain and has to look forward to
/// find where the money went.
///
/// Why it has to: D-86 re-points the unpaid invoices at the new lease, so
/// after a transfer the old lease's ledger nets to zero. A case reading only
/// its own lease therefore saw `outstandingCents: 0` and raised a
/// `balance_settled` blocker — "This lease owes nothing. There is no lien to
/// enforce." — on a tenant who still owed every cent. That is the lien clock
/// resetting, which is exactly what D-85 chose must not happen.
export async function leaseSuccessorIds(
  leaseIds: readonly string[],
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Map<string, string[]>> {
  const chains = new Map<string, string[]>(leaseIds.map((id) => [id, [id]]))
  let frontier = new Map<string, string>(leaseIds.map((id) => [id, id]))

  for (let hop = 0; hop < MAX_HOPS && frontier.size > 0; hop += 1) {
    const rows = await client.lease.findMany({
      where: { transferredFromLeaseId: { in: [...frontier.keys()] } },
      select: { id: true, transferredFromLeaseId: true },
    })
    const next = new Map<string, string>()
    for (const row of rows) {
      const parent = row.transferredFromLeaseId
      const root = parent ? frontier.get(parent) : undefined
      if (!root) continue
      if (chains.get(root)?.includes(row.id)) continue
      chains.get(root)?.push(row.id)
      next.set(row.id, root)
    }
    frontier = next
  }

  return chains
}
