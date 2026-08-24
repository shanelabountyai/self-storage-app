import { prisma, type Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { emitEvent } from '@storage/core/events'
import { billingPeriodFor, describeDayRange, prorate, unusedRemainder } from '@storage/core/billing'
import { businessDateFor } from '@storage/core/jobs'
import { OCCUPYING_LEASE_STATUSES, TRANSFER_HOLD_SOURCE } from '@storage/core/inventory'
import { effectiveAsOf } from '@storage/core/facility-settings'
import {
  isRateRise,
  LIVE_RATE_INCREASE_STATUSES,
  transferRateFor,
  type TransferRatePolicy,
} from '@storage/core/pricing'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { recomputeUnitStatus } from '@/lib/admin/units'
import { releaseOverlock } from '@/lib/delinquency/overlock'
import { applyRateChange } from '@/lib/pricing/tenant-rate-increases'
import { provisionAccessForLease } from '@/lib/access/provision'
import { syncActiveDutyHolds } from '@/lib/tenants/active-duty'

// PRD 02 §4.3 US-14 (B-077). The unit transfer.
//
// US-14's whole transfer AC, verbatim: "moves a tenant to another unit in the
// same facility; closes old lease, opens new lease with new rate, prorates
// both sides per policy, keeps tenant history unified. AC: one wizard, one
// confirmation, both units' statuses update atomically."
//
// ── Why this is not `completeMoveOut` + `provisionMoveIn` ────────────────────
//
// Both were considered and neither fits, for reasons that are about behaviour
// rather than tidiness:
//
//   * `completeMoveOut` unconditionally releases the unit to `maintenance`,
//     revokes the tenant's pay links, and emits `lease.moved_out` — which
//     fires CN-8's "your account is settled" email. A transferring tenant has
//     not moved out, still has a lease, and must not be told they have gone.
//   * `provisionMoveIn` is welded to a `CheckoutSession`: it takes a session
//     id, reads its `data`, and marks it completed. There is no session here.
//
// What IS reused is the part US-14 and US-18 both insist on — the money.
// `prorate` and `unusedRemainder` from `@storage/core/billing` are called
// once each, which is exactly the "a transfer is a prorated move-out and a
// prorated move-in on the same day, so it calls this twice" the proration
// module's own header predicted. Nothing here computes a daily rate.

/// Regional is NOT required. `leases:transfer` is granted to manager and
/// above (rbac-catalog), which is the authority level this needs: a transfer
/// moves money between two of the operator's own units and takes nothing from
/// the tenant, unlike a lien sale or a rate rise.
export type TransferPreview = {
  leaseId: string
  tenantName: string
  facilityId: string
  facilityName: string
  fromUnitNumber: string
  toUnitNumber: string
  toUnitId: string
  transferDate: Date
  currentRateCents: number
  newRateCents: number
  /// B-162 / D-93. What the facility's policy says this transfer should cost,
  /// before any staff override — shown beside `newRateCents` so a person can
  /// see that they have moved off it, and audited alongside what they chose.
  policyRateCents: number
  transferRatePolicy: TransferRatePolicy
  /// True when `newRateCents` came from the form rather than from the policy.
  rateOverridden: boolean
  /// The destination unit type's published street rate, for context on the
  /// screen: "policy says $120, street is $150".
  toStreetRateCents: number
  /// B-162. This move puts the tenant's rent UP. Not a refusal — an upsize
  /// legitimately costs more — but the one fact a person confirming a service
  /// request the tenant asked for needs stated rather than inferred from two
  /// numbers.
  raisesRate: boolean
  /// B-162. An approved or noticed rate increase still live on this lease.
  /// D-93: the transfer sets a new rate, so this one is cancelled on commit —
  /// named here so staff see it before they confirm, rather than discovering
  /// it never happened. Before this it was dropped silently and the nightly
  /// run reported `ok: true, "skipped — the lease has ended"`.
  liveRateIncrease: { id: string; newRateCents: number; effectiveDate: Date } | null
  /// The unused part of the old unit's already-billed period, credited back.
  refundCents: number
  /// The new unit's charge from the transfer date to the end of the same
  /// period, so the tenant's billing day and period boundary do not move.
  chargeCents: number
  /// `chargeCents − refundCents`. Positive means the tenant owes the
  /// difference today; negative means they are owed it back.
  netCents: number
  transferFeeCents: number
  /// What actually posts to the ledger: the net plus any transfer fee.
  totalDueTodayCents: number
  dayRange: string
  prorates: boolean
  /// B-157 / D-85. Whether this move is out of a unit in the lien pipeline, so
  /// the wizard knows to ask for the reason `completeTransfer` will require.
  /// The preview does NOT refuse — staff are meant to be able to price the
  /// move before deciding, and D-85 chose to allow it.
  inLienPipeline: boolean
}

export type TransferPreviewResult =
  | { ok: true; preview: TransferPreview }
  | { ok: false; problem: TransferProblem }

export type TransferProblem =
  | 'lease_not_occupying'
  | 'unit_not_available'
  | 'unit_different_facility'
  | 'same_unit'
  | 'no_rate_for_unit_type'
  | 'lien_transfer_needs_manager'
  | 'lien_transfer_needs_reason'

export const TRANSFER_PROBLEM_COPY: Record<TransferProblem, string> = {
  lease_not_occupying: 'That lease has already ended — there is nothing to transfer.',
  unit_not_available: 'That unit is not available. Pick one with no lease, reservation or hold on it.',
  unit_different_facility: 'A transfer moves a tenant within one facility. That unit is at another site.',
  same_unit: 'That is the unit they are already in.',
  no_rate_for_unit_type: 'That unit type has no published rate, so there is no rate to move the tenant on to.',
  lien_transfer_needs_manager:
    'This unit is in the lien pipeline. Moving a tenant out of it needs a facility manager or above.',
  lien_transfer_needs_reason:
    'This unit is in the lien pipeline. Record why the tenant is being moved out of it.',
}

/// D-85's authority level, stated rather than inherited.
///
/// `leases:transfer` happens to be granted to manager and above today, so the
/// rule held by accident — and would stop holding the moment somebody granted
/// the permission to counter staff, with nothing failing to say so. A lien
/// sale is being prepared against these goods; who may move them is a rule,
/// not a side effect of the permission catalog.
const MANAGER_RANK = 20

function rankAt(actor: Actor, facilityId: string): number {
  if (actor.kind !== 'staff') return 0
  return Math.max(
    0,
    ...actor.assignments
      .filter((one) => one.facilityId === null || one.facilityId === facilityId)
      .map((one) => one.rank),
  )
}

/// Why a tenant is being moved out of a unit whose contents are being prepared
/// for sale (D-85, B-157).
///
/// Shaped like the monetary-override vocabularies (`WAIVER_REASONS`,
/// `RETURN_REASONS`) and used the same way: a fixed code so the audit log
/// stays filterable, with free text alongside it rather than instead of it.
/// The vocabulary is transfer-specific because the generic one cannot answer
/// the question this record exists for — "the notice named unit A and the
/// goods are now in unit B, why" — and `management_approval` against a lien
/// file says only that somebody senior agreed, which was never in doubt.
export const LIEN_TRANSFER_REASONS = [
  { value: 'downsize_to_affordable', label: 'Downsizing to a unit they can afford' },
  { value: 'payment_plan_agreed', label: 'Payment plan agreed' },
  { value: 'facility_need', label: 'Facility needs the unit (consolidation, works)' },
  { value: 'unit_uninhabitable', label: 'Unit is damaged or unusable' },
  { value: 'billing_error', label: 'Billing error — they should not be in the pipeline' },
  { value: 'other', label: 'Other (explain in the note)' },
] as const

export type LienTransferReason = (typeof LIEN_TRANSFER_REASONS)[number]['value']

export function isLienTransferReason(value: string): value is LienTransferReason {
  return LIEN_TRANSFER_REASONS.some((reason) => reason.value === value)
}

/// The status D-85 is about. A lien notice naming this unit has been served
/// and the goods in it are being prepared for sale.
export function inLienPipeline(status: string): boolean {
  return status === 'pending_auction'
}

/// The unit this tenant has asked, from the portal, to transfer into.
///
/// The hold makes the unit's derived status `reserved`, which to everybody
/// else is exactly right and to the tenant it is held FOR would otherwise read
/// as "someone got there first" — blocking the very transfer it exists to set
/// up. Both the availability check and the target list consult this, so the
/// two cannot disagree about which unit is theirs.
export type TransferHold = {
  id: string
  unitId: string | null
  moveInDate: Date | null
  quotedRateCents: number
  /// B-142. When this hold lapses — needed everywhere a screen states it,
  /// because "held for them until you complete or cancel it" was false: the
  /// hold also expires on its own, the same as any other `Reservation`.
  expiresAt: Date
}

export async function transferHoldFor(
  tenantId: string,
  facilityId: string,
): Promise<TransferHold | null> {
  return prisma.reservation.findFirst({
    where: {
      tenantId,
      facilityId,
      source: TRANSFER_HOLD_SOURCE,
      status: 'held',
      expiresAt: { gt: new Date() },
    },
    select: { id: true, unitId: true, moveInDate: true, quotedRateCents: true, expiresAt: true },
  })
}

/// The rate a live hold locks in, if it is a hold on THIS unit.
///
/// B-136 / D-84. `quotedRateCents` is the figure the tenant was shown and
/// agreed to when they asked. Honouring it for as long as the hold lives is
/// the same discipline a checkout session and a prospect's reservation both
/// already keep — a street rate that moves between the ask and staff getting
/// to the request must not silently change the number, in either direction.
/// `transferHoldFor` filters on `expiresAt`, so an expired hold is no hold
/// and the current rate applies again. A staff-initiated transfer has no hold
/// and is unchanged: it re-reads the street rate, which is right for it.
export function heldRateFor(hold: TransferHold | null, unitId: string): number | null {
  return hold?.unitId === unitId ? hold.quotedRateCents : null
}

/// The lease facts a transfer preview needs. Exported so the tenant's own
/// portal request (B-090 part 2) selects exactly the same columns rather than
/// keeping a second list that can drift from this one.
export const TRANSFER_LEASE_SELECT = {
    id: true,
    facilityId: true,
    unitId: true,
    tenantId: true,
    status: true,
    startDate: true,
    billingDay: true,
    monthlyRateCents: true,
    protectionCents: true,
    protectionPlanName: true,
    acquisitionSource: true,
    autopayEnabled: true,
    paidThroughDate: true,
    delinquencyTimelineId: true,
    facility: {
      select: {
        name: true,
        billingPolicy: true,
        timezone: true,
        prorateOnMoveOut: true,
        // B-162 / D-93. The rate rule the preview defaults to.
        transferRatePolicy: true,
      },
    },
    unit: { select: { number: true, unitTypeId: true } },
    tenant: { select: { firstName: true, lastName: true } },
} as const satisfies Prisma.LeaseSelect

export type TransferLease = Prisma.LeaseGetPayload<{ select: typeof TRANSFER_LEASE_SELECT }>

async function loadForTransfer(actor: Actor, leaseId: string): Promise<TransferLease> {
  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: leaseId },
    select: TRANSFER_LEASE_SELECT,
  })
  assertFacilityAccess(actor, lease.facilityId)
  if (!can(actor, 'leases:transfer', lease.facilityId)) {
    throw new ForbiddenError('Missing permission leases:transfer', 'leases:transfer', lease.facilityId)
  }
  return lease
}

