import { prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { daysPastDue, outstandingCents } from '@storage/core/metrics'
import { ladderDecision, stepsFrom, type LadderHalt } from '@storage/core/billing'
import { effectsByLease } from '@/lib/admin/holds'
import { leasesWithSettlingPayment } from './allocation'

// PRD 05 CN-3 / CN-5 (B-052). Emitting the dunning ladder's day events.
//
// This module emits and nothing else. It does not render a message, choose a
// channel, or know what a template says — comms react to `delinquency.day_reached`
// through the ordinary rule pipeline (B-030), which is CN-3's own requirement
// that the ladder be driven by billing rather than by a comms-side calendar.
//
// ── At most once per invoice per step ────────────────────────────────────────
//
// CN-3's idempotency, and the record of what has been sent is the event log —
// the same approach B-043's scans and B-046's reminders use. Keyed on the
// ANCHOR INVOICE rather than the lease: the day count is measured from the
// oldest unpaid invoice's original due date (D-25), so that invoice is what the
// ladder is about. When it is finally paid and an older-but-newer one becomes
// the anchor, the ladder starts again for that invoice — which is right, and is
// what "per invoice per step" asks for.

type RecordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => void

export type DunningResult = {
  emitted: number
  halted: number
  /// PRD 05 FR-19 (B-075). Leases the ladder actually evaluated as due a
  /// step this run — reached past every halt/settled/no-anchor guard below,
  /// regardless of whether a step ended up emitting. Compared against
  /// `emitted` by the silent-failure detector: `eligible > 0 && emitted ===
  /// 0` is the one combination those guards cannot explain on their own,
  /// which is exactly FR-19's "a dunning run sends zero messages when
  /// delinquent tenants exist."
  eligible: number
}

const HALT_MESSAGE: Record<LadderHalt, string> = {
  settled: 'nothing outstanding',
  moved_out: 'the lease has ended',
  on_hold: 'the lease is on hold',
}

/// Runs the ladder for a facility on a business date.
export async function runDunning(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<DunningResult> {
  const result: DunningResult = { emitted: 0, halted: 0, eligible: 0 }

  // B-057. Where a facility has configured a delinquency timeline, that
  // timeline governs and this ladder stands down.
  //
  // Both would otherwise chase on day 1 — US-25's example timeline opens with
  // "Late: late fee #1, email reminder" and CN-3's default `dunningDays` starts
  // at 1 — and the tenant would get two emails for one missed payment. The
  // timeline is the more specific configuration and the one an operator
  // reviewed with a lawyer, so it wins.
  const configured = await prisma.delinquencyTimeline.findFirst({
    where: { facilityId, active: true },
    select: { id: true },
  })
  if (configured) {
    recordItem({
      itemId: facilityId,
      ok: true,
      message: 'dunning ladder stood down — a delinquency timeline governs this facility',
    })
    return result
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { dunningDays: true },
  })
  const steps = stepsFrom(facility.dunningDays)
  if (steps.length === 0) return result

  const leases = await prisma.lease.findMany({
    where: { facilityId },
    select: {
      id: true,
      status: true,
      invoices: {
        // Rent only, matching B-047 and B-098: a fee invoice is due the day it
        // is raised, and letting one anchor the ladder would send a day-1
        // chase for a late fee assessed this morning.
        where: { kind: 'rent' },
        select: { id: true, dueDate: true, totalCents: true, amountPaidCents: true },
      },
    },
  })
  if (leases.length === 0) return result

  // B-103. Chasing a tenant whose bank debit is still in transit is chasing
  // somebody who has paid.
  const settling = await leasesWithSettlingPayment(facilityId)

  const onHold = await effectsByLease(
    leases.map((lease) => lease.id),
    'halt_dunning',
    businessDate,
  )

  // Every step already emitted, in one query rather than one per lease.
  const sent = await prisma.domainEvent.findMany({
    where: {
      name: 'delinquency.day_reached',
      facilityId,
      entityId: { in: leases.map((lease) => lease.id) },
    },
    select: { entityId: true, payload: true },
  })
  const sentByInvoice = new Map<string, number[]>()
  for (const event of sent) {
    const payload = (event.payload ?? {}) as { invoiceId?: unknown; day?: unknown }
    const key = String(payload.invoiceId)
    sentByInvoice.set(key, [...(sentByInvoice.get(key) ?? []), Number(payload.day)])
  }

  for (const lease of leases) {
    const unpaid = lease.invoices.filter((invoice) => outstandingCents(invoice) > 0)
    // The anchor: the oldest unpaid invoice, which is what `daysPastDue`
    // measures from and therefore what the ladder is about.
    const anchor = unpaid.reduce<(typeof unpaid)[number] | null>(
      (oldest, invoice) => (!oldest || invoice.dueDate < oldest.dueDate ? invoice : oldest),
      null,
    )

    const decision = ladderDecision({
      daysPastDue: daysPastDue(lease.invoices, businessDate),
      outstandingCents: unpaid.reduce((sum, invoice) => sum + outstandingCents(invoice), 0),
      leaseEnded: !OCCUPYING_LEASE_STATUSES.includes(lease.status as never),
      // B-103 folds into the existing hold flag rather than adding a second
      // reason to the pure decision function: `dunningDecision` already knows
      // what "do not chase this lease today" means, and giving it a second way
      // to be told would be two code paths for one outcome. The job log below
      // still distinguishes them, which is where the difference matters.
      onHold: onHold.has(lease.id) || settling.has(lease.id),
      steps,
      alreadySent: anchor ? (sentByInvoice.get(anchor.id) ?? []) : [],
    })

    if (!decision.send) {
      if (decision.halt) {
        result.halted += 1
        // Only worth a line when there was something to halt — a lease with
        // nothing outstanding is the ordinary case and would drown the run.
        if (decision.halt !== 'settled') {
          recordItem({
            itemId: lease.id,
            ok: true,
            message: `dunning halted — ${HALT_MESSAGE[decision.halt]}`,
          })
        }
      }
      continue
    }
    if (!anchor) continue
    result.eligible += 1

    for (const step of decision.steps) {
      await emitEvent({
        name: 'delinquency.day_reached',
        entityType: 'Lease',
        entityId: lease.id,
        facilityId,
        payload: {
          // The idempotency key, read back on the next run.
          invoiceId: anchor.id,
          day: step.day,
          position: step.position,
          totalSteps: steps.length,
          outstandingCents: unpaid.reduce((sum, invoice) => sum + outstandingCents(invoice), 0),
        },
      })
      result.emitted += 1
      recordItem({
        itemId: lease.id,
        ok: true,
        message: `dunning step ${step.position} of ${steps.length} (day ${step.day})`,
      })
    }
  }

  return result
}
