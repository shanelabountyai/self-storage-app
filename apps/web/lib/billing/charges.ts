import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { raiseFeeInvoice, scheduledFeeCents } from '@/lib/billing/fee-invoice'
import { checkMonetaryAuthority, nextApproverRole, requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.5 US-21/US-23, §4.4 US-14 (B-167). Charging a fee.
//
// US-21's AC says "the fee catalogue covers what a facility actually charges",
// and B-047 duly added six more types — `lock_cut`, `cleaning`, `damage`,
// `lien`, `certified_mail`, `auction_cost` — with an editable schedule on
// `/admin/settings` for every one. Nothing could charge any of them. Repo-wide
// only `admin`, `late`, `transfer` and `nsf` were ever posted, so a unit left
// full of rubbish, a lock cut at the operator's cost and a damaged door were
// each a settings screen with no consequence, and the certified-mail and lien
// costs a Texas operator is allowed to recover never reached a cure quote —
// the tenant paid less than the statute permits and the operator ate the
// postage.
//
// ── Why the authority rule is what it is ─────────────────────────────────────
//
// Two gates, and the split is the whole design:
//
//   * **`fees:charge` at the facility** posts the facility's own scheduled
//     figure. Counter staff hold it, because the person who cut the lock or
//     walked the dirty unit is who knows the fee is owed, and the amount is
//     not their decision — it is the schedule's.
//   * **Departing from that figure is measured against the FEE-WAIVER limit,
//     in either direction.** Under-charging gives money away and is plainly a
//     waiver by another name. Over-charging is discretion over a tenant's
//     money in the direction that hurts them, which is if anything the one
//     that wants a limit more. One ladder, symmetric, no new column: counter
//     staff (limit $0, no `fees:waive`) can post only the scheduled figure, a
//     manager can move it by $50, a regional by $250, an owner without limit.
//     A fee type the facility has configured NO amount for is a departure from
//     zero, so the whole of it needs waiver authority — which is the right
//     answer for "charge a tenant something nobody has ever priced".
//
// No free-text fee types (the enum is the catalogue and B-167 adds none) and
// no free-text amount outside that ladder.

/// The six types B-047 added and nothing ever charged. `admin`, `late`, `nsf`
/// and `transfer` are deliberately absent: each already has exactly one
/// automatic charger, and offering a hand-posted second one beside it is how a
/// tenant ends up with two late fees for one late month.
export const AD_HOC_FEE_TYPES = [
  'lock_cut',
  'cleaning',
  'damage',
  'lien',
  'certified_mail',
  'auction_cost',
] as const

export type AdHocFeeType = (typeof AD_HOC_FEE_TYPES)[number]

/// What a staffer reads, and what goes on the tenant's invoice.
export const AD_HOC_FEE_LABELS: Record<AdHocFeeType, string> = {
  lock_cut: 'Lock cut',
  cleaning: 'Cleaning',
  damage: 'Damage',
  lien: 'Lien processing',
  certified_mail: 'Certified mail',
  auction_cost: 'Auction costs',
}

export function isAdHocFeeType(value: string): value is AdHocFeeType {
  return (AD_HOC_FEE_TYPES as readonly string[]).includes(value)
}

export type ChargeableFee = {
  feeType: AdHocFeeType
  label: string
  /// The facility's configured amount, or null when it has priced none — in
  /// which case the form offers no default and the whole amount needs waiver
  /// authority.
  scheduledCents: number | null
}

/// The fee schedule for the charge form, one row per ad-hoc type.
export async function chargeableFees(facilityId: string): Promise<ChargeableFee[]> {
  const rows = await Promise.all(
    AD_HOC_FEE_TYPES.map(async (feeType) => ({
      feeType,
      label: AD_HOC_FEE_LABELS[feeType],
      scheduledCents: await scheduledFeeCents(facilityId, feeType),
    })),
  )
  return rows
}

export type ChargeResult =
  | { ok: true; invoiceId: string; number: string; amountCents: number }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'missing_note'
        | 'bad_amount'
        | 'unknown_fee_type'
        | 'forbidden'
        | 'override_forbidden'
        | 'over_limit'
      /// Set on `over_limit`: the actor's fee-waiver limit, how far they tried
      /// to depart from the schedule, and who could carry it.
      limitCents?: number
      overrideCents?: number
      escalateTo?: string | null
    }

export type ChargeInput = {
  leaseId: string
  feeType: string
  amountCents: number
  /// Required. A charge nobody wrote a reason for is the one a tenant disputes
  /// and nobody can explain — and unlike a waiver there is no reason-code list
  /// here, because what a damage fee is FOR is a sentence, not a category.
  note: string
}

