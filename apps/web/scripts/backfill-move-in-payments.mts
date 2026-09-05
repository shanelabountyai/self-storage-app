import { prisma } from '@storage/db'
import { postMoveInPaymentToLedger } from '../lib/payments/reconcile.ts'

// Usage: npm run db:backfill:move-in-payments [-- --apply]
//
// B-255. Every lease created by a web move-in before that fix carries a phantom
// balance: `openingLedger` wrote the charge, and the payment that cleared it
// was never posted, because provisioning ran after the transaction that would
// have posted it. The arrears reports, the delinquency ladder and any statement
// a tenant has been shown all read that balance.
//
// Deliberately NOT guarded by `assertDevDatabase` — the leases that need this
// are in production. The guard is that it prints and changes nothing until
// `--apply`, and that it only ever matches on an exact amount.
//
// What it will not touch: a lease whose ledger already holds a payment entry, a
// group whose outstanding move-in charges match no single succeeded payment,
// and any payment already posted anywhere. A move-in whose renter has since
// paid an invoice is out of scope by that first rule, and is better repaired by
// a person than by an amount match.

export type BackfillPlan = {
  tenantId: string
  facilityId: string
  leaseIds: string[]
  totalCents: number
  /// The one succeeded payment of exactly this amount with nothing posted from
  /// it, or null when there is no such payment or more than one.
  payment: { id: string; facilityId: string; amountCents: number } | null
  candidates: number
}

/// Works out what needs posting and matches it to money that was actually
/// taken. Separated from `main` so it can be tested: it is the half that
/// decides where money moves, and the printing is not.
export async function planMoveInBackfill(): Promise<BackfillPlan[]> {
  // Leases opened with a move-in charge and never credited with anything.
  const charges = await prisma.ledgerEntry.findMany({
    where: { type: 'charge', description: 'Move-in charges' },
    select: { leaseId: true, facilityId: true, amountCents: true, lease: { select: { tenantId: true } } },
  })
  const credited = new Set(
    (
      await prisma.ledgerEntry.findMany({
        where: { type: 'payment', leaseId: { in: charges.map((entry) => entry.leaseId) } },
        select: { leaseId: true },
        distinct: ['leaseId'],
      })
    ).map((entry) => entry.leaseId),
  )

  // Grouped by who paid and where: a basket's charges are split across leases,
  // so the payment to look for is the sum of the group, not of one lease.
  const groups = new Map<
    string,
    { tenantId: string; facilityId: string; leaseIds: string[]; totalCents: number }
  >()
  for (const entry of charges) {
    if (credited.has(entry.leaseId)) continue
    const key = `${entry.lease.tenantId}:${entry.facilityId}`
    const group = groups.get(key) ?? {
      tenantId: entry.lease.tenantId,
      facilityId: entry.facilityId,
      leaseIds: [],
      totalCents: 0,
    }
    group.leaseIds.push(entry.leaseId)
    group.totalCents += entry.amountCents
    groups.set(key, group)
  }

  const plans: BackfillPlan[] = []
  for (const group of groups.values()) {
    const candidates = await prisma.payment.findMany({
      where: {
        tenantId: group.tenantId,
        facilityId: group.facilityId,
        status: 'succeeded',
        amountCents: group.totalCents,
        refundOfPaymentId: null,
        ledgerEntries: { none: { type: 'payment' } },
      },
      select: { id: true, facilityId: true, amountCents: true, receivedAt: true },
      orderBy: { receivedAt: 'asc' },
    })

    // Exactly one, or it is ambiguous. Two payments of the same amount from the
    // same tenant at the same facility is a person's problem, not a script's:
    // crediting the wrong one is money moved on a guess.
    plans.push({
      ...group,
      payment: candidates.length === 1 ? candidates[0] : null,
      candidates: candidates.length,
    })
  }
  return plans
}

async function main() {
  const apply = process.argv.includes('--apply')
  const plans = await planMoveInBackfill()

  for (const plan of plans) {
    if (!plan.payment) {
      console.log(
        `SKIP  tenant=${plan.tenantId} facility=${plan.facilityId} owed=${plan.totalCents} leases=${plan.leaseIds.length} candidates=${plan.candidates}`,
      )
      continue
    }
    console.log(
      `${apply ? 'POST ' : 'WOULD'} payment=${plan.payment.id} amount=${plan.payment.amountCents} leases=${plan.leaseIds.join(',')}`,
    )
    if (apply) await postMoveInPaymentToLedger(plan.payment, plan.leaseIds)
  }

  const posted = plans.filter((plan) => plan.payment).length
  console.log(
    `\n${apply ? 'Posted' : 'Would post'} ${posted}; skipped ${plans.length - posted} needing a person.`,
  )
  if (!apply) console.log('Nothing was written. Re-run with --apply.')
  await prisma.$disconnect()
}

// Only when run as a script. A test importing `planMoveInBackfill` must not
// set the whole thing going as a side effect of the import.
if (process.argv[1]?.endsWith('backfill-move-in-payments.mts')) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