/// The published street rate for a unit type — what a new tenant would pay.
///
/// B-162: read for BOTH unit types now, not just the destination. Under
/// `preserve_discount` the tenant's position relative to the rate on the unit
/// they are leaving is the thing being carried, so the old type's street rate
/// is an input rather than a curiosity.
async function streetRateFor(facilityId: string, unitTypeId: string, asOf: Date): Promise<number | null> {
  const rows = await prisma.unitTypeRate.findMany({
    where: { facilityId, unitTypeId },
    orderBy: { effectiveFrom: 'desc' },
  })
  return effectiveAsOf(rows, asOf)?.streetRateCents ?? null
}

/// The facility's configured transfer fee, if it has published one. US-21's
/// fee catalogue reserves the `transfer` type; a facility that has never set
/// one charges nothing rather than a made-up default.
async function transferFeeFor(facilityId: string, asOf: Date): Promise<number> {
  const rows = await prisma.feeSchedule.findMany({
    where: { facilityId, feeType: 'transfer' },
    orderBy: { effectiveFrom: 'desc' },
  })
  return effectiveAsOf(rows, asOf)?.amountCents ?? 0
}

/// What a transfer on this date would settle to. Shown before anything is
/// written, and re-run by the commit — the same discipline `previewMoveOut`
/// established, so the figure staff confirm is the figure that posts.
export async function previewTransfer(
  actor: Actor,
  leaseId: string,
  toUnitId: string,
  transferDate: Date,
  rateOverrideCents?: number | null,
): Promise<TransferPreviewResult> {
  return previewTransferFor(
    await loadForTransfer(actor, leaseId),
    toUnitId,
    transferDate,
    rateOverrideCents,
  )
}

