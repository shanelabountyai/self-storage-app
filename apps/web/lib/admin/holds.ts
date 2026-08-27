import { prisma, type Prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { MANAGER_RANK } from '@storage/core/pos'
import {
  effectsOf,
  holdIsActive,
  holdTypeSpec,
  type HoldEffect,
} from '@storage/core/holds'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 02 §4.4 US-42 (B-096). Placing, lifting and reading lease holds.
//
// Every consumer asks `leaseHasEffect` rather than looking at the type, which
// is US-42's own requirement: "a new hold type is a configuration row, not six
// code changes." The catalog in packages/core/holds is the configuration.

const HOLD_SELECT = {
  id: true,
  type: true,
  effectiveFrom: true,
  effectiveTo: true,
  liftedAt: true,
} as const

/// Whether a lease is under a hold declaring this effect right now.
///
/// The single question every automated consumer asks — the late-fee run, the
/// autopay run, B-098's access gate, and the dunning ladder when B-052 lands.
/// Takes a transaction client so a caller inside one sees its own writes.
export async function leaseHasEffect(
  leaseId: string,
  effect: HoldEffect,
  asOf: Date = new Date(),
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  const holds = await client.leaseHold.findMany({
    where: { leaseId, liftedAt: null },
    select: HOLD_SELECT,
  })
  return effectsOf(holds, asOf).has(effect)
}

/// B-195. Every hold in force on each of many leases, keyed by lease.
///
/// `activeHolds` answers this for ONE lease and joins the staff row for the
/// banner; a report over a portfolio needs the same facts for hundreds of
/// leases and none of the banner ones, so this is one query returning only
/// what a roll-up reads — including the TYPE, which `effectsByLease` throws
/// away. Naming the halting reason is the whole point of B-195: "halted" with
/// no reason beside it is the same dead end as no split at all.
///
/// Leases with no hold in force are absent rather than present with an empty
/// list — the callers both ask "is there one", and a map of mostly-empty
/// arrays over a portfolio is a lot of nothing.
export type HoldInForce = {
  id: string
  type: string
  /// The catalog's operator-facing name, falling back to the raw type so an
  /// unknown one is visible rather than blank.
  label: string
  effects: readonly HoldEffect[]
  effectiveFrom: Date
  effectiveTo: Date | null
  reason: string
}

export async function activeHoldsByLease(
  leaseIds: readonly string[],
  asOf: Date = new Date(),
): Promise<Map<string, HoldInForce[]>> {
  if (leaseIds.length === 0) return new Map()
  const rows = await prisma.leaseHold.findMany({
    where: { leaseId: { in: [...leaseIds] }, liftedAt: null },
    select: { ...HOLD_SELECT, leaseId: true, reason: true },
    orderBy: { effectiveFrom: 'asc' },
  })

  const byLease = new Map<string, HoldInForce[]>()
  for (const row of rows) {
    if (!holdIsActive(row, asOf)) continue
    const spec = holdTypeSpec(row.type)
    const list = byLease.get(row.leaseId) ?? []
    list.push({
      id: row.id,
      type: row.type,
      label: spec?.label ?? row.type,
      effects: spec?.effects ?? [],
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      reason: row.reason,
    })
    byLease.set(row.leaseId, list)
  }
  return byLease
}

/// The same question for many leases at once, so a nightly run over 800 leases
/// is one query rather than 800.
export async function effectsByLease(
  leaseIds: readonly string[],
  effect: HoldEffect,
  asOf: Date = new Date(),
): Promise<Set<string>> {
  const byLease = await activeHoldsByLease(leaseIds, asOf)
  const held = new Set<string>()
  for (const [leaseId, holds] of byLease) {
    if (holds.some((hold) => hold.effects.includes(effect))) held.add(leaseId)
  }
  return held
}

export type ActiveHold = {
  id: string
  type: string
  label: string
  bannerNote: string
  effects: readonly HoldEffect[]
  reason: string
  effectiveFrom: Date
  effectiveTo: Date | null
  placedByName: string
  liftRequiresManager: boolean
  estateContactName: string | null
  estateContactPhone: string | null
  estateContactEmail: string | null
}

/// Every hold in force on a lease, for the banner US-42 requires.
export async function activeHolds(leaseId: string, asOf: Date = new Date()): Promise<ActiveHold[]> {
  const rows = await prisma.leaseHold.findMany({
    where: { leaseId, liftedAt: null },
    orderBy: { effectiveFrom: 'asc' },
    include: { placedByStaff: { select: { firstName: true, lastName: true } } },
  })

  return rows
    .filter((row) => holdIsActive(row, asOf))
    .map((row) => {
      const spec = holdTypeSpec(row.type)
      return {
        id: row.id,
        type: row.type,
        label: spec?.label ?? row.type,
        bannerNote: spec?.bannerNote ?? 'This account is on hold.',
        effects: spec?.effects ?? [],
        reason: row.reason,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        // B-121: no staff row means the system raised it off the tenant's own
        // declaration. Named as that rather than left blank or shown as
        // "Unknown" — a hold nobody appears to have placed is the kind of thing
        // a manager lifts to find out what it was.
        placedByName: row.placedByStaff
          ? `${row.placedByStaff.firstName} ${row.placedByStaff.lastName}`
          : 'Automatically, from the tenant’s declaration',
        liftRequiresManager: spec?.liftRequiresManager ?? false,
        estateContactName: row.estateContactName,
        estateContactPhone: row.estateContactPhone,
        estateContactEmail: row.estateContactEmail,
      }
    })
}

export type PlaceHoldInput = {
  type: string
  reason: string
  effectiveFrom?: Date
  effectiveTo?: Date | null
  documentId?: string | null
  estateContactName?: string | null
  estateContactPhone?: string | null
  estateContactEmail?: string | null
}

export type HoldResult =
  | { ok: true; holdId: string }
  | { ok: false; reason: 'unknown_type' | 'missing_reason' | 'missing_estate_contact' | 'forbidden' | 'not_found' | 'already_lifted' | 'needs_manager' }

/// Places a hold. Audited, always.
///
/// `tenants:edit` at the lease's facility is the gate for placing: US-42 does
/// not require a manager to place one, and it should not — the counter staffer
/// who takes the call from a deploying servicemember is exactly the person who
/// should be able to stop collections that night. Lifting is where the
/// restriction lives.
export async function placeHold(
  actor: Actor,
  leaseId: string,
  input: PlaceHoldInput,
  // B-090 part 3. Optional so a caller building a bigger transaction around
  // this — payment-plan creation places the hold and the schedule together —
  // can pass its own `tx` and get one atomic write instead of two. Same
  // parameter shape as `leaseHasEffect` above, for the same reason.
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<HoldResult> {
  if (actor.kind !== 'staff') return { ok: false, reason: 'forbidden' }

  const spec = holdTypeSpec(input.type)
  if (!spec) return { ok: false, reason: 'unknown_type' }
  if (!input.reason?.trim()) return { ok: false, reason: 'missing_reason' }
  // US-42: the deceased type records an estate contact. Enforced rather than
  // hinted, because the whole point of that type is that there is somebody
  // else to talk to and nobody wrote down who.
  if (spec.requiresEstateContact && !input.estateContactName?.trim()) {
    return { ok: false, reason: 'missing_estate_contact' }
  }

  const lease = await client.lease.findUnique({
    where: { id: leaseId },
    select: { facilityId: true },
  })
  if (!lease) return { ok: false, reason: 'not_found' }

  assertFacilityAccess(actor, lease.facilityId)
  if (!can(actor, 'tenants:edit', lease.facilityId)) {
    throw new ForbiddenError('Missing permission to place a hold', 'tenants:edit', lease.facilityId)
  }

  const write = async (tx: Prisma.TransactionClient | typeof prisma) => {
    const created = await tx.leaseHold.create({
      data: {
        leaseId,
        type: input.type,
        reason: input.reason.trim(),
        effectiveFrom: input.effectiveFrom ?? new Date(),
        effectiveTo: input.effectiveTo ?? null,
        documentId: input.documentId ?? null,
        placedByStaffId: actor.staffUserId,
        estateContactName: input.estateContactName?.trim() || null,
        estateContactPhone: input.estateContactPhone?.trim() || null,
        estateContactEmail: input.estateContactEmail?.trim() || null,
      },
    })

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'hold.placed',
        entityType: 'Lease',
        entityId: leaseId,
        facilityId: lease.facilityId,
        reasonCode: input.type,
        context: {
          holdId: created.id,
          type: input.type,
          effects: spec.effects,
          reason: input.reason.trim(),
          effectiveTo: input.effectiveTo?.toISOString() ?? null,
        },
      },
      tx,
    )

    return created
  }

  // Prisma cannot nest an interactive transaction inside another — if the
  // caller already handed us one, write directly in it rather than opening a
  // second.
  const hold = client === prisma ? await prisma.$transaction((tx) => write(tx)) : await write(client)

  return { ok: true, holdId: hold.id }
}

