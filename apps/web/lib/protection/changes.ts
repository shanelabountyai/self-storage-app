import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { businessDateFor } from '@storage/core/jobs'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import {
  changeProblem,
  effectiveDateFor,
  type ChangeProblem,
  type ProtectionSelection,
} from '@storage/core/billing'
import { createTask } from '@/lib/admin/tasks'
import { storeUpload, type BlobPutter, type StoreResult } from '@/lib/documents/storage'
import { currentPlans } from './plans'

// PRD 01 US-705 (B-104). Changing protection from the portal, and telling us
// about your own cover.
//
// The scheduling rule is pure and lives in
// packages/core/billing/protection-changes.ts. This is the part that reads the
// lease, writes the row, and — separately — applies it when the cycle comes
// round.

export type ProtectionView = {
  leaseId: string
  unitNumber: string
  facilityName: string
  currentPlanName: string | null
  currentPremiumCents: number
  /// The tenant's own cover, if they have told us about it.
  waiver: {
    carrier: string | null
    policyNumber: string | null
    expiresAt: Date | null
    /// True when the policy we have on file has run out. D-17 auto-enrols on
    /// this, so it is worth saying loudly before that happens rather than after.
    expired: boolean
  } | null
  plans: { tier: string; name: string; coverageCents: number; premiumCents: number }[]
  /// A change already scheduled and not yet applied.
  pending: {
    id: string
    toPlanName: string | null
    toPremiumCents: number
    effectiveFrom: Date
  } | null
}

export async function protectionForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<ProtectionView[]> {
  const leases = await prisma.lease.findMany({
    where: { tenantId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    orderBy: { startDate: 'asc' },
    select: {
      id: true,
      facilityId: true,
      protectionPlanName: true,
      protectionCents: true,
      unit: { select: { number: true } },
      facility: { select: { name: true } },
    },
  })

  return Promise.all(
    leases.map(async (lease) => {
      const [plans, waiver, pending] = await Promise.all([
        currentPlans(lease.facilityId, now),
        prisma.protectionWaiver.findUnique({ where: { leaseId: lease.id } }),
        prisma.protectionChange.findFirst({
          where: { leaseId: lease.id, appliedAt: null, cancelledAt: null },
          orderBy: { createdAt: 'desc' },
        }),
      ])

      return {
        leaseId: lease.id,
        unitNumber: lease.unit.number,
        facilityName: lease.facility.name,
        currentPlanName: lease.protectionPlanName,
        currentPremiumCents: lease.protectionCents,
        waiver: waiver
          ? {
              carrier: waiver.carrier,
              policyNumber: waiver.policyNumber,
              expiresAt: waiver.expiresAt,
              expired: waiver.expiresAt !== null && waiver.expiresAt.getTime() < now.getTime(),
            }
          : null,
        plans: plans.map((plan) => ({
          tier: plan.tier,
          name: plan.name,
          coverageCents: plan.coverageCents,
          premiumCents: plan.premiumCents,
        })),
        pending: pending
          ? {
              id: pending.id,
              toPlanName: pending.toPlanName,
              toPremiumCents: pending.toPremiumCents,
              effectiveFrom: pending.effectiveFrom,
            }
          : null,
      }
    }),
  )
}

export type ScheduleResult =
  | { ok: true; changeId: string; effectiveFrom: Date; selection: ProtectionSelection }
  | { ok: false; reason: ChangeProblem | 'not_your_lease' }

/// Schedules a tier change (or a switch to the tenant's own cover) for the
/// start of the next billing period.
export async function scheduleProtectionChange(input: {
  tenantId: string
  leaseId: string
  /// A tier from the facility's live catalogue, or null to move to a waiver.
  tier: string | null
  requestedAt?: Date
}): Promise<ScheduleResult> {
  const requestedAt = input.requestedAt ?? new Date()

  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: {
      id: true,
      tenantId: true,
      facilityId: true,
      status: true,
      billingDay: true,
      protectionPlanName: true,
      protectionCents: true,
      facility: { select: { billingPolicy: true } },
    },
  })
  // The lease id comes from a form. Checked before anything is read about it.
  if (!lease || lease.tenantId !== input.tenantId) return { ok: false, reason: 'not_your_lease' }

  const [plans, waiver] = await Promise.all([
    currentPlans(lease.facilityId, requestedAt),
    prisma.protectionWaiver.findUnique({ where: { leaseId: lease.id } }),
  ])

  const chosen = input.tier ? plans.find((plan) => plan.tier === input.tier) : null
  const selection: ProtectionSelection = input.tier
    ? chosen
      ? { kind: 'plan', tier: chosen.tier, planName: chosen.name, premiumCents: chosen.premiumCents }
      : { kind: 'plan', tier: input.tier, planName: '', premiumCents: 0 }
    : { kind: 'waiver' }

  const problem = changeProblem({
    selection,
    availableTiers: plans.map((plan) => plan.tier),
    currentPlanName: lease.protectionPlanName,
    currentPremiumCents: lease.protectionCents,
    leaseIsActive: OCCUPYING_LEASE_STATUSES.includes(lease.status as never),
    // Current, unexpired evidence. An expired policy is not cover, and letting
    // it justify dropping a paid plan is exactly the gap D-17 exists to close.
    hasCurrentProof:
      waiver !== null &&
      waiver.expiresAt !== null &&
      waiver.expiresAt.getTime() >= requestedAt.getTime(),
  })
  if (problem) return { ok: false, reason: problem }

  const effectiveFrom = effectiveDateFor({
    policy: lease.facility.billingPolicy,
    billingDay: lease.billingDay,
    requestedAt,
  })

  // Supersede any change still waiting. A tenant who changes their mind twice
  // in a month gets the last answer, not both — and the superseded row stays,
  // because "they asked to drop cover and then changed their mind" is exactly
  // what a coverage dispute asks about.
  await prisma.protectionChange.updateMany({
    where: { leaseId: lease.id, appliedAt: null, cancelledAt: null },
    data: { cancelledAt: requestedAt, cancelledReason: 'superseded by a later request' },
  })

  const change = await prisma.protectionChange.create({
    data: {
      facilityId: lease.facilityId,
      leaseId: lease.id,
      fromPlanName: lease.protectionPlanName,
      fromPremiumCents: lease.protectionCents,
      toPlanName: selection.kind === 'plan' ? selection.planName : null,
      toTier: selection.kind === 'plan' ? selection.tier : null,
      toPremiumCents: selection.kind === 'plan' ? selection.premiumCents : 0,
      effectiveFrom,
      requestedByTenantId: input.tenantId,
    },
  })

  await recordAudit({
    actor: { type: 'tenant', tenantId: input.tenantId },
    action: 'protection.change_scheduled',
    entityType: 'Lease',
    entityId: lease.id,
    facilityId: lease.facilityId,
    before: { planName: lease.protectionPlanName, premiumCents: lease.protectionCents },
    after: {
      planName: selection.kind === 'plan' ? selection.planName : null,
      premiumCents: selection.kind === 'plan' ? selection.premiumCents : 0,
      effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
    },
  })

  return { ok: true, changeId: change.id, effectiveFrom, selection }
}