/// The same preview against an already-loaded lease, with no authorization of
/// its own — the caller has already established who may see this.
///
/// Split out for B-090 part 2: a tenant previewing their own transfer from the
/// portal is scoped by `tenantId` on the query rather than by `leases:transfer`
/// on an actor, but must be shown the identical arithmetic. Two copies of a
/// proration is two answers to "what will this cost me", and the tenant's copy
/// would be the one nobody reconciled.
export async function previewTransferFor(
  lease: TransferLease,
  toUnitId: string,
  transferDate: Date,
  rateOverrideCents?: number | null,
): Promise<TransferPreviewResult> {
  if (!OCCUPYING_LEASE_STATUSES.includes(lease.status as never)) {
    return { ok: false, problem: 'lease_not_occupying' }
  }
  if (toUnitId === lease.unitId) return { ok: false, problem: 'same_unit' }

  const target = await prisma.unit.findUniqueOrThrow({
    where: { id: toUnitId },
    select: { id: true, number: true, facilityId: true, unitTypeId: true, status: true },
  })
  if (target.facilityId !== lease.facilityId) return { ok: false, problem: 'unit_different_facility' }
  // The derived status is the authority on whether a unit can be let (B-010),
  // so this asks the same question the public availability read asks rather
  // than re-deriving "is anything on it".
  //
  // One exception, and only one: the unit this tenant's own portal request is
  // holding (B-090 part 2). `reserved` is required explicitly rather than
  // "anything but available" — a stale hold on a unit that has since been
  // leased or taken out of service must still fail, which is what it would do
  // if this trusted the hold instead of the status.
  const held = await transferHoldFor(lease.tenantId, lease.facilityId)
  if (target.status !== 'available') {
    if (!(target.status === 'reserved' && held?.unitId === target.id)) {
      return { ok: false, problem: 'unit_not_available' }
    }
  }

  const toStreetRateCents = await streetRateFor(lease.facilityId, target.unitTypeId, transferDate)
  if (toStreetRateCents === null) return { ok: false, problem: 'no_rate_for_unit_type' }

  // B-162 / D-93. The policy figure, then the two things that may displace it.
  //
  // Order matters and is deliberate. A live portal hold (B-136 / D-84) is a
  // number the TENANT was shown and agreed to, so it wins over the policy —
  // the same rule that already applied when the policy was always "street". A
  // staff override wins over both, because a person looking at the account is
  // the last word on it and the audit records that they were.
  const policyRateCents =
    heldRateFor(held, target.id) ??
    transferRateFor({
      policy: lease.facility.transferRatePolicy as TransferRatePolicy,
      inPlaceRateCents: lease.monthlyRateCents,
      fromStreetRateCents: lease.unit
        ? await streetRateFor(lease.facilityId, lease.unit.unitTypeId, transferDate)
        : null,
      toStreetRateCents,
    })

  const overrideValid =
    typeof rateOverrideCents === 'number' &&
    Number.isInteger(rateOverrideCents) &&
    rateOverrideCents >= 0
  const newRateCents = overrideValid ? rateOverrideCents : policyRateCents

  // Live only. An applied or cancelled increase is history and says nothing
  // about what this transfer is about to do.
  const liveRateIncrease = await prisma.tenantRateIncrease.findFirst({
    where: { leaseId: lease.id, status: { in: [...LIVE_RATE_INCREASE_STATUSES] } },
    orderBy: { effectiveDate: 'asc' },
    select: { id: true, newRateCents: true, effectiveDate: true },
  })

  const period = billingPeriodFor(lease.facility.billingPolicy, lease.billingDay, transferDate)
  const prorates = lease.facility.prorateOnMoveOut

  // Both sides of the same period, from the same module, on the same day —
  // US-14's "prorates both sides per policy" and US-18's "built once… in
  // both directions". The refund is what the tenant did not use on the old
  // unit; the charge is the same days on the new one.
  const refund = unusedRemainder({
    monthlyCents: lease.monthlyRateCents,
    period,
    from: period.start,
    to: transferDate,
  })
  const charge = prorate({
    monthlyCents: newRateCents,
    period,
    from: transferDate,
    to: period.end,
  })

  // Nothing is refunded for days that were never billed. `paidThroughDate`
  // is the same gate move-out uses; without it the tenant would be credited
  // for a period they have not paid for.
  const paidBeyond =
    lease.paidThroughDate !== null && lease.paidThroughDate.getTime() > transferDate.getTime()
  const refundCents = prorates && paidBeyond ? refund.amountCents : 0
  const chargeCents = prorates ? charge.amountCents : 0

  const transferFeeCents = await transferFeeFor(lease.facilityId, transferDate)
  const netCents = chargeCents - refundCents

  return {
    ok: true,
    preview: {
      leaseId: lease.id,
      tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      facilityId: lease.facilityId,
      facilityName: lease.facility.name,
      fromUnitNumber: lease.unit?.number ?? '—',
      toUnitNumber: target.number,
      toUnitId: target.id,
      transferDate,
      currentRateCents: lease.monthlyRateCents,
      newRateCents,
      policyRateCents,
      transferRatePolicy: lease.facility.transferRatePolicy as TransferRatePolicy,
      rateOverridden: overrideValid && rateOverrideCents !== policyRateCents,
      toStreetRateCents,
      raisesRate: isRateRise(lease.monthlyRateCents, newRateCents),
      liveRateIncrease,
      refundCents,
      chargeCents,
      netCents,
      transferFeeCents,
      totalDueTodayCents: netCents + transferFeeCents,
      dayRange: describeDayRange(transferDate, period.end),
      prorates,
      inLienPipeline: inLienPipeline(lease.status),
    },
  }
}

