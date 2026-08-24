import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { emitEvent } from '@storage/core/events'
import { businessDateFor, daysBetween, reminderStage } from '@storage/core/jobs'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { createTask } from '@/lib/admin/tasks'
import { stripeClient } from '@/lib/payments/stripe'
import { currentPlans } from '@/lib/protection/plans'
import { leaseSuccessorIds } from '@/lib/billing/transfer-chain'

// B-043 / PRD 02 FR-4's two pre-emptive scans, and PRD 05 CN-10a.
//
// Both are the same shape and exist for the same reason: something on a lease
// runs out on a date we already know, and the cheap moment to act is before it
// does. A card that expires silently becomes a failed autopay, a dunning step
// and a delinquency the tenant never earned. A proof of insurance that lapses
// silently becomes a coverage argument after the unit floods.
//
// Neither scan sends anything. They emit events; the notices are B-050's, the
// dunning ladder is B-052's. That is PRD 05 CN-3's rule applied early — comms
// react to billing events and never run a calendar of their own.

type RecordItem = (outcome: { itemId: string; ok: boolean; message?: string }) => void

/// CN-10a: "cards expiring within 30 days, retrigger at 7". Two sends, not
/// thirty — `reminderStage` picks which one a given day is, and the dedupe
/// below is what keeps it to one per stage.
export const CARD_EXPIRY_STAGES = [30, 7] as const

/// D-17: "notice at 30 days before the recorded proof expires, then enrolment
/// when it lapses". One reminder, then the lapse itself does the rest.
export const PROOF_EXPIRY_STAGES = [30] as const

/// Business dates already notified, keyed by `${entityId}:${subject}:${stage}`.
///
/// The record of "already told them" is the event outbox itself rather than a
/// column on anything — these events exist regardless, they are immutable, and
/// a flag on the lease would have to be reset by hand every time a tenant
/// renewed. `subject` is the payment-method id or the waiver's expiry date,
/// which is what makes replacement suppress the retrigger for free: a new card
/// is a new id and a renewed policy is a new expiry, so neither matches a key
/// that was already sent.
async function alreadyNotified(
  eventName: string,
  entityIds: readonly string[],
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set()
  const events = await prisma.domainEvent.findMany({
    where: { name: eventName, entityId: { in: [...entityIds] } },
    select: { entityId: true, payload: true },
  })
  const sent = new Set<string>()
  for (const event of events) {
    const payload = (event.payload ?? {}) as { subject?: unknown; stage?: unknown }
    sent.add(`${event.entityId}:${String(payload.subject)}:${String(payload.stage)}`)
  }
  return sent
}

/// The last day a card works. Cards are valid through the END of their expiry
/// month, not the 1st — treating `exp_month` as the expiry day would fire every
/// notice a month early and tell a tenant with a working card that it had run
/// out.
function cardExpiryDate(expMonth: number, expYear: number): Date {
  return new Date(Date.UTC(expYear, expMonth, 0))
}