/// Posts one fee onto a lease.
///
/// Through `raiseFeeInvoice`, which is the point: the charge is a `kind: 'fee'`
/// invoice, so autopay collects it, `waivableFees` lists it and
/// `waiveFeeInvoice` can void it — every tool that already exists for a fee
/// reaches this one without knowing it exists. A charge nobody can waive is the
/// defect one layer down, and it is the one B-168 has to unpick for the
/// promotional recapture.
export async function postFeeCharge(actor: Actor, input: ChargeInput): Promise<ChargeResult> {
  if (!isAdHocFeeType(input.feeType)) return { ok: false, reason: 'unknown_fee_type' }
  if (!input.note?.trim()) return { ok: false, reason: 'missing_note' }
  // A trust boundary, not a formality: a negative "charge" is a credit posted
  // through a path with no credit limit on it, and a zero one is an invoice
  // for nothing.
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, reason: 'bad_amount' }
  }

  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: { id: true, facilityId: true, status: true },
  })
  if (!lease) return { ok: false, reason: 'not_found' }

  // Every lease status is chargeable, `ended` included, and deliberately: a
  // cleaning or damage fee is discovered by walking the unit AFTER the tenant
  // has gone, which is the single most common case this exists for. Refusing
  // an ended lease would close the door on the fee this feature is most for.

  try {
    requirePermission(actor, 'fees:charge', lease.facilityId)
  } catch {
    return { ok: false, reason: 'forbidden' }
  }

  const scheduledCents = await scheduledFeeCents(lease.facilityId, input.feeType)
  const overrideCents = Math.abs(input.amountCents - (scheduledCents ?? 0))
  if (overrideCents > 0) {
    const decision = checkMonetaryAuthority(actor, 'fee_waiver', overrideCents, lease.facilityId)
    if (!decision.allowed) {
      if (decision.reason === 'forbidden') {
        return { ok: false, reason: 'override_forbidden', overrideCents }
      }
      const approver = await nextApproverRole('fee_waiver', overrideCents, decision.escalateToRank ?? 0)
      return {
        ok: false,
        reason: 'over_limit',
        limitCents: decision.limitCents,
        overrideCents,
        escalateTo: approver?.name ?? null,
      }
    }
  }

  const label = AD_HOC_FEE_LABELS[input.feeType]
  const now = new Date()

  const raised = await prisma.$transaction(async (tx) => {
    const created = await raiseFeeInvoice(tx, {
      facilityId: lease.facilityId,
      leaseId: lease.id,
      on: now,
      ledgerDescription: label,
      lines: [{ description: `${label} — ${input.note.trim()}`, amountCents: input.amountCents }],
    })

    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: lease.facilityId,
        action: 'fee.charged',
        entityType: 'Invoice',
        entityId: created.id,
        reasonCode: input.note.trim(),
        context: {
          leaseId: lease.id,
          feeType: input.feeType,
          amountCents: input.amountCents,
          // Both figures, always: "was this the facility's price or somebody's
          // judgement" is the question a disputed charge turns on, and a log
          // that records only what was charged cannot answer it.
          scheduledCents,
          overrideCents,
        },
      },
      tx,
    )

    return created
  })

  return { ok: true, invoiceId: raised.id, number: raised.number, amountCents: input.amountCents }
}

/// B-167. The pass-through costs the notice pipeline incurs, posted as they are
/// incurred rather than waiting for somebody to remember them.
///
/// Separate from `postFeeCharge` because there is no actor and no override to
/// authorise: the facility's own schedule is the amount, the system is what
/// noticed, and a cost the operator has already paid the post office is not a
/// discretionary charge. A facility that has priced the type at nothing charges
/// nothing, which is how an operator opts out.
///
/// Why it matters that this is automatic: `claimForLease` builds the lien
/// claim from open invoices plus uninvoiced ledger charges, so a cost posted
/// here is in the next notice's claim and in the cure quote by construction.
/// Left to a staff member to post by hand, it is the line that is always
/// missing — and Texas Property Code Ch. 59 lets the operator recover it
/// (D-10: Texas default, per-state configurable, draft-only and not legal
/// advice).
export async function postIncurredNoticeCost(
  input: {
    facilityId: string
    leaseId: string
    feeType: Extract<AdHocFeeType, 'lien' | 'certified_mail'>
    /// What it was for, in the tenant's words: "Lien notice, tracking
    /// 9407…". The invoice line is what they read.
    description: string
    on?: Date
  },
  client: Parameters<typeof raiseFeeInvoice>[0] | null = null,
): Promise<{ number: string; amountCents: number } | null> {
  const amountCents = await scheduledFeeCents(input.facilityId, input.feeType, input.on ?? new Date())
  if (amountCents === null) return null

  const label = AD_HOC_FEE_LABELS[input.feeType]
  const post = (tx: Parameters<typeof raiseFeeInvoice>[0]) =>
    raiseFeeInvoice(tx, {
      facilityId: input.facilityId,
      leaseId: input.leaseId,
      on: input.on ?? new Date(),
      ledgerDescription: label,
      lines: [{ description: `${label} — ${input.description}`, amountCents }],
    })

  const raised = client ? await post(client) : await prisma.$transaction(post)
  return { number: raised.number, amountCents }
}

/// Leases this tenant has that a fee can be posted against, newest first.
///
/// Ended leases are included and labelled, because the move-out walk that finds
/// the damage happens after the lease closes — see `postFeeCharge`.
export async function chargeableLeases(
  tenantId: string,
): Promise<{ leaseId: string; facilityId: string; facilityName: string; unitNumber: string; ended: boolean }[]> {
  const leases = await prisma.lease.findMany({
    where: { tenantId },
    orderBy: [{ startDate: 'desc' }],
    select: {
      id: true,
      status: true,
      facilityId: true,
      facility: { select: { name: true } },
      unit: { select: { number: true } },
    },
  })

  return leases.map((lease) => ({
    leaseId: lease.id,
    facilityId: lease.facilityId,
    facilityName: lease.facility.name,
    unitNumber: lease.unit?.number ?? '—',
    ended: !OCCUPYING_LEASE_STATUSES.includes(lease.status as never),
  }))
}