export type CompleteTransferInput = {
  leaseId: string
  toUnitId: string
  transferDate: Date
  /// Required when, and only when, the lease is in the lien pipeline (D-85).
  /// An ordinary unit swap is a service request and stays reason-free — the
  /// audit catalog says so on `lease.transferred` itself.
  reasonCode?: string
  reasonNote?: string
  /// B-162 / D-93. The rate staff set on the preview, when they moved off the
  /// facility's policy figure. Omitted means "use the policy", which is what
  /// every existing caller does.
  rateOverrideCents?: number | null
}

export type CompleteTransferResult =
  | { ok: true; newLeaseId: string; preview: TransferPreview }
  | { ok: false; problem: TransferProblem }

/// Commits the transfer. US-14: "both units' statuses update atomically."
///
/// One transaction covers the old lease closing, the new lease opening, both
/// ledger entries, both `recomputeUnitStatus` calls and the audit entry — so
/// there is no window in which the tenant holds two units or none. Access
/// provisioning and the event are deliberately outside it (see below).
export async function completeTransfer(
  actor: Actor,
  input: CompleteTransferInput,
): Promise<CompleteTransferResult> {
  const lease = await loadForTransfer(actor, input.leaseId)

  // Re-run the preview rather than trusting figures posted from a form: the
  // rate, the unit's availability or the fee could all have moved since the
  // screen rendered, and the confirmed figure must be the posted one.
  const previewed = await previewTransfer(
    actor,
    input.leaseId,
    input.toUnitId,
    input.transferDate,
    input.rateOverrideCents,
  )
  if (!previewed.ok) return previewed
  const preview = previewed.preview

  // ── D-85's staff side (B-157) ────────────────────────────────────────────
  //
  // Checked here rather than in the preview: staff are meant to be able to
  // price the move before deciding — D-85 chose to ALLOW this transfer, on
  // conditions — so the refusal belongs at the commit, not at the quote.
  //
  // Both conditions are refused before the transaction opens, so a lien-
  // pipeline transfer with neither cannot half-commit.
  const lienTransfer = inLienPipeline(lease.status)
  if (lienTransfer) {
    if (rankAt(actor, lease.facilityId) < MANAGER_RANK) {
      return { ok: false, problem: 'lien_transfer_needs_manager' }
    }
    if (!isLienTransferReason((input.reasonCode ?? '').trim())) {
      return { ok: false, problem: 'lien_transfer_needs_reason' }
    }
  }

  const localToday = businessDateFor(input.transferDate, lease.facility.timezone)
  const fromUnitId = lease.unitId

  const committed = await prisma.$transaction(async (tx) => {
    // ── Close the old lease ──────────────────────────────────────────────
    //
    // `status: 'ended'` with `moveOutReason: 'transfer'`, which is what keeps
    // the tenant's history unified: the former lease stays on the tenant, its
    // ledger and its documents intact, rather than being deleted or
    // re-pointed at the new unit.
    await tx.lease.update({
      where: { id: lease.id },
      data: {
        status: 'ended',
        endDate: input.transferDate,
        moveOutDate: input.transferDate,
        moveOutReason: 'transfer',
      },
    })

    if (preview.refundCents > 0) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: lease.facilityId,
          leaseId: lease.id,
          type: 'credit',
          amountCents: -preview.refundCents,
          description: `Transfer credit — unit ${preview.fromUnitNumber} unused ${preview.dayRange}`,
          occurredAt: input.transferDate,
        },
      })
    }

    // ── Open the new lease ───────────────────────────────────────────────
    //
    // Created at the OLD rate deliberately, then moved to the new one through
    // `applyRateChange` below. That is what makes the `LeaseRateChange` row
    // read `previous = what they paid on the old unit`, `new = the new unit's
    // rate`, `reason = transfer` — the history US-11 wants. Creating it at
    // the new rate directly would leave a history row claiming the rate had
    // never changed.
    //
    // `billingDay` is carried over rather than recomputed from the transfer
    // date: the tenant keeps their billing anniversary, which is what makes
    // the two prorated halves add up to one unbroken period.
    const created = await tx.lease.create({
      data: {
        facilityId: lease.facilityId,
        tenantId: lease.tenantId,
        unitId: input.toUnitId,
        // B-138. Not hardcoded `active`: the tenant's standing is a fact about
        // THEM, and the arrears move with them below. A lease that opened
        // `active` beside three unpaid invoices would read as current on the
        // tenant list, the dashboard tile and the AR screen while the ladder
        // ran on it. `pending` is the one status that does not carry — a
        // transfer completes a move, so the new lease is occupied.
        status: lease.status === 'pending' ? 'active' : lease.status,
        // US-25's pin. Carried for the same reason the step history is read
        // through the chain: an episode that started under timeline v3 stays
        // governed by v3, and re-pinning at whatever is current today would
        // change the rules mid-pipeline.
        transferredFromLeaseId: lease.id,
        delinquencyTimelineId: lease.delinquencyTimelineId,
        startDate: input.transferDate,
        billingDay: lease.billingDay,
        monthlyRateCents: lease.monthlyRateCents,
        acquisitionSource: lease.acquisitionSource,
        autopayEnabled: lease.autopayEnabled,
        protectionPlanName: lease.protectionPlanName,
        protectionCents: lease.protectionCents,
        paidThroughDate: lease.paidThroughDate,
      },
    })

    // ── Carry the tenant's protective state ──────────────────────────────
    //
    // B-137. A hold protects a PERSON, not a unit: the SCRA, an automatic stay
    // and a probate are all facts about the tenant that a change of unit does
    // not end. Before this, the new lease opened with none of them, the
    // delinquency engine's `onHold` check passed, and the ladder ran on a
    // servicemember whose file says we were told.
    //
    // Copied onto the new lease rather than re-pointed: the old lease keeps its
    // own holds so the record of what was in force while it ran stays true, and
    // `effectiveFrom` is carried unchanged because the protection started when
    // it started, not today.
    //
    // "Still in force" is deliberately wider than `holdIsActive`: a hold whose
    // `effectiveFrom` is in the future is a commitment already made, and
    // dropping it would silently un-protect the tenant on a date somebody has
    // already recorded. Only lifted and already-expired holds are left behind.
    const carried = await tx.leaseHold.findMany({
      where: {
        leaseId: lease.id,
        liftedAt: null,
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.transferDate } }],
      },
    })
    for (const hold of carried) {
      const copy = await tx.leaseHold.create({
        data: {
          leaseId: created.id,
          type: hold.type,
          reason: hold.reason,
          effectiveFrom: hold.effectiveFrom,
          effectiveTo: hold.effectiveTo,
          documentId: hold.documentId,
          placedByStaffId: hold.placedByStaffId,
          estateContactName: hold.estateContactName,
          estateContactPhone: hold.estateContactPhone,
          estateContactEmail: hold.estateContactEmail,
        },
        select: { id: true },
      })
      await recordAudit(
        {
          actor: toAuditActor(actor),
          facilityId: lease.facilityId,
          action: 'hold.placed',
          entityType: 'Lease',
          entityId: created.id,
          reasonCode: hold.type,
          context: { holdId: copy.id, type: hold.type, carriedFromHoldId: hold.id, carriedFromLeaseId: lease.id },
        },
        tx,
      )
    }

    // And the declaration itself, through the same path a move-in uses rather
    // than a second reading of the flag. Idempotent, so the SCRA hold carried
    // above satisfies it and nothing is placed twice; it earns its keep on the
    // lease whose hold was lifted, or that predates B-121, where the tenant is
    // still declared active-duty and the new lease would otherwise open bare.
    await syncActiveDutyHolds(lease.tenantId, 'transfer', tx, input.transferDate)

    await applyRateChange(
      {
        leaseId: created.id,
        newRateCents: preview.newRateCents,
        effectiveFrom: input.transferDate,
        reason: 'transfer',
        actorStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
      },
      tx,
    )

    // ── The in-flight rate increase (B-162, D-93) ────────────────────────
    //
    // Cancelled, and said out loud. The transfer has just set a new rate, so
    // an increase approved against the old one is a delta from a figure that
    // no longer exists — `applyDueIncreases` would refuse it at apply time
    // anyway ("the rate moved under an already-approved increase"), except
    // that it never got that far: the lease had ended, so the nightly run
    // reported `ok: true, "skipped — the lease has ended"` every night until
    // the effective date passed, and an approved, NOTICED increase evaporated
    // while the run said it was fine. The preview names it before staff
    // confirm; this is what makes the record match.
    const cancelledIncreases = await tx.tenantRateIncrease.findMany({
      where: { leaseId: lease.id, status: { in: [...LIVE_RATE_INCREASE_STATUSES] } },
      select: { id: true, newRateCents: true, effectiveDate: true, status: true },
    })
    for (const increase of cancelledIncreases) {
      await tx.tenantRateIncrease.update({
        where: { id: increase.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
        },
      })
      await recordAudit(
        {
          actor: toAuditActor(actor),
          facilityId: lease.facilityId,
          action: 'rate.increase_cancelled',
          entityType: 'TenantRateIncrease',
          entityId: increase.id,
          reasonCode: 'transfer',
          context: {
            leaseId: lease.id,
            newLeaseId: created.id,
            newRateCents: increase.newRateCents,
            effectiveDate: increase.effectiveDate.toISOString().slice(0, 10),
            statusWhenCancelled: increase.status,
            transferRateCents: preview.newRateCents,
          },
        },
        tx,
      )
    }

    // ── Proof of insurance follows the tenant (B-163) ────────────────────
    //
    // B-137 carried the tenant's `LeaseHold`s and B-162 the promotion; the
    // waiver was the one protective fact still left on the closed lease. It
    // matters more than it looks: `scanExpiringProtectionProofs` reads waivers
    // by `leaseId` and then filters to occupying leases, so a waiver naming an
    // ended lease is not missed once — it is dropped for ever. The tenant's
    // certificate expires, `insurance_proof_lapsed` never fires, and US-44's
    // required-protection policy is silently unenforced for exactly the
    // tenants who moved.
    //
    // Re-pointed, not copied, and `expiresAt` rides along untouched: the
    // certificate expires when it expires, and a transfer is not a renewal.
    // An ALREADY-EXPIRED waiver moves too, deliberately — leaving it behind
    // would make a unit swap a way to shed a lapse that has already happened.
    const movedWaiver = await tx.protectionWaiver.updateMany({
      where: { leaseId: lease.id },
      data: { leaseId: created.id },
    })

    // ── The promotion follows the tenant (B-162, D-93) ───────────────────
    //
    // D-89 settled that a transfer recaptures nothing — "a transferred tenant
    // is still a tenant" — and named the hole it left open: the redemption
    // stayed attached to the ended lease, so the remaining discounted periods
    // died with it AND the minimum stay died with it, which let a tenant
    // inside a minimum stay transfer to the cheapest unit on site and walk out
    // of the next lease owing nothing.
    //
    // Re-pointed rather than copied. `PromoRedemption.leaseId` is unique, one
    // redemption is one promise, and a second row would give `recaptureForLease`
    // and `discountForLeasePeriod` two answers. `appliedPeriods` and the
    // schedule are untouched on purpose: the period index is counted across the
    // whole transfer chain (see `generateInvoices`), so the periods already
    // discounted stay discounted and the remaining ones land on the months they
    // were promised for rather than restarting at the new lease's first.
    const movedRedemption = await tx.promoRedemption.updateMany({
      where: { leaseId: lease.id },
      data: { leaseId: created.id },
    })

    if (preview.chargeCents > 0) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: lease.facilityId,
          leaseId: created.id,
          type: 'charge',
          amountCents: preview.chargeCents,
          description: `Transfer charge — unit ${preview.toUnitNumber} ${preview.dayRange}`,
          occurredAt: input.transferDate,
        },
      })
    }

    if (preview.transferFeeCents > 0) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: lease.facilityId,
          leaseId: created.id,
          type: 'charge',
          amountCents: preview.transferFeeCents,
          description: 'Transfer fee',
          occurredAt: input.transferDate,
        },
      })
    }

    // ── Carry the arrears (B-138, D-86) ──────────────────────────────────
    //
    // The transfer ends the old lease, so before this the delinquency engine
    // halted it as `moved_out` while the new lease had no invoices and 0 days
    // past due. **Collections stopped entirely on a live tenant who owed money
    // and had never left the property**, and asking for a swap was a way to age
    // out of the ladder.
    //
    // D-86 (owner, Option A): the unpaid invoices are re-pointed at the new
    // lease. That is what makes `daysPastDue` keep anchoring to the OLDEST
    // unpaid invoice's original due date across the boundary (D-25) with every
    // existing reader — ledger, aging, ladder, statements, notices — unchanged.
    // A partially paid invoice moves too, and has to: allocation is oldest
    // first, so the part-paid one IS the anchor, and leaving it behind would
    // reset the clock to the next invoice's due date.
    //
    // `open` and `partially_paid` are the same two statuses `leaseLedger` calls
    // outstanding, so the ledger screen and this cannot disagree about what
    // moves. `uncollectible` and `void` deliberately stay: one has been written
    // off and the other never existed, and carrying either would resurrect a
    // claim somebody already closed.
    const outstanding = (
      await tx.invoice.findMany({
        where: { leaseId: lease.id, status: { in: ['open', 'partially_paid'] } },
        select: { id: true, number: true, totalCents: true, amountPaidCents: true, dueDate: true },
        orderBy: { dueDate: 'asc' },
      })
    ).filter((invoice) => invoice.totalCents > invoice.amountPaidCents)

    let carriedArrearsCents = 0
    for (const invoice of outstanding) {
      const owed = invoice.totalCents - invoice.amountPaidCents
      carriedArrearsCents += owed

      await tx.invoice.update({ where: { id: invoice.id }, data: { leaseId: created.id } })

      // The append-only record D-86 asked for, and the reason it is a PAIR of
      // ledger entries per invoice rather than one lump sum: both carry the
      // invoice id, so `leaseLedger`'s reconciliation counts them against that
      // invoice instead of as an uninvoiced charge — a lump sum with no invoice
      // behind it would make every transferred lease report a discrepancy equal
      // to the arrears. Nothing already written is edited: the original charge
      // stays on the old lease, where it was raised.
      await tx.ledgerEntry.create({
        data: {
          facilityId: lease.facilityId,
          leaseId: lease.id,
          type: 'adjustment',
          amountCents: -owed,
          description: `Balance moved to unit ${preview.toUnitNumber} — invoice ${invoice.number}`,
          occurredAt: input.transferDate,
          invoiceId: invoice.id,
        },
      })
      await tx.ledgerEntry.create({
        data: {
          facilityId: lease.facilityId,
          leaseId: created.id,
          type: 'adjustment',
          amountCents: owed,
          description: `Balance carried from unit ${preview.fromUnitNumber} — invoice ${invoice.number}`,
          occurredAt: input.transferDate,
          invoiceId: invoice.id,
        },
      })

      // Per invoice, not once for the move: "which lease was this raised
      // against" has to be answerable from the invoice, and an entry whose
      // `entityId` is the invoice is the only shape that answers it without a
      // JSON scan.
      await recordAudit(
        {
          actor: toAuditActor(actor),
          facilityId: lease.facilityId,
          action: 'invoice.lease_reassigned',
          entityType: 'Invoice',
          entityId: invoice.id,
          context: {
            fromLeaseId: lease.id,
            toLeaseId: created.id,
            fromUnitNumber: preview.fromUnitNumber,
            toUnitNumber: preview.toUnitNumber,
            outstandingCents: owed,
            dueDate: invoice.dueDate.toISOString().slice(0, 10),
          },
        },
        tx,
      )
    }

    // ── Both units, atomically ───────────────────────────────────────────
    //
    // Derived, never set: the leases above are what make one unit free and
    // the other occupied (B-010's rule). The old unit goes straight back to
    // available rather than to `maintenance` the way a move-out does — the
    // tenant is still on site and the unit is being handed back in the same
    // visit, so holding it for a cleaning inspection would be theatre. Staff
    // can mark it for maintenance from the unit screen if it needs it.
    // The portal request that set this up, if there was one. Converted rather
    // than left held: the partial unique index allows one held reservation per
    // unit, so a stale one blocks the next tenant who wants it, and the unit's
    // derived status should now be decided by the new lease alone.
    await tx.reservation.updateMany({
      where: {
        unitId: input.toUnitId,
        tenantId: lease.tenantId,
        source: TRANSFER_HOLD_SOURCE,
        status: 'held',
      },
      data: { status: 'converted' },
    })

    // B-151. The lock comes off with the lease, whatever the balance did.
    //
    // The delinquency engine only queued a removal on CURE, and a lease that
    // ends still owing halts as `moved_out` instead — so the lock stayed on a
    // unit nobody was renting, `deriveUnitStatus` kept returning `overlocked`
    // ahead of the `maintenance` set just above, the reconciliation screen saw
    // system and physical agreeing (both wrong), and the unit sat out of
    // sellable inventory with nothing reporting it. The unit does NOT go back
    // in the denominator here — there is still a real lock on it — it goes back
    // when `confirmOverlockRemoved` records somebody taking it off, which is
    // what this task now asks for.
    await releaseOverlock({ leaseId: lease.id, facilityId: lease.facilityId, reason: 'transfer' }, tx)

    await recomputeUnitStatus(input.toUnitId, tx)
    if (fromUnitId) await recomputeUnitStatus(fromUnitId, tx)

    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: lease.facilityId,
        // B-157 / D-85. A move out of the lien pipeline is its own action, and
        // `recordAudit` refuses to write it without a reason code — so the
        // record a lien file needs cannot be omitted by a caller that forgot.
        action: lienTransfer ? 'lease.transferred_in_lien_pipeline' : 'lease.transferred',
        entityType: 'Lease',
        entityId: lease.id,
        reasonCode: lienTransfer ? (input.reasonCode ?? '').trim() : undefined,
        context: {
          newLeaseId: created.id,
          fromUnitNumber: preview.fromUnitNumber,
          toUnitNumber: preview.toUnitNumber,
          previousRateCents: preview.currentRateCents,
          newRateCents: preview.newRateCents,
          // B-162. Both figures, always: "they paid the policy rate" and "a
          // manager typed this in" are different facts and the audit row is
          // the only place the second one is recorded.
          policyRateCents: preview.policyRateCents,
          transferRatePolicy: preview.transferRatePolicy,
          rateOverridden: preview.rateOverridden,
          raisesRate: preview.raisesRate,
          cancelledRateIncreaseIds: cancelledIncreases.map((one) => one.id),
          promoRedemptionMoved: movedRedemption.count > 0,
          protectionWaiverMoved: movedWaiver.count > 0,
          refundCents: preview.refundCents,
          chargeCents: preview.chargeCents,
          transferFeeCents: preview.transferFeeCents,
          transferDate: localToday.toISOString().slice(0, 10),
          carriedHoldTypes: carried.map((hold) => hold.type),
          carriedArrearsCents,
          carriedInvoiceNumbers: outstanding.map((invoice) => invoice.number),
          // The unit the served notice named, recorded on the transfer itself
          // so "the notice says A, the goods are in B" reconciles from one row
          // rather than from a join somebody has to think to make.
          ...(lienTransfer
            ? {
                lienPipelineNoticeUnitNumber: preview.fromUnitNumber,
                approvedByRank: rankAt(actor, lease.facilityId),
                reasonNote: input.reasonNote?.trim() || null,
              }
            : {}),
        },
      },
      tx,
    )

    return { newLeaseId: created.id, carriedArrearsCents }
  })
  const { newLeaseId, carriedArrearsCents } = committed

  // Outside the transaction, and for the same reason move-out revokes access
  // outside its own: the gate adapter is a box on a domestic broadband line,
  // and a slow one must not roll back a completed transfer. The tenant's
  // AccessGrant is per (facility, tenant) so it needs nothing — only the
  // per-lease credential has to be issued for the new unit.
  try {
    await provisionAccessForLease(newLeaseId)
  } catch {
    // Swallowed deliberately: the transfer has committed and the tenant has
    // the unit. A failed credential issue is visible in the gate queue, and
    // the same `move_in_provisioning_failed` path B-026 built covers it.
  }

  await emitEvent({
    name: 'lease.transferred',
    entityType: 'Lease',
    entityId: newLeaseId,
    facilityId: lease.facilityId,
    payload: {
      previousLeaseId: lease.id,
      fromUnitNumber: preview.fromUnitNumber,
      toUnitNumber: preview.toUnitNumber,
      previousRateCents: preview.currentRateCents,
      newRateCents: preview.newRateCents,
      transferDate: input.transferDate.toISOString().slice(0, 10),
      totalDueTodayCents: preview.totalDueTodayCents,
      // B-138. The tenant's arrears came with them, and anything reading this
      // event to build a statement or a report needs to know that rather than
      // inferring it from two leases whose totals moved.
      carriedArrearsCents,
    },
  })

  return { ok: true, newLeaseId, preview }
}

