import { prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { currentConsent } from '@storage/core/consent'
import {
  abandonmentExitReason,
  abandonmentStepDue,
  type AbandonmentStep,
} from '@storage/core/checkout'

// PRD 04 US-9 AC1/AC2, FR-LEAD-4 (B-073). Raising the abandoned-checkout
// follow-up's three steps.
//
// Called every hourly cron tick directly — like B-031's
// `sendExpiringSoonReminders`, NOT through `SCHEDULED_JOBS`. That framework
// ticks once per facility-local DAY; this needs to notice something that
// happened an HOUR ago, which a once-daily check cannot do without either
// missing the window or firing the whole day's backlog at once.

/// Stamps the step and emits the event in one guarded write — the same device
/// `raiseLeadDripStep` (B-072) and `Lease.reviewRequestSentAt` (B-071) use.
/// The `status: { not: 'completed' }` clause is the exit condition AND the
/// idempotency guard in the same atomic update: a session that completes in
/// the gap between the caller's read and this write is caught here too, not
/// only by the read-time filter.
export async function raiseAbandonmentStep(
  sessionId: string,
  facilityId: string,
  tenantId: string,
  step: AbandonmentStep,
): Promise<boolean> {
  const updated = await prisma.checkoutSession.updateMany({
    where: { id: sessionId, abandonmentSequenceStep: step - 1, status: { not: 'completed' } },
    data: { abandonmentSequenceStep: step },
  })
  if (updated.count === 0) return false

  await emitEvent({
    name: 'checkout.abandonment_step',
    entityType: 'Tenant',
    entityId: tenantId,
    facilityId,
    payload: { step, checkoutSessionId: sessionId },
  })
  return true
}

export type AbandonmentResult = { raised: number }

/// Scans every checkout session that has captured an email (US-9 AC1: "unit
/// selected, contact info captured") and not yet finished the sequence, and
/// raises whichever step is due.
///
/// Global by default — called once per cron tick for every facility, the same
/// shape `sendExpiringSoonReminders` uses — with an optional `facilityId` for
/// tests and for scoping a manual run.
export async function raiseAbandonmentFollowUps(
  now: Date = new Date(),
  facilityId?: string,
): Promise<AbandonmentResult> {
  const candidates = await prisma.checkoutSession.findMany({
    where: {
      email: { not: null },
      tenantId: { not: null },
      abandonmentSequenceStep: { in: [0, 1, 2] },
      status: { not: 'completed' },
      ...(facilityId ? { facilityId } : {}),
    },
    select: {
      id: true,
      facilityId: true,
      tenantId: true,
      createdAt: true,
      status: true,
      abandonmentSequenceStep: true,
      facility: { select: { abandonmentFollowUpHours: true } },
    },
  })

  let raised = 0
  for (const session of candidates) {
    if (abandonmentExitReason({ status: session.status })) continue

    const nextStep = (session.abandonmentSequenceStep + 1) as AbandonmentStep
    if (!abandonmentStepDue(session.createdAt, nextStep, session.facility.abandonmentFollowUpHours, now)) {
      continue
    }

    // "No consent, no sequence" (AC3), checked at raise time — the same
    // device the lead drip uses, and re-checked again at send time by the
    // comms rule's own skip condition for the gap between the two.
    const consent = await currentConsent({ tenantId: session.tenantId! }, 'marketing_email')
    if (consent !== 'granted') continue

    if (await raiseAbandonmentStep(session.id, session.facilityId, session.tenantId!, nextStep)) {
      raised += 1
    }
  }

  return { raised }
}
