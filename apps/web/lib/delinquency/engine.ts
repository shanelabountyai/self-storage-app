import { prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { currentStage, evaluate, type TimelineStep,
  isOverlockStep,
} from '@storage/core/delinquency'
import { daysPastDue, outstandingCents } from '@storage/core/metrics'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { effectsByLease } from '@/lib/admin/holds'
import { activeTimeline } from '@/lib/admin/delinquency-timeline'
import { createTask } from '@/lib/admin/tasks'
import { allChainIds, leaseChainIds } from '@/lib/billing/transfer-chain'
import { restoreAccessIfSettled } from '@/lib/access/delinquency-gate'
import { transitionGrant } from '@/lib/access/service'
import { releaseOverlock, requestOverlock } from '@/lib/delinquency/overlock'
import { openAuctionCase } from '@/lib/auctions/service'

// PRD 02 FR-5 (B-057). The nightly delinquency run.
//
// "Evaluates each delinquent lease against its facility timeline version
// nightly; executes automated actions, queues staff tasks, emits gate-access
// events."
//
// Three things this deliberately does NOT do, each because something else
// already owns it and two owners of one behaviour is how a tenant gets charged
// twice or told twice:
//
//   * **Access suspension** is B-098's rule, called through it rather than
//     reimplemented — the backlog line says so in as many words. A step naming
//     `suspend_access` reaches the same `transitionGrant` the threshold rule
//     uses, so there is one path to a suspended gate.
//   * **Late fees** are B-047's ladder. A step naming `assess_late_fee` is the
//     TRIGGER; the amount and the schedule stay with the fee ladder, which has
//     its own configurable steps and its own idempotency. Assessing here as
//     well would charge the same lease twice for one day.
//   * **The CN-3 dunning ladder** stands down for any facility with an active
//     timeline (see `runDunning`'s own guard). Both would otherwise send on
//     day 1.

export type RecordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => void

export type DelinquencyRunResult = {
  advanced: number
  stepsExecuted: number
  cured: number
  halted: number
  /// Facilities with no configured timeline do nothing at all, and say so once
  /// rather than per lease.
  skippedNoTimeline: boolean
}

export async function runDelinquencyTimeline(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<DelinquencyRunResult> {
  const result: DelinquencyRunResult = {
    advanced: 0,
    stepsExecuted: 0,
    cured: 0,
    halted: 0,
    skippedNoTimeline: false,
  }

  const timeline = await activeTimeline(facilityId)
  if (!timeline) {
    // B-056's rule, honoured here: a system that has not been told what this
    // state requires runs no lien pipeline. Recorded so the Billing Runs screen
    // shows a deliberate no-op rather than silence.
    result.skippedNoTimeline = true
    recordItem({
      itemId: facilityId,
      ok: true,
      message: 'no delinquency timeline configured — nothing ran',
    })
    return result
  }

  const leases = await prisma.lease.findMany({
    where: { facilityId },
    select: {
      id: true,
      status: true,
      tenantId: true,
      delinquencyTimelineId: true,
      invoices: {
        // Rent only, matching B-047, B-052 and B-098: a fee invoice is due the
        // day it is raised, and letting one anchor the clock would fire a day-1
        // step for a late fee assessed this morning.
        where: { kind: 'rent' },
        select: { dueDate: true, totalCents: true, amountPaidCents: true },
      },
    },
  })
  if (leases.length === 0) return result

  const leaseIds = leases.map((lease) => lease.id)
  const onHold = await effectsByLease(leaseIds, 'halt_dunning', businessDate)

  // Open episode only. Superseded rows are kept as evidence (US-28) but must
  // not count as executed, or a tenant who cured and fell behind again would
  // resume at day 30 instead of starting over.
  //
  // B-138: read along the transfer chain, not just this lease. D-86 moved the
  // unpaid invoices onto the new lease, so a transferred tenant arrives here
  // with the full `daysPastDue` — and with no step runs of their own, which
  // would restart the ladder at day 1 and send the whole sequence of notices
  // again. The runs stay on the lease they were served against (see
  // `transfer-chain.ts` for why re-pointing them is the wrong answer); the
  // ladder's POSITION is read across the chain.
  const chains = await leaseChainIds(leaseIds)
  const runs = await prisma.delinquencyStepRun.findMany({
    where: { leaseId: { in: allChainIds(chains) }, supersededAt: null },
    select: { leaseId: true, dayOffset: true, businessDate: true },
  })
  const daysByRunLease = new Map<string, number[]>()
  // B-161. Which leases have already had a step tonight, read chain-wide for
  // the same reason the positions are: two runs of the nightly job in one
  // evening must not walk the ladder two rungs.
  const ranToday = new Set<string>()
  for (const run of runs) {
    daysByRunLease.set(run.leaseId, [...(daysByRunLease.get(run.leaseId) ?? []), run.dayOffset])
    // Compared as calendar days, not instants: the column is a `date` and
    // comes back at UTC midnight, while the caller's business date need not.
    if (run.businessDate.toISOString().slice(0, 10) === businessDate.toISOString().slice(0, 10)) {
      ranToday.add(run.leaseId)
    }
  }
  const executedByLease = new Map<string, number[]>()
  for (const [leaseId, chain] of chains) {
    const days = new Set(chain.flatMap((id) => daysByRunLease.get(id) ?? []))
    if (days.size > 0) executedByLease.set(leaseId, [...days])
  }

  // The ledger balance per lease, in one query. `qualifyingAmount` decides what
  // counts as paid: everything owed, or rent only with fees allowed to stand.
  const balances = await prisma.ledgerEntry.groupBy({
    by: ['leaseId'],
    where: { leaseId: { in: leaseIds } },
    _sum: { amountCents: true },
  })
  const balanceByLease = new Map(balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]))

  const gracedLeases = await reversalGracedLeases(
    facilityId,
    leaseIds,
    businessDate,
    timeline.reversalGraceDays,
  )

  const steps = timeline.steps

  for (const lease of leases) {
    const executedDays = executedByLease.get(lease.id) ?? []

    const rentOutstanding = lease.invoices.reduce(
      (sum, invoice) => sum + outstandingCents(invoice),
      0,
    )
    const qualifyingOutstandingCents =
      timeline.qualifyingAmount === 'rent_only'
        ? rentOutstanding
        : Math.max(0, balanceByLease.get(lease.id) ?? 0)

    const decision = evaluate({
      steps,
      daysPastDue: daysPastDue(lease.invoices, businessDate),
      qualifyingOutstandingCents,
      leaseEnded: !OCCUPYING_LEASE_STATUSES.includes(lease.status as never),
      onHold: onHold.has(lease.id),
      executedDays,
      executedToday: (chains.get(lease.id) ?? [lease.id]).some((id) => ranToday.has(id)),
      reversalGrace: gracedLeases.has(lease.id),
    })

    if (!decision.act) {
      if (decision.halt === 'cured' && executedDays.length > 0) {
        await cure(
          { ...lease, chainIds: chains.get(lease.id) ?? [lease.id] },
          facilityId,
          steps,
          executedDays,
          recordItem,
        )
        result.cured += 1
      } else if (decision.halt && decision.halt !== 'cured') {
        result.halted += 1
        if (decision.halt === 'reversal_grace') {
          // Said out loud on the Billing Runs screen. A pipeline that has
          // stopped for a reason nobody can see is indistinguishable from one
          // that is broken, and this one stops for days at a time.
          recordItem({
            itemId: lease.id,
            ok: true,
            message: 'ladder held — a returned payment is still being settled',
          })
        }
      }

      // B-151's backstop. The three paths that end a lease each release the
      // lock in their own transaction now, so this is not the fix — it is what
      // catches the locks ALREADY stuck on leases that ended before that
      // shipped, and any future fourth way to end a lease that forgets to.
      // `releaseOverlock` is idempotent and returns immediately when there is
      // no live lock, which is every lease here on every other night.
      if (!OCCUPYING_LEASE_STATUSES.includes(lease.status as never)) {
        await releaseOverlock({ leaseId: lease.id, facilityId })
      }
      continue
    }

    // US-25's AC: "the lease records which timeline version governed it."
    // Pinned on the FIRST step, not at move-in — a lease that never goes past
    // due is governed by nothing, and pinning early would freeze a
    // configuration a tenant may never encounter.
    if (!lease.delinquencyTimelineId) {
      await prisma.lease.update({
        where: { id: lease.id },
        data: { delinquencyTimelineId: timeline.id },
      })
    }

    const before = currentStage(steps, executedDays)

    for (const step of decision.steps) {
      const executed = await executeStep({
        step,
        lease,
        facilityId,
        timelineId: lease.delinquencyTimelineId ?? timeline.id,
        businessDate,
        outstandingCents: qualifyingOutstandingCents,
        daysPastDue: daysPastDue(lease.invoices, businessDate),
      })
      if (executed) {
        result.stepsExecuted += 1
        recordItem({
          itemId: lease.id,
          ok: true,
          message: `day ${step.dayOffset}: ${step.label}`,
        })
      }
    }

    const after = currentStage(steps, [...executedDays, ...decision.steps.map((s) => s.dayOffset)])
    if (after && after.dayOffset !== before?.dayOffset) {
      await emitEvent({
        name: 'delinquency.stage_changed',
        entityType: 'Lease',
        entityId: lease.id,
        facilityId,
        payload: {
          from: before?.label ?? null,
          to: after.label,
          dayOffset: after.dayOffset,
          timelineId: timeline.id,
          timelineVersion: timeline.version,
        },
      })
    }

    result.advanced += 1
  }

  return result
}