export type TransferTargetUnit = {
  id: string
  number: string
  unitTypeName: string
  rateCents: number | null
}

/// The units a tenant could transfer into: available, same facility, with a
/// published rate. Offered as a list so the screen never asks staff to type a
/// unit id — the one-off rate-increase form's own gap, not repeated here.
export async function transferTargets(
  actor: Actor,
  leaseId: string,
  asOf: Date = new Date(),
): Promise<TransferTargetUnit[]> {
  const lease = await loadForTransfer(actor, leaseId)

  // Same exception as the availability check above, for the same reason: a
  // tenant who asked for unit 214 must still find 214 in the list staff
  // complete the transfer from.
  const held = await transferHoldFor(lease.tenantId, lease.facilityId)
  const units = await prisma.unit.findMany({
    where: {
      facilityId: lease.facilityId,
      id: { not: lease.unitId ?? undefined },
      OR: [
        { status: 'available' as const },
        ...(held?.unitId ? [{ id: held.unitId, status: 'reserved' as const }] : []),
      ],
    },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, unitTypeId: true, unitType: { select: { name: true } } },
  })
  if (units.length === 0) return []

  const rates = await prisma.unitTypeRate.findMany({
    where: { facilityId: lease.facilityId, effectiveFrom: { lte: asOf } },
    orderBy: { effectiveFrom: 'desc' },
    select: { unitTypeId: true, streetRateCents: true },
  })
  const rateByType = new Map<string, number>()
  for (const rate of rates) {
    if (!rateByType.has(rate.unitTypeId)) rateByType.set(rate.unitTypeId, rate.streetRateCents)
  }

  // B-162. Priced the way the SETTLEMENT prices it, for the reason the held
  // unit already was: a dropdown quoting street beside a settlement quoting the
  // policy figure is two answers to one question, and staff have no way to tell
  // which one posts. `preserve_discount` in particular makes them differ on
  // nearly every row, which is the point of it.
  const fromStreetRateCents = lease.unit ? (rateByType.get(lease.unit.unitTypeId) ?? null) : null
  const policy = lease.facility.transferRatePolicy as TransferRatePolicy

  return units.map((unit) => {
    const toStreetRateCents = rateByType.get(unit.unitTypeId)
    return {
      id: unit.id,
      number: unit.number,
      unitTypeName: unit.unitType.name,
      rateCents:
        heldRateFor(held, unit.id) ??
        (toStreetRateCents === undefined
          ? null
          : transferRateFor({
              policy,
              inPlaceRateCents: lease.monthlyRateCents,
              fromStreetRateCents,
              toStreetRateCents,
            })),
    }
  })
}