export type CancelResult = { ok: true } | { ok: false; reason: 'not_found' }

export async function cancelProtectionChange(input: {
  tenantId: string
  changeId: string
}): Promise<CancelResult> {
  const change = await prisma.protectionChange.findUnique({
    where: { id: input.changeId },
    select: { id: true, leaseId: true, facilityId: true, appliedAt: true, cancelledAt: true, lease: { select: { tenantId: true } } },
  })
  if (
    !change ||
    change.lease.tenantId !== input.tenantId ||
    change.appliedAt !== null ||
    change.cancelledAt !== null
  ) {
    return { ok: false, reason: 'not_found' }
  }

  await prisma.protectionChange.update({
    where: { id: change.id },
    data: { cancelledAt: new Date(), cancelledReason: 'cancelled by the tenant' },
  })

  await recordAudit({
    actor: { type: 'tenant', tenantId: input.tenantId },
    action: 'protection.change_cancelled',
    entityType: 'Lease',
    entityId: change.leaseId,
    facilityId: change.facilityId,
  })

  return { ok: true }
}

export type ProofResult =
  | {
      ok: true
      /// Null when no file was sent. Set to a message when one was sent and
      /// could not be kept — the details were still recorded, and the caller
      /// says so rather than claiming a clean success.
      documentProblem: string | null
    }
  | { ok: false; reason: 'not_your_lease' }