/// Lifts a hold early.
///
/// US-42: "lifting a `military_scra` or `bankruptcy` hold requires
/// manager-or-above." That is per hold TYPE, declared in the catalog rather
/// than checked against a list here — the same rule as everything else in this
/// module, so a new type that needs the restriction gets it by saying so.
export async function liftHold(
  actor: Actor,
  holdId: string,
  liftReason: string,
): Promise<HoldResult> {
  if (actor.kind !== 'staff') return { ok: false, reason: 'forbidden' }
  if (!liftReason?.trim()) return { ok: false, reason: 'missing_reason' }

  const hold = await prisma.leaseHold.findUnique({
    where: { id: holdId },
    select: { ...HOLD_SELECT, leaseId: true, lease: { select: { facilityId: true } } },
  })
  if (!hold) return { ok: false, reason: 'not_found' }
  if (hold.liftedAt) return { ok: false, reason: 'already_lifted' }

  const facilityId = hold.lease.facilityId
  assertFacilityAccess(actor, facilityId)
  if (!can(actor, 'tenants:edit', facilityId)) {
    throw new ForbiddenError('Missing permission to lift a hold', 'tenants:edit', facilityId)
  }

  const spec = holdTypeSpec(hold.type)
  if (spec?.liftRequiresManager) {
    const rank = Math.max(
      ...actor.assignments
        .filter((assignment) => assignment.facilityId === null || assignment.facilityId === facilityId)
        .map((assignment) => assignment.rank),
      0,
    )
    if (rank < MANAGER_RANK) return { ok: false, reason: 'needs_manager' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.leaseHold.update({
      where: { id: holdId },
      data: { liftedAt: new Date(), liftedByStaffId: actor.staffUserId, liftReason: liftReason.trim() },
    })

    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'hold.lifted',
        entityType: 'Lease',
        entityId: hold.leaseId,
        facilityId,
        reasonCode: 'management_approval',
        context: { holdId, type: hold.type, liftReason: liftReason.trim() },
      },
      tx,
    )
  })

  return { ok: true, holdId }
}