export type PendingTransferRequest = {
  toUnitId: string
  toUnitNumber: string
  transferDate: Date
  quotedRateCents: number
  /// B-142. The hold's real expiry, and the facility's own timezone to render
  /// it in — every screen showing this request states it (PRD 02 §4.4 US-14).
  expiresAt: Date
  facilityTimezone: string
}

/// What the tenant asked for from the portal, if anything (B-090 part 2).
///
/// The wizard reads this so staff land on the unit and date the tenant chose
/// rather than hunting for them: the task that brought them here says a
/// transfer was requested, and a queue item that does not carry what was
/// requested is the exact failure B-115 fixed for every other task type.
export async function pendingTransferRequest(
  actor: Actor,
  leaseId: string,
): Promise<PendingTransferRequest | null> {
  const lease = await loadForTransfer(actor, leaseId)
  const held = await transferHoldFor(lease.tenantId, lease.facilityId)
  if (!held?.unitId || !held.moveInDate) return null

  const unit = await prisma.unit.findUniqueOrThrow({
    where: { id: held.unitId },
    select: { number: true },
  })
  return {
    toUnitId: held.unitId,
    toUnitNumber: unit.number,
    transferDate: held.moveInDate,
    quotedRateCents: held.quotedRateCents,
    expiresAt: held.expiresAt,
    facilityTimezone: lease.facility.timezone,
  }
}