/// Records the tenant's own cover: insurer, policy number, expiry — and, since
/// the B-104 follow-up, the declaration page itself.
///
/// The structured details are the part the SYSTEM uses: `expiresAt` is what
/// D-17's nightly lapse scan reads and what auto-enrols the tenant when their
/// policy runs out. The document is the part a PERSON uses — it is what a
/// coverage argument is actually settled with, and until this shipped the staff
/// task asked somebody to check details against a page nobody could attach.
///
/// The upload is optional and its failure is NOT fatal: a tenant whose file is
/// rejected, or who submits from a deployment with no blob token, still gets
/// their policy details recorded. Losing the expiry date because a photo was a
/// heic would be the worse outcome by far — that date is what stops the
/// auto-enrolment charge.
export async function submitInsuranceProof(input: {
  tenantId: string
  leaseId: string
  carrier: string
  policyNumber: string
  expiresAt: Date
  document?: { bytes: Uint8Array; declaredType?: string | null; filename?: string | null }
},
  /// Injected by tests so the flow can be proved without a bucket or a token.
  put?: BlobPutter,
): Promise<ProofResult> {
  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: { id: true, tenantId: true, facilityId: true },
  })
  if (!lease || lease.tenantId !== input.tenantId) return { ok: false, reason: 'not_your_lease' }

  await prisma.protectionWaiver.upsert({
    where: { leaseId: lease.id },
    create: {
      facilityId: lease.facilityId,
      leaseId: lease.id,
      tenantId: input.tenantId,
      carrier: input.carrier.trim(),
      policyNumber: input.policyNumber.trim(),
      expiresAt: input.expiresAt,
    },
    update: {
      carrier: input.carrier.trim(),
      policyNumber: input.policyNumber.trim(),
      expiresAt: input.expiresAt,
      // A fresh submission clears a previous manager override: the tenant has
      // now given real details, and leaving the override in place would keep
      // the row reading "accepted without evidence".
      overrideReason: null,
      overrideByStaffId: null,
    },
  })

  // Stored after the waiver row, so the details survive a rejected file.
  let upload: StoreResult | null = null
  if (input.document && input.document.bytes.length > 0) {
    upload = await storeUpload(
      {
        facilityId: lease.facilityId,
        type: 'insurance_proof',
        subjectType: 'Lease',
        subjectId: lease.id,
        bytes: input.document.bytes,
        declaredType: input.document.declaredType,
        filename: input.document.filename,
        fallbackTitle: 'Proof of insurance',
      },
      ...(put ? ([put] as const) : ([] as const)),
    )
    if (upload.ok) {
      await prisma.protectionWaiver.update({
        where: { leaseId: lease.id },
        data: { documentRef: upload.documentId },
      })
    }
  }

  await createTask({
    facilityId: lease.facilityId,
    type: 'insurance_proof_review',
    entityType: 'Lease',
    entityId: lease.id,
  })

  await recordAudit({
    actor: { type: 'tenant', tenantId: input.tenantId },
    action: 'protection.proof_submitted',
    entityType: 'Lease',
    entityId: lease.id,
    facilityId: lease.facilityId,
    after: {
      carrier: input.carrier.trim(),
      expiresAt: input.expiresAt.toISOString().slice(0, 10),
      documentId: upload?.ok ? upload.documentId : null,
    },
  })

  return { ok: true, documentProblem: upload && !upload.ok ? upload.message : null }
}

export type ApplyResult = { applied: number; skipped: number }

/// Applies every change whose effective date has arrived (US-705's "takes
/// effect next billing cycle").
///
/// Runs BEFORE invoice generation in the nightly order, so a change effective
/// today is on today's invoice rather than next month's — which is the whole
/// promise made to the tenant when it was scheduled.
export async function applyDueProtectionChanges(
  facilityId: string,
  businessDate: Date,
  recordItem: (outcome: { itemId: string; ok: boolean; message?: string }) => void,
): Promise<ApplyResult> {
  const due = await prisma.protectionChange.findMany({
    where: {
      facilityId,
      appliedAt: null,
      cancelledAt: null,
      effectiveFrom: { lte: businessDate },
    },
    orderBy: { effectiveFrom: 'asc' },
  })

  const result: ApplyResult = { applied: 0, skipped: 0 }

  for (const change of due) {
    const lease = await prisma.lease.findUnique({
      where: { id: change.leaseId },
      select: { status: true, protectionPlanName: true, protectionCents: true },
    })

    if (!lease || !OCCUPYING_LEASE_STATUSES.includes(lease.status as never)) {
      result.skipped += 1
      await prisma.protectionChange.update({
        where: { id: change.id },
        data: { cancelledAt: new Date(), cancelledReason: 'the lease ended before it took effect' },
      })
      recordItem({
        itemId: change.leaseId,
        ok: true,
        message: 'protection change skipped — the lease has ended',
      })
      continue
    }

    // The premium moved under a scheduled change — an operator repriced the
    // tier, or staff changed it at the counter. Applied anyway, unlike B-076's
    // rate increase which refuses: there the approver signed off on a specific
    // delta, whereas here the TENANT asked for a named level of cover and that
    // is what they should get, at whatever it now costs. The audit entry
    // records both figures so the difference is visible.
    await prisma.$transaction(async (tx) => {
      await tx.lease.update({
        where: { id: change.leaseId },
        data: {
          protectionPlanName: change.toPlanName,
          protectionCents: change.toPremiumCents,
          // Switching to the tenant's own cover is a waiver, and the lease has
          // to say so — D-17's scan and the move-out settlement both read it.
          protectionWaivedAt: change.toPlanName === null ? new Date() : null,
        },
      })
      await tx.protectionChange.update({
        where: { id: change.id },
        data: { appliedAt: new Date() },
      })
    })

    await recordAudit({
      actor: { type: 'system', label: 'protection.apply-changes' },
      action: 'protection.change_applied',
      entityType: 'Lease',
      entityId: change.leaseId,
      facilityId,
      before: { planName: lease.protectionPlanName, premiumCents: lease.protectionCents },
      after: { planName: change.toPlanName, premiumCents: change.toPremiumCents },
      context: {
        requestedPremiumCents: change.toPremiumCents,
        premiumWhenRequestedCents: change.fromPremiumCents,
      },
    })

    result.applied += 1
    recordItem({
      itemId: change.leaseId,
      ok: true,
      message: change.toPlanName
        ? `protection changed to ${change.toPlanName}`
        : 'protection plan ended — tenant carries their own cover',
    })
  }

  return result
}

/// The facility-local day a change becomes due, for callers that need it.
export function dueDayFor(instant: Date, timezone: string): Date {
  return businessDateFor(instant, timezone)
}