/// Lifts a hold as the automatic consequence of something else, not a staff
/// decision — a payment plan breaking its own schedule, or finishing it. No
/// actor, no permission check and no manager gate: nobody is exercising
/// discretion, a fact about the schedule already happened and the hold is
/// just catching up to it. `reasonCode` still records WHICH fact, the same
/// way `placeHold` uses the hold type — `payment_plan_broken` reads
/// differently from `payment_plan_completed` on the same audit action.
///
/// A no-op, not an error, on an already-lifted hold: the nightly job that
/// calls this can be re-run over a catch-up range, and a hold a person lifted
/// in between must not spring back with a fresh `liftedAt`.
export async function systemLiftHold(holdId: string, label: string, reasonCode: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const hold = await tx.leaseHold.findUnique({
      where: { id: holdId },
      select: { leaseId: true, type: true, liftedAt: true, lease: { select: { facilityId: true } } },
    })
    if (!hold || hold.liftedAt) return

    await tx.leaseHold.update({
      where: { id: holdId },
      data: { liftedAt: new Date(), liftedByStaffId: null, liftReason: reasonCode },
    })

    await recordAudit(
      {
        actor: { type: 'system', label },
        action: 'hold.lifted',
        entityType: 'Lease',
        entityId: hold.leaseId,
        facilityId: hold.lease.facilityId,
        reasonCode,
        context: { holdId, type: hold.type },
      },
      tx,
    )
  })
}
