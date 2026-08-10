import { prisma } from '@storage/db'
import { businessDateFor } from '@storage/core/jobs'
import { emitEvent } from '@storage/core/events'
import { currentConsent } from '@storage/core/consent'
import { leadDripExitReason, leadDripStepDue, type LeadDripStep } from '@storage/core/leads'
import { currentRateForUnitType } from '@/lib/pricing/unit-type-rates'
import { offerFor } from '@/lib/promotions/service'

// PRD 04 §3.7 US-14 (B-072). Raising the lead drip's three steps.
//
// Step 1 fires immediately from `captureLead` on `lead.created` — a quote
// recap loses its point waiting for a nightly sweep. Steps 2 and 3 are
// day-counted, so they need the same per-facility scheduled-job shape B-043's
// expiry scans and B-071's review-request job already use.

/// Stamps the step and emits the event in one guarded write — the same device
/// `Lease.reviewRequestSentAt` uses. `updateMany` scoped to the PREVIOUS step
/// value is the idempotency: a redelivered call, or two ticks of the job
/// landing at once, moves `dripStep` forward exactly once.
export async function raiseLeadDripStep(
  leadId: string,
  facilityId: string,
  step: LeadDripStep,
): Promise<boolean> {
  const updated = await prisma.lead.updateMany({
    where: { id: leadId, dripStep: step - 1 },
    data: { dripStep: step },
  })
  if (updated.count === 0) return false

  await emitEvent({
    name: 'lead.drip_step',
    entityType: 'Lead',
    entityId: leadId,
    facilityId,
    payload: { step },
  })
  return true
}

export type DripStepsResult = { raised: number }

/// Raises step 2 (+2 days) and step 3 (+5 days, only with a live promo) for
/// every lead that has cleared the delay and not exited.
export async function raiseLeadDripSteps(
  facilityId: string,
  businessDate: Date,
  recordItem?: (outcome: { itemId: string; ok: boolean; message?: string }) => void,
): Promise<DripStepsResult> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { timezone: true },
  })

  const candidates = await prisma.lead.findMany({
    where: { facilityId, dripStep: { in: [1, 2] } },
    select: { id: true, dripStep: true, createdAt: true, unitTypeId: true, status: true },
  })

  let raised = 0
  for (const lead of candidates) {
    if (
      leadDripExitReason({
        status: lead.status as 'new' | 'contacted' | 'reserved' | 'converted' | 'lost',
        hasUnitType: Boolean(lead.unitTypeId),
      })
    ) {
      continue
    }

    const nextStep = (lead.dripStep + 1) as LeadDripStep
    const createdBusinessDate = businessDateFor(lead.createdAt, facility.timezone)
    if (!leadDripStepDue(createdBusinessDate, nextStep, businessDate)) continue

    if (nextStep === 3) {
      // AC1: "only if an eligible promo is live." Not raised at all otherwise
      // — this is "only if", not "send anyway with nothing to nudge about".
      const rate = await currentRateForUnitType(lead.unitTypeId!)
      const offer = rate
        ? await offerFor({
            facilityId,
            unitTypeId: lead.unitTypeId!,
            monthlyRateCents: rate.webRateCents,
            isNewTenant: true,
          })
        : { offer: null }
      if (!offer.offer) continue
    }

    // "No consent, no sequence" (US-13/US-14), re-checked here: consent was
    // only ever captured once, at step 1's own submission, and could have been
    // withdrawn since.
    const consent = await currentConsent({ leadId: lead.id }, 'marketing_email')
    if (consent !== 'granted') continue

    if (await raiseLeadDripStep(lead.id, facilityId, nextStep)) raised += 1
  }

  recordItem?.({ itemId: facilityId, ok: true, message: `raised ${raised} drip step${raised === 1 ? '' : 's'}` })
  return { raised }
}