/// B-161 / D-92. Leases whose ladder must not move tonight because a payment
/// came back.
///
/// Two gates, and a lease needs only one of them:
///
///   * **The grace window.** `returnPayment` re-opens the invoices at their
///     ORIGINAL due date (D-25, and correct — the money never arrived), so a
///     reversal on a 90-day-old invoice puts the tenant back at full age the
///     instant the bank claws it back. They are holding a receipt and a cure
///     confirmation. `reversalGraceDays` is how long they get to make it right
///     before the ladder is allowed to move again.
///   * **An open `settling_payment_failed` task.** While staff are still
///     working the bounce there is a person in the loop, and the whole point of
///     that queue is that somebody rings the tenant before a notice does.
///
/// A payment that was later REINSTATED (B-147's won dispute) is `succeeded`
/// again, which is why the filter is on the payment's status rather than on the
/// reversal entry alone — the entry stays for ever, the gate must not.
async function reversalGracedLeases(
  facilityId: string,
  leaseIds: string[],
  businessDate: Date,
  graceDays: number,
): Promise<Set<string>> {
  const reversals = await prisma.ledgerEntry.findMany({
    where: {
      leaseId: { in: leaseIds },
      type: 'adjustment',
      reversalOfId: { not: null },
      payment: { status: 'returned' },
    },
    select: { leaseId: true, paymentId: true, occurredAt: true },
  })
  if (reversals.length === 0) return new Set()

  const graced = new Set<string>()
  const graceMs = graceDays * 24 * 60 * 60 * 1000
  const stillOpen: typeof reversals = []
  for (const reversal of reversals) {
    if (businessDate.getTime() - reversal.occurredAt.getTime() < graceMs) graced.add(reversal.leaseId)
    else stillOpen.push(reversal)
  }
  if (stillOpen.length === 0) return graced

  // Only the ones the window no longer covers need the task lookup.
  const openTasks = await prisma.task.findMany({
    where: {
      facilityId,
      type: 'settling_payment_failed',
      status: 'open',
      entityId: { in: [...new Set(stillOpen.map((row) => row.paymentId!))] },
    },
    select: { entityId: true },
  })
  const openPaymentIds = new Set(openTasks.map((task) => task.entityId))
  for (const reversal of stillOpen) {
    if (openPaymentIds.has(reversal.paymentId!)) graced.add(reversal.leaseId)
  }
  return graced
}