/// Tenants at this facility whose saved default card runs out soon.
///
/// Scoped to tenants with an occupying lease HERE, so a tenant renting at two
/// facilities is scanned by each — and the dedupe key is the tenant and the
/// card, not the facility, so they are still told once rather than twice.
export async function scanExpiringCards(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<void> {
  const stripe = stripeClient()
  if (!stripe) {
    // Honest no-op rather than a failed run: this project has no Stripe key
    // outside production, and a red run every night for a missing key trains
    // people to ignore the screen that exists to be noticed.
    recordItem({ itemId: facilityId, ok: true, message: 'skipped — Stripe is not configured' })
    return
  }

  const leases = await prisma.lease.findMany({
    where: { facilityId, status: { in: [...OCCUPYING_LEASE_STATUSES] } },
    select: {
      tenantId: true,
      tenant: { select: { stripeCustomerId: true, stripeDefaultPaymentMethodId: true } },
    },
  })

  const tenants = new Map<string, string>()
  for (const lease of leases) {
    const methodId = lease.tenant.stripeDefaultPaymentMethodId
    if (methodId && lease.tenant.stripeCustomerId) tenants.set(lease.tenantId, methodId)
  }
  if (tenants.size === 0) return

  const sent = await alreadyNotified('payment_method.expiring', [...tenants.keys()])

  for (const [tenantId, methodId] of tenants) {
    let expMonth: number | undefined
    let expYear: number | undefined
    try {
      const method = await stripe.paymentMethods.retrieve(methodId)
      expMonth = method.card?.exp_month
      expYear = method.card?.exp_year
    } catch (error) {
      // One unreachable card must not stop the other 799 — that is what
      // `partial` runs are for (B-006's runner).
      recordItem({
        itemId: tenantId,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    if (!expMonth || !expYear) continue

    const stage = reminderStage(
      daysBetween(businessDate, cardExpiryDate(expMonth, expYear)),
      CARD_EXPIRY_STAGES,
    )
    if (stage === null) continue
    if (sent.has(`${tenantId}:${methodId}:${stage}`)) continue

    await emitEvent({
      name: 'payment_method.expiring',
      entityType: 'Tenant',
      entityId: tenantId,
      facilityId,
      payload: {
        subject: methodId,
        stage,
        expMonth,
        expYear,
      },
    })
    recordItem({ itemId: tenantId, ok: true, message: `card expiring, ${stage}-day notice` })
  }
}

/// Waivers whose proof of insurance runs out soon, and D-17's enrolment on
/// lapse.
///
/// Only leases still on the waiver path are scanned: a lease with a
/// `protectionPlanName` is already covered by a plan we sell, so its old
/// waiver is history rather than a live obligation. That is also what stops an
/// auto-enrolled lease being enrolled again the following night.
export async function scanExpiringProtectionProofs(
  facilityId: string,
  businessDate: Date,
  recordItem: RecordItem,
): Promise<void> {
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { timezone: true, autoEnrolProtectionOnLapse: true, defaultProtectionTier: true },
  })

  const waivers = await prisma.protectionWaiver.findMany({
    where: { facilityId, leaseId: { not: null }, expiresAt: { not: null } },
    select: { id: true, leaseId: true, expiresAt: true },
  })
  if (waivers.length === 0) return

  const leases = await prisma.lease.findMany({
    where: {
      id: { in: waivers.map((waiver) => waiver.leaseId!) },
      status: { in: [...OCCUPYING_LEASE_STATUSES] },
      protectionPlanName: null,
    },
    select: { id: true, tenantId: true },
  })
  const live = new Map(leases.map((lease) => [lease.id, lease]))

  // B-163. The waivers whose lease is no longer occupying, followed forward.
  //
  // `completeTransfer` re-points a waiver now, so nothing NEW lands here — but
  // every waiver on a lease transferred before that shipped is still stranded,
  // and a future writer that opens a lease from another and forgets would
  // re-open the hole in silence. This is both the repair and the backstop, on
  // B-151's reasoning: a nightly job that fixes what it finds cannot be
  // forgotten the way a one-off script can, and it costs one extra query on
  // the nights there is nothing to fix.
  const stranded = waivers.filter((waiver) => !live.has(waiver.leaseId!))
  const rehomed = stranded.length > 0 ? await rehomeStrandedWaivers(facilityId, stranded) : []
  for (const moved of rehomed) {
    live.set(moved.leaseId, { id: moved.leaseId, tenantId: moved.tenantId })
    const waiver = waivers.find((one) => one.id === moved.waiverId)
    if (waiver) waiver.leaseId = moved.leaseId
    recordItem({
      itemId: moved.leaseId,
      ok: true,
      message: 'proof of insurance re-attached to the lease the tenant transferred into',
    })
  }

  const scannable = waivers.filter((waiver) => live.has(waiver.leaseId!))
  if (scannable.length === 0) return

  const sent = await alreadyNotified(
    'protection.proof_expiring',
    scannable.map((waiver) => waiver.leaseId!),
  )

  for (const waiver of scannable) {
    const leaseId = waiver.leaseId!
    const expiryDate = businessDateFor(waiver.expiresAt!, facility.timezone)
    const daysUntil = daysBetween(businessDate, expiryDate)
    if (daysUntil >= 0) {
      const stage = reminderStage(daysUntil, PROOF_EXPIRY_STAGES)
      if (stage === null) continue
      // The subject is the expiry date, not the waiver id: `recordWaiver`
      // updates the row in place when a tenant renews, so keying on the id
      // alone would suppress next year's notice on the same waiver.
      const key = `${leaseId}:${expiryDate.toISOString()}:${stage}`
      if (sent.has(key)) continue

      await emitEvent({
        name: 'protection.proof_expiring',
        entityType: 'Lease',
        entityId: leaseId,
        facilityId,
        payload: { subject: expiryDate.toISOString(), stage, expiresOn: expiryDate.toISOString().slice(0, 10) },
      })
      recordItem({ itemId: leaseId, ok: true, message: `proof expiring, ${stage}-day notice` })
      continue
    }

    // Lapsed. A task either way — with auto-enrolment off it is the entire
    // mechanism, and with it on somebody still has to know a tenant just
    // started being charged. Guarded on an existing OPEN task rather than
    // createTask's per-business-date idempotency, which would otherwise raise a
    // fresh one every night for as long as the proof stayed lapsed.
    const open = await prisma.task.findFirst({
      where: { type: 'insurance_proof_lapsed', entityId: leaseId, status: 'open' },
      select: { id: true },
    })
    if (!open) {
      await createTask({
        facilityId,
        type: 'insurance_proof_lapsed',
        entityType: 'Lease',
        entityId: leaseId,
        priority: 'high',
      })
    }

    const enrolled = await enrolOnLapse(facilityId, leaseId, waiver, facility, businessDate)
    recordItem({
      itemId: leaseId,
      ok: true,
      message: enrolled ?? (open ? 'proof lapsed, task already open' : 'proof lapsed, task raised'),
    })
  }
}

/// B-163. Moves a waiver stranded on an ended lease onto the live lease the
/// tenant transferred into, and reports the ones it moved.
///
/// Only leases that are still occupying and still on the waiver path are
/// candidates: a lease carrying a `protectionPlanName` is covered by a plan we
/// sell, so an old waiver on it is history rather than a live obligation —
/// the same rule the scan itself applies.
async function rehomeStrandedWaivers(
  facilityId: string,
  stranded: { id: string; leaseId: string | null }[],
): Promise<{ waiverId: string; leaseId: string; tenantId: string }[]> {
  const chains = await leaseSuccessorIds(stranded.map((waiver) => waiver.leaseId!))
  const successorIds = [...new Set([...chains.values()].flat())]
  const candidates = await prisma.lease.findMany({
    where: {
      id: { in: successorIds },
      facilityId,
      status: { in: [...OCCUPYING_LEASE_STATUSES] },
      protectionPlanName: null,
    },
    select: { id: true, tenantId: true },
  })
  if (candidates.length === 0) return []
  const byId = new Map(candidates.map((lease) => [lease.id, lease]))

  // A successor that recorded its own waiver keeps it: `leaseId` is unique, and
  // the tenant's newer certificate is the one that means anything.
  const taken = new Set(
    (
      await prisma.protectionWaiver.findMany({
        where: { leaseId: { in: candidates.map((lease) => lease.id) } },
        select: { leaseId: true },
      })
    ).map((waiver) => waiver.leaseId!),
  )

  const moved: { waiverId: string; leaseId: string; tenantId: string }[] = []
  for (const waiver of stranded) {
    // `leaseSuccessorIds` returns each chain newest LAST, and the tenant is at
    // the end of it — the only lease they are actually in today.
    const chain = chains.get(waiver.leaseId!) ?? []
    const target = [...chain].reverse().find((id) => byId.has(id) && !taken.has(id))
    if (!target) continue
    await prisma.protectionWaiver.update({ where: { id: waiver.id }, data: { leaseId: target } })
    taken.add(target)
    moved.push({ waiverId: waiver.id, leaseId: target, tenantId: byId.get(target)!.tenantId })
  }
  return moved
}

/// D-17's enrolment. Returns a message when it charged, null when it did not.
async function enrolOnLapse(
  facilityId: string,
  leaseId: string,
  waiver: { id: string; expiresAt: Date | null },
  facility: { autoEnrolProtectionOnLapse: boolean; defaultProtectionTier: string | null },
  businessDate: Date,
): Promise<string | null> {
  if (!facility.autoEnrolProtectionOnLapse || !facility.defaultProtectionTier) return null

  // The premium in force on the business date being run, not today's — a
  // catch-up run for last Tuesday must charge last Tuesday's price (FR-9).
  const plan = (await currentPlans(facilityId, businessDate)).find(
    (option) => option.tier === facility.defaultProtectionTier,
  )
  if (!plan) {
    // Configured tier no longer on sale. Refusing to guess a price is the only
    // safe branch: the task raised above is already open, and a person picks.
    return 'proof lapsed, configured tier is not on sale — not enrolled'
  }

  await prisma.$transaction(async (tx) => {
    await tx.lease.update({
      where: { id: leaseId },
      data: { protectionPlanName: plan.name, protectionCents: plan.premiumCents },
    })
    await recordAudit(
      {
        actor: { type: 'system', label: 'billing scheduler' },
        action: 'lease.protection_auto_enrolled',
        entityType: 'Lease',
        entityId: leaseId,
        facilityId,
        context: {
          waiverId: waiver.id,
          proofExpiredOn: waiver.expiresAt?.toISOString().slice(0, 10) ?? null,
          tier: plan.tier,
          planName: plan.name,
          premiumCents: plan.premiumCents,
        },
      },
      tx,
    )
    await emitEvent(
      {
        name: 'protection.auto_enrolled',
        entityType: 'Lease',
        entityId: leaseId,
        facilityId,
        payload: { planName: plan.name, premiumCents: plan.premiumCents, tier: plan.tier },
      },
      tx,
    )
  })

  return `proof lapsed, enrolled in ${plan.name}`
}