/// Runs one step, or returns false if another run got there first.
async function executeStep(input: {
  step: TimelineStep
  lease: { id: string; tenantId: string }
  facilityId: string
  timelineId: string
  businessDate: Date
  outstandingCents: number
  daysPastDue: number
}): Promise<boolean> {
  const { step, lease, facilityId } = input
  const done: string[] = []
  const skipped: string[] = []

  // Claim the step FIRST. The unique constraint on (leaseId, dayOffset) is what
  // makes two concurrent runs — or a re-run of tonight — produce one execution;
  // claiming after the side effects would send the notice twice and record it
  // once.
  let runId: string
  try {
    const run = await prisma.delinquencyStepRun.create({
      data: {
        leaseId: lease.id,
        facilityId,
        timelineId: input.timelineId,
        dayOffset: step.dayOffset,
        label: step.label,
        businessDate: input.businessDate,
      },
      select: { id: true },
    })
    runId = run.id
  } catch {
    return false
  }

  for (const action of step.automatedActions) {
    switch (action) {
      case 'send_notice':
        if (!step.noticeTemplateKey) {
          // B-056 refuses to save this, so it can only appear on a timeline
          // saved before that validation existed. Recorded rather than
          // silently skipped: a notice nobody sent is the thing a lien file
          // cannot survive.
          skipped.push('send_notice: no template on the step')
          break
        }
        await emitEvent({
          name: 'delinquency.day_reached',
          entityType: 'Lease',
          entityId: lease.id,
          facilityId,
          payload: {
            day: step.dayOffset,
            label: step.label,
            templateKey: step.noticeTemplateKey,
            deliveryMethods: step.deliveryMethods,
            outstandingCents: input.outstandingCents,
            daysPastDue: input.daysPastDue,
          },
        })
        done.push('send_notice')
        break

      case 'suspend_access':
        // B-098's machinery, not a second implementation. Best-effort and
        // outside any money transaction, exactly as B-098 does it: a gate
        // controller being unreachable must never stop the pipeline.
        try {
          const grant = await prisma.accessGrant.findFirst({
            where: { facilityId, tenantId: lease.tenantId },
            select: { id: true, state: true },
          })
          if (grant && grant.state === 'active') {
            // The SAME cause B-098's threshold rule uses, not a new one.
            // "Inherits the access rule" means a suspended gate looks identical
            // however it was reached — the tenant profile's access banner, the
            // audit entry and the restore path all key off this.
            await transitionGrant(grant.id, 'suspended', 'system:delinquency')
            done.push('suspend_access')
          } else {
            skipped.push('suspend_access: no active grant')
          }
        } catch (error) {
          skipped.push(`suspend_access: ${(error as Error).message.slice(0, 120)}`)
        }
        break

      case 'restore_access':
        try {
          await restoreAccessIfSettled(lease.tenantId, facilityId, input.businessDate)
          done.push('restore_access')
        } catch {
          skipped.push('restore_access: failed')
        }
        break

      case 'assess_late_fee':
        // Deliberately delegated. B-047's ladder owns the amount, the schedule
        // and its own idempotency; assessing here as well would charge one
        // lease twice for one day. Recorded so the history does not read as
        // though this step did nothing.
        skipped.push('assess_late_fee: delegated to the late-fee ladder (B-047)')
        break

      case 'flag_auction_eligible':
        await prisma.lease.updateMany({
          where: { id: lease.id, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
          data: { status: 'pending_auction' },
        })
        // B-062. Opens the case the pipeline screen works from. Idempotent via
        // the partial unique index, so a re-run does not open a second — and
        // opening one grants nothing: every readiness rule still has to pass
        // before a sale can be scheduled.
        await openAuctionCase({ leaseId: lease.id, facilityId })
        done.push('flag_auction_eligible')
        break
    }
  }

  let taskId: string | null = null
  if (step.staffTaskLabel) {
    // B-058. An overlock step raises the TYPED task, which carries a required
    // photo and creates the `UnitOverlock` record that makes the unit read as
    // `overlocked`. Recognised by the step's label because that is what an
    // operator configures — the alternative is a seventh automated action that
    // duplicates a staff task.
    if (isOverlockStep(step)) {
      const requested = await requestOverlock({
        leaseId: lease.id,
        facilityId,
        reason: step.label,
        businessDate: input.businessDate,
      })
      if (requested) {
        taskId = requested.taskId
        done.push('request_overlock')
      } else {
        // Already locked, or already asked for. AC4's idempotency.
        skipped.push('request_overlock: a live overlock already exists')
      }
    } else {
      const task = await createTask({
        facilityId,
        type: 'delinquency_step',
        entityType: 'Lease',
        entityId: lease.id,
        at: input.businessDate,
        priority: 'high',
      })
      taskId = task.id
    }
  }

  await prisma.delinquencyStepRun.update({
    where: { id: runId },
    data: { taskId, outcome: { actions: done, skipped } },
  })

  return true
}

/// US-25's AC: "Paying the qualifying amount automatically halts the pipeline,
/// restores gate access, and queues overlock removal."
async function cure(
  lease: { id: string; tenantId: string; chainIds: readonly string[] },
  facilityId: string,
  steps: readonly TimelineStep[],
  executedDays: readonly number[],
  recordItem: RecordItem,
): Promise<void> {
  const stage = currentStage(steps, executedDays)

  // Restore through B-098's own function, which checks the balance itself and
  // is a no-op when there is nothing to restore.
  await restoreAccessIfSettled(lease.tenantId, facilityId).catch(() => undefined)

  // Open staff tasks from steps that no longer apply. Cancelled rather than
  // completed: nobody did them, and marking them done would put a proof-less
  // "completed" in the history an auction is defended from.
  // Across the chain (B-138): a step task raised before a transfer is a task
  // about arrears the tenant has now settled, and leaving it open would have
  // staff chasing somebody who has paid.
  await prisma.task.updateMany({
    where: {
      facilityId,
      type: 'delinquency_step',
      entityId: { in: [...lease.chainIds] },
      status: 'open',
    },
    data: { status: 'cancelled' },
  })

  // US-25's "queues overlock removal". `releaseOverlock` decides between a
  // removal task and a silent withdrawal: a lock that was asked for but never
  // fitted is closed out rather than generating a trip to a unit for nothing.
  const released = await releaseOverlock({ leaseId: lease.id, facilityId })
  if (released.taskId) {
    recordItem({ itemId: lease.id, ok: true, message: 'overlock removal queued' })
  }

  // The pin is cleared so a future delinquency is governed by whatever is
  // current then, rather than by a configuration that may since have been
  // reviewed and replaced. The step history keeps its own `timelineId`, so
  // nothing about what already happened is lost.
  await prisma.lease.update({
    where: { id: lease.id },
    data: { delinquencyTimelineId: null },
  })

  // Superseded, never deleted. These rows are the evidence an auction is
  // defended from; a tenant curing must close the episode, not erase it.
  // Chain-wide, for the same reason the engine reads it chain-wide: an episode
  // that began on the lease this one was transferred out of is THIS episode,
  // and leaving those rows open would resume a cured tenant at day 30.
  await prisma.delinquencyStepRun.updateMany({
    where: { leaseId: { in: [...lease.chainIds] }, supersededAt: null },
    data: { supersededAt: new Date() },
  })

  await emitEvent({
    name: 'delinquency.stage_changed',
    entityType: 'Lease',
    entityId: lease.id,
    facilityId,
    payload: { from: stage?.label ?? null, to: null, cured: true },
  })

  recordItem({ itemId: lease.id, ok: true, message: 'cured — pipeline halted' })
}
