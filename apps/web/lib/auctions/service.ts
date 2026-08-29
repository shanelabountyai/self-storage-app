import { prisma, type SurplusDisposition } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import {
  auctionReadiness,
  canRecordDisposition,
  distribute,
  ledgerPostings,
  missingBuyerFields,
  surplusHoldUntil,
  surplusObligation,
  type Blocker,
  type BuyerRecordInput,
  type Readiness,
  type StepEvidence,
} from '@storage/core/auctions'
import { selectListableLots, type LotRefusal } from '@storage/core/auctions'
import { orderedSteps, type TimelineStep } from '@storage/core/delinquency'
import { requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { recomputeUnitStatus } from '@/lib/admin/units'
import { releaseOverlock } from '@/lib/delinquency/overlock'
import { effectsByLease } from '@/lib/admin/holds'
import { allChainIds, leaseSuccessorIds } from '@/lib/billing/transfer-chain'
import { storeGeneratedDocument } from '@/lib/documents/store'
import { formatCents } from '@/lib/format'

// PRD 02 §4.6 US-28 (B-062). The auction pipeline.
//
// Every refusal in this file is a hard block with no override, because each one
// is a line in a wrongful-sale complaint: a vehicle run through the standard
// path, a step with no proof behind it, a sale with no served notice, a surplus
// nobody dispositioned. The rules themselves live in packages/core/auctions and
// are exhaustively tested there; this file gathers the facts and writes the
// consequences.

/// Regional. Higher than MANAGER_RANK (20) — US-28 says "regional/owner
/// approval", and a site manager approving the sale of their own site's tenant
/// is exactly the check this is.
const REGIONAL_RANK = 30

/// Every lease this case's claim now spans: the lease the served notice named,
/// plus any lease the tenant was transferred into afterwards.
///
/// B-157 / D-85. The case itself stays pinned to the original lease and unit —
/// that is what keeps the file honest about which unit was served — but D-86
/// moves the unpaid invoices onto the new lease when staff transfer somebody
/// out of the pipeline. Reading only the pinned lease therefore reported a
/// balance of zero, and `auctionReadiness` raised `balance_settled` on a
/// tenant who still owed the entire claim. The money and the holds follow the
/// tenant; the evidence stays where it happened.
async function claimLeaseIds(leaseId: string): Promise<string[]> {
  return allChainIds(await leaseSuccessorIds([leaseId]))
}

/// The same forward walk, but keeping the ORDER as well as the set: where the
/// tenant and their goods are now, as against where the served notice says they
/// were.
///
/// B-160 / D-91. `leaseSuccessorIds` returns each chain newest last, so the
/// tail is the lease the tenant actually holds — and its unit is the unit
/// somebody has to open. Nothing is stored: a `currentUnitId` column would be a
/// second answer to a question the chain already answers, and the two would
/// drift the first time a transfer path forgot to write it.
async function claimChain(leaseId: string): Promise<{ ids: string[]; currentLeaseId: string }> {
  const chains = await leaseSuccessorIds([leaseId])
  const ordered = chains.get(leaseId) ?? [leaseId]
  return { ids: allChainIds(chains), currentLeaseId: ordered[ordered.length - 1] ?? leaseId }
}

function rankAt(actor: Actor, facilityId: string): number {
  if (actor.kind !== 'staff') return 0
  return Math.max(
    0,
    ...actor.assignments
      .filter((one) => one.facilityId === null || one.facilityId === facilityId)
      .map((one) => one.rank),
  )
}

/// Opens (or returns) the live case for a lease the delinquency engine has
/// flagged. Idempotent: the partial unique index allows one live case per
/// lease, so a re-run of the timeline does not open a second.
export async function openAuctionCase(input: {
  leaseId: string
  facilityId: string
}): Promise<{ id: string; created: boolean } | null> {
  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: { unitId: true, delinquencyTimelineId: true },
  })
  if (!lease?.unitId) return null

  const existing = await prisma.auctionCase.findFirst({
    where: { leaseId: input.leaseId, status: { in: ['eligible', 'scheduled'] } },
    select: { id: true },
  })
  if (existing) return { id: existing.id, created: false }

  try {
    const created = await prisma.auctionCase.create({
      data: {
        facilityId: input.facilityId,
        leaseId: input.leaseId,
        unitId: lease.unitId,
        timelineId: lease.delinquencyTimelineId,
      },
      select: { id: true },
    })
    return { id: created.id, created: true }
  } catch {
    // Lost the race for the partial unique index — somebody else opened it,
    // which is the outcome we wanted.
    const row = await prisma.auctionCase.findFirst({
      where: { leaseId: input.leaseId, status: { in: ['eligible', 'scheduled'] } },
      select: { id: true },
    })
    return row ? { id: row.id, created: false } : null
  }
}

export type AuctionCaseView = {
  id: string
  facilityId: string
  leaseId: string
  /// B-160 / D-91. `unitId`/`unitNumber` are where the goods are NOW — the unit
  /// staff have to open, advertise and cut a lock on. The unit the served
  /// notice named is `noticeUnitId`/`noticeUnitNumber`, and it is what the case
  /// stays pinned to (B-157). They differ only after a D-85 transfer out of the
  /// pipeline, which `goodsMoved` says in one boolean.
  ///
  /// This way round on purpose: a reader that has not been told about the split
  /// names the unit somebody should walk to, rather than one that was re-rented
  /// three weeks ago.
  unitId: string
  unitNumber: string
  noticeUnitId: string
  noticeUnitNumber: string
  goodsMoved: boolean
  /// The lease the claim now sits on — where D-86 moved the unpaid invoices,
  /// and therefore where a sale's proceeds have to post.
  currentLeaseId: string
  tenantId: string
  tenantName: string
  status: string
  containsVehicle: boolean
  vehicleNote: string | null
  approvedAt: Date | null
  approvedByName: string | null
  scheduledSaleDate: Date | null
  outstandingCents: number
  readiness: Readiness
  /// US-29: "shows the configured timeline summary on every auction approval
  /// screen." The version pinned to this case, not whatever is current.
  timelineLabel: string | null
  timelineVersion: number | null
  steps: (StepEvidence & { blocked: boolean })[]
  advertisements: { id: string; publication: string; runDate: Date; reference: string | null }[]
  lockCutAt: Date | null
  inventoryDocumentId: string | null
  sale: {
    soldAt: Date | null
    grossProceedsCents: number | null
    saleCostsCents: number | null
    costsRecoveredCents: number | null
    appliedToLienCents: number | null
    surplusCents: number | null
    deficiencyCents: number | null
  }
  surplus: {
    disposition: SurplusDisposition
    holdUntil: Date | null
    notifiedAt: Date | null
    note: string | null
    outstanding: boolean
    outstandingActions: string[]
    overdue: boolean
  }
  cancelledAt: Date | null
  cancelledReason: string | null
}

/// One case, with its readiness computed from real evidence.
export async function auctionCase(actor: Actor, caseId: string): Promise<AuctionCaseView | null> {
  const row = await prisma.auctionCase.findUnique({
    where: { id: caseId },
    include: {
      unit: { select: { number: true } },
      timeline: { select: { label: true, version: true, steps: true } },
      advertisements: { orderBy: { runDate: 'asc' } },
      lease: {
        select: {
          tenantId: true,
          tenant: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })
  if (!row) return null
  requirePermission(actor, 'tenants:view', row.facilityId)

  // The balance and the holds span the whole chain; the evidence below does
  // not, and must not (B-157). See `claimLeaseIds`.
  const { ids: claimIds, currentLeaseId } = await claimChain(row.leaseId)
  const goodsMoved = currentLeaseId !== row.leaseId
  // Only when they differ — the overwhelmingly common case is one lease, and
  // it should not cost a second query.
  const currentLease = goodsMoved
    ? await prisma.lease.findUnique({
        where: { id: currentLeaseId },
        select: { unitId: true, unit: { select: { number: true } } },
      })
    : null

  const [ledger, stepRuns, servedLienNotice, approver, blockedByHold] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: { leaseId: { in: claimIds } },
      _sum: { amountCents: true },
    }),
    prisma.delinquencyStepRun.findMany({
      where: { leaseId: row.leaseId, supersededAt: null },
      select: { dayOffset: true, taskId: true },
    }),
    // B-061. A generated AND served lien notice, not merely generated, and not
    // one that has since been superseded by a correction.
    //
    // Read against the CURRENT lease, not the pinned one (B-160 / D-91). A
    // §59 notice names the space, so once the goods have been moved to another
    // unit the notice that was served describes somewhere they are no longer —
    // and the owner's answer was that it has to be re-served. Nothing else
    // changes to make that hold: a notice on a lease that no longer exists in
    // the chain's tail simply is not found, and the blocker below says why.
    prisma.notice.findFirst({
      where: { leaseId: currentLeaseId, type: 'lien', status: 'delivered', supersededAt: null },
      select: { id: true },
    }),
    row.approvedByStaffId
      ? prisma.staffUser.findUnique({
          where: { id: row.approvedByStaffId },
          select: { firstName: true, lastName: true },
        })
      : null,
    // Across the chain too: a hold placed AFTER a transfer lands on the lease
    // the tenant now holds, and a case reading only the original would let an
    // SCRA, bankruptcy, deceased or litigation hold fail open — the one
    // blocker on this list where proceeding is a federal matter.
    effectsByLease(claimIds, 'block_auction').then((leases) => leases.size > 0),
  ])

  const taskIds = stepRuns.map((run) => run.taskId).filter((id): id is string => !!id)
  const tasks = taskIds.length
    ? await prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, status: true, proof: true },
      })
    : []
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const runByDay = new Map(stepRuns.map((run) => [run.dayOffset, run]))

  const timelineSteps = orderedSteps((row.timeline?.steps ?? []) as unknown as TimelineStep[])
  const steps: StepEvidence[] = timelineSteps.map((step) => {
    const run = runByDay.get(step.dayOffset)
    const task = run?.taskId ? taskById.get(run.taskId) : undefined
    return {
      dayOffset: step.dayOffset,
      label: step.label,
      staffTaskLabel: step.staffTaskLabel,
      requiredProofFields: step.requiredProofFields,
      executed: Boolean(run),
      task: task ? { status: task.status, proof: task.proof as Record<string, unknown> | null } : null,
    }
  })

  const outstandingCents = ledger._sum.amountCents ?? 0
  const readiness = auctionReadiness({
    timelineConfigured: Boolean(row.timeline),
    steps,
    containsVehicle: row.containsVehicle,
    lienNoticeServed: Boolean(servedLienNotice),
    noticeUnitChanged: goodsMoved && !servedLienNotice,
    blockedByHold,
    approved: Boolean(row.approvedAt),
    outstandingCents,
    status: row.status,
  })

  const blockedDays = new Set(readiness.blockers.map((one) => one.dayOffset).filter(Boolean))
  const obligation = surplusObligation(
    {
      surplusCents: row.surplusCents ?? 0,
      disposition: row.surplusDisposition,
      holdUntil: row.surplusHoldUntil,
      notifiedAt: row.surplusTenantNotifiedAt,
    },
    new Date(),
  )

  return {
    id: row.id,
    facilityId: row.facilityId,
    leaseId: row.leaseId,
    unitId: currentLease?.unitId ?? row.unitId,
    unitNumber: currentLease?.unit.number ?? row.unit.number,
    noticeUnitId: row.unitId,
    noticeUnitNumber: row.unit.number,
    goodsMoved,
    currentLeaseId,
    tenantId: row.lease.tenantId,
    tenantName: `${row.lease.tenant.firstName} ${row.lease.tenant.lastName}`,
    status: row.status,
    containsVehicle: row.containsVehicle,
    vehicleNote: row.vehicleNote,
    approvedAt: row.approvedAt,
    approvedByName: approver ? `${approver.firstName} ${approver.lastName}` : null,
    scheduledSaleDate: row.scheduledSaleDate,
    outstandingCents,
    readiness,
    timelineLabel: row.timeline?.label ?? null,
    timelineVersion: row.timeline?.version ?? null,
    steps: steps.map((step) => ({ ...step, blocked: blockedDays.has(step.dayOffset) })),
    advertisements: row.advertisements.map((one) => ({
      id: one.id,
      publication: one.publication,
      runDate: one.runDate,
      reference: one.reference,
    })),
    lockCutAt: row.lockCutAt,
    inventoryDocumentId: row.inventoryDocumentId,
    sale: {
      soldAt: row.soldAt,
      grossProceedsCents: row.grossProceedsCents,
      saleCostsCents: row.saleCostsCents,
      costsRecoveredCents: row.costsRecoveredCents,
      appliedToLienCents: row.appliedToLienCents,
      surplusCents: row.surplusCents,
      deficiencyCents: row.deficiencyCents,
    },
    surplus: {
      disposition: row.surplusDisposition,
      holdUntil: row.surplusHoldUntil,
      notifiedAt: row.surplusTenantNotifiedAt,
      note: row.surplusDispositionNote,
      outstanding: obligation.outstanding,
      outstandingActions: obligation.outstandingActions,
      overdue: obligation.overdue,
    },
    cancelledAt: row.cancelledAt,
    cancelledReason: row.cancelledReason,
  }
}

export type CasesFilter = { includeClosed?: boolean }

export async function auctionCasesFor(
  actor: Actor,
  facilityId: string,
  filter: CasesFilter = {},
): Promise<AuctionCaseView[]> {
  requirePermission(actor, 'tenants:view', facilityId)
  const rows = await prisma.auctionCase.findMany({
    where: {
      facilityId,
      status: filter.includeClosed ? undefined : { in: ['eligible', 'scheduled'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  const cases = await Promise.all(rows.map((row) => auctionCase(actor, row.id)))
  return cases.filter((one): one is AuctionCaseView => one !== null)
}

export type ActionResult = { ok: true } | { ok: false; reason: string; blockers?: Blocker[] }

/// US-28's vehicle carve-out. Flagging is a one-way door in the blocking
/// direction on purpose — clearing it is possible (somebody mis-flagged) but
/// audited, because the flag is what stands between a titled vehicle and a
/// wrongful sale.
export async function setContainsVehicle(
  actor: Actor,
  caseId: string,
  containsVehicle: boolean,
  note: string,
): Promise<ActionResult> {
  const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
  requirePermission(actor, 'tenants:edit', row.facilityId)
  if (!note.trim()) return { ok: false, reason: 'Say what was found in the unit.' }

  await prisma.$transaction(async (tx) => {
    await tx.auctionCase.update({
      where: { id: caseId },
      data: { containsVehicle, vehicleNote: note.trim() },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: row.facilityId,
        action: 'lease.updated',
        entityType: 'AuctionCase',
        entityId: caseId,
        context: { containsVehicle, note: note.trim() },
      },
      tx,
    )
  })
  return { ok: true }
}

/// Regional or owner approval. Requires a reason code, per the audit catalog.
export async function approveAuction(
  actor: Actor,
  caseId: string,
  reasonCode: string,
): Promise<ActionResult> {
  const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
  requirePermission(actor, 'auctions:approve', row.facilityId)

  if (rankAt(actor, row.facilityId) < REGIONAL_RANK) {
    return {
      ok: false,
      reason: 'Approving a lien sale needs a regional manager or an owner, not a site manager.',
    }
  }
  if (!reasonCode.trim()) return { ok: false, reason: 'An approval has to record why.' }
  // B-121. Refused here as well as in `auctionReadiness`, for the same reason
  // the vehicle rule is refused twice: readiness governs SCHEDULING, and an
  // approval recorded against a case that may never be scheduled is a
  // signed-off decision to sell a servicemember's property sitting in the file.
  // The check is on the effect, never the hold type — a new hold that declares
  // `block_auction` gets this by saying so, per US-42.
  //
  // Across the transfer chain (B-157), for the same reason `auctionCase` is: a
  // hold placed after a lien-pipeline transfer sits on the lease the tenant
  // now holds, and approving against the original alone would sign off a sale
  // this hold exists to stop.
  if ((await effectsByLease(await claimLeaseIds(row.leaseId), 'block_auction')).size > 0) {
    return {
      ok: false,
      reason:
        'A hold on this lease blocks sale — Military (SCRA), bankruptcy, deceased, litigation and ' +
        'payment-plan holds all do. It has to be lifted on the tenant profile before this can be approved.',
    }
  }
  if (row.containsVehicle) {
    // Refused here as well as at scheduling: approving a case that can never
    // be scheduled would leave a signed-off record of a sale nobody may run.
    return {
      ok: false,
      reason:
        'This unit is recorded as containing a vehicle, boat or trailer. It requires a separate ' +
        'vehicle lien process and cannot be approved on this path.',
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.auctionCase.update({
      where: { id: caseId },
      data: { approvedByStaffId: actor.kind === 'staff' ? actor.staffUserId : null, approvedAt: new Date() },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: row.facilityId,
        action: 'auction.approved',
        entityType: 'AuctionCase',
        entityId: caseId,
        reasonCode: reasonCode.trim(),
        context: { leaseId: row.leaseId },
      },
      tx,
    )
  })
  return { ok: true }
}

/// The hard block. Scheduling is refused unless EVERY readiness rule passes.
export async function scheduleSale(
  actor: Actor,
  caseId: string,
  saleDate: Date,
): Promise<ActionResult> {
  const view = await auctionCase(actor, caseId)
  if (!view) return { ok: false, reason: 'No such case.' }
  requirePermission(actor, 'auctions:approve', view.facilityId)

  if (!view.readiness.ready) {
    return {
      ok: false,
      reason: 'This sale cannot be scheduled yet.',
      blockers: view.readiness.blockers,
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.auctionCase.update({
      where: { id: caseId },
      data: { status: 'scheduled', scheduledSaleDate: saleDate },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: view.facilityId,
        action: 'auction.scheduled',
        entityType: 'AuctionCase',
        entityId: caseId,
        context: { saleDate: saleDate.toISOString().slice(0, 10), leaseId: view.leaseId },
      },
      tx,
    )
  })
  return { ok: true }
}

export async function addAdvertisement(
  actor: Actor,
  caseId: string,
  input: { publication: string; runDate: Date; reference: string | null },
): Promise<ActionResult> {
  const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
  requirePermission(actor, 'auctions:approve', row.facilityId)
  if (!input.publication.trim()) return { ok: false, reason: 'Name the publication or site.' }

  await prisma.auctionAdvertisement.create({
    data: {
      auctionCaseId: caseId,
      publication: input.publication.trim(),
      runDate: input.runDate,
      reference: input.reference?.trim() || null,
    },
  })
  return { ok: true }
}

/// Lock cut and inventory. "The primary evidence that you sold what you said
/// you sold" — so the itemised contents are rendered into a hashed `Document`
/// through US-27's mechanism rather than stored as free text.
export async function recordLockCut(
  actor: Actor,
  caseId: string,
  input: {
    cutAt: Date
    oldLockDisposition: string
    items: { description: string; photoReference: string }[]
  },
): Promise<ActionResult> {
  const row = await prisma.auctionCase.findUniqueOrThrow({
    where: { id: caseId },
    include: { unit: { select: { number: true } } },
  })
  requirePermission(actor, 'auctions:approve', row.facilityId)

  // B-160. Which unit somebody is standing in front of with the bolt cutters.
  // The case is pinned to the unit the notice named; after a D-85 transfer the
  // goods are somewhere else, and an inventory headed with the pinned number
  // is a document about a unit that has since been re-rented to a stranger.
  const { currentLeaseId } = await claimChain(row.leaseId)
  const currentLease =
    currentLeaseId === row.leaseId
      ? null
      : await prisma.lease.findUnique({
          where: { id: currentLeaseId },
          select: { unit: { select: { number: true } } },
        })
  const unitNumber = currentLease?.unit.number ?? row.unit.number
  const noticeUnitNumber = row.unit.number

  if (row.lockCutAt) {
    // Written once. A re-cut inventory that overwrote the first would destroy
    // the evidence this record exists to be.
    return { ok: false, reason: 'The lock cut and inventory have already been recorded for this case.' }
  }
  if (!input.oldLockDisposition.trim()) {
    return { ok: false, reason: 'Record what happened to the tenant’s lock.' }
  }
  const items = input.items.filter((item) => item.description.trim())
  if (items.length === 0) {
    return {
      ok: false,
      reason:
        'An inventory with no items is not an inventory. List what was in the unit — "no items of ' +
        'value" is itself a line, and it has to be written down.',
    }
  }
  const withoutPhotos = items.filter((item) => !item.photoReference.trim())
  if (withoutPhotos.length > 0) {
    return {
      ok: false,
      reason: `Every inventory line needs a photograph reference. Missing on: ${withoutPhotos
        .map((item) => item.description.trim())
        .join(', ')}.`,
    }
  }

  const rows = items
    .map(
      (item, index) =>
        `<tr><th scope="row">${index + 1}</th><td>${escape(item.description.trim())}</td>` +
        `<td>${escape(item.photoReference.trim())}</td></tr>`,
    )
    .join('\n')

  await prisma.$transaction(async (tx) => {
    const { id: documentId } = await storeGeneratedDocument(
      {
        facilityId: row.facilityId,
        type: 'lien_evidence',
        subjectType: 'AuctionCase',
        subjectId: caseId,
        title: `Unit ${unitNumber} — contents inventory at lock cut`,
        // `movedNote` carries the second fact rather than replacing the first:
        // the document has to say both which unit was opened and which unit the
        // notice named, or it silently contradicts the notice sitting beside it
        // in the same file. It is never blank — FR-6 treats an empty merge
        // value as a missing one and throws, and an inventory that AFFIRMS the
        // notice named this same unit is better evidence than one that is
        // silent about it.
        template:
          '<p>Unit {{unitNumber}}. Lock cut {{cutAt}} by {{cutBy}}. ' +
          'Tenant’s lock: {{lockDisposition}}.{{movedNote}}</p>{{itemsTable}}',
        values: {
          unitNumber,
          movedNote:
            unitNumber === noticeUnitNumber
              ? ' The lien notice was served naming this same unit.'
              : ` The lien notice was served naming unit ${noticeUnitNumber}; the contents were moved to unit ${unitNumber} before this cut.`,
          cutAt: input.cutAt.toISOString(),
          cutBy: actor.kind === 'staff' ? actor.staffUserId : 'system',
          lockDisposition: input.oldLockDisposition.trim(),
          itemsTable: [
            '<table>',
            '<caption>Itemised contents</caption>',
            '<thead><tr><th scope="col">#</th><th scope="col">Item</th><th scope="col">Photograph</th></tr></thead>',
            `<tbody>${rows}</tbody>`,
            '</table>',
          ].join('\n'),
        },
        rawFields: ['itemsTable'],
        actor: toAuditActor(actor),
      },
      tx,
    )

    await tx.auctionCase.update({
      where: { id: caseId },
      data: {
        lockCutAt: input.cutAt,
        lockCutByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
        oldLockDisposition: input.oldLockDisposition.trim(),
        inventoryDocumentId: documentId,
      },
    })

    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: row.facilityId,
        action: 'auction.lock_cut',
        entityType: 'AuctionCase',
        entityId: caseId,
        context: {
          cutAt: input.cutAt.toISOString(),
          itemCount: items.length,
          documentId,
          unitNumber,
          noticeUnitNumber,
        },
      },
      tx,
    )
  })
  return { ok: true }
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type SaleOutcomeInput = {
  soldAt: Date
  grossProceedsCents: number
  saleCostsCents: number
  buyer: BuyerRecordInput & { forfeitTerms?: string | null }
}

/// Records the sale. The waterfall computes every figure and posts the ledger
/// entries; nothing here is typed in as a total.
export async function recordSaleOutcome(
  actor: Actor,
  caseId: string,
  input: SaleOutcomeInput,
): Promise<ActionResult> {
  const view = await auctionCase(actor, caseId)
  if (!view) return { ok: false, reason: 'No such case.' }
  requirePermission(actor, 'auctions:approve', view.facilityId)

  if (view.status === 'sold') return { ok: false, reason: 'This sale has already been recorded.' }
  if (view.status !== 'scheduled') {
    return { ok: false, reason: 'Only a scheduled sale can have an outcome recorded.' }
  }
  if (view.containsVehicle) {
    return { ok: false, reason: 'This case is blocked: the unit contains a vehicle.' }
  }
  if (!view.lockCutAt) {
    return {
      ok: false,
      reason:
        'Record the lock cut and the contents inventory first. It is the primary evidence that you ' +
        'sold what you said you sold, and it cannot be reconstructed afterwards.',
    }
  }

  const missing = missingBuyerFields(input.buyer)
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `The buyer record is incomplete: ${missing.join(', ')}. A sales-tax return on auction proceeds cannot be filed without it.`,
    }
  }

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: view.facilityId },
    select: { surplusHoldDays: true },
  })

  // The lien balance is what the ledger says right now, not a figure carried
  // from the notice — days may have passed and a payment may have landed.
  const result = distribute({
    grossProceedsCents: input.grossProceedsCents,
    saleCostsCents: input.saleCostsCents,
    lienBalanceCents: Math.max(0, view.outstandingCents),
  })
  const postings = ledgerPostings(
    {
      grossProceedsCents: input.grossProceedsCents,
      saleCostsCents: input.saleCostsCents,
      lienBalanceCents: Math.max(0, view.outstandingCents),
    },
    result,
  )

  await prisma.$transaction(async (tx) => {
    for (const posting of postings) {
      await tx.ledgerEntry.create({
        data: {
          facilityId: view.facilityId,
          // B-160. The lease the claim sits on now, not the one the notice
          // named. `outstandingCents` above is summed across the whole chain
          // because D-86 moved the unpaid invoices forward on a transfer —
          // posting the proceeds back to the pinned lease credited a ledger
          // that already netted to zero and left the live lease showing the
          // full arrears after a completed sale, with the delinquency ladder
          // still running on a tenant whose goods had been sold. The balance
          // was read forward and the credit posted backward.
          leaseId: view.currentLeaseId,
          type: posting.type,
          amountCents: posting.amountCents,
          description: posting.description,
          occurredAt: input.soldAt,
        },
      })
    }

    await tx.auctionCase.update({
      where: { id: caseId },
      data: {
        status: 'sold',
        soldAt: input.soldAt,
        grossProceedsCents: input.grossProceedsCents,
        saleCostsCents: input.saleCostsCents,
        costsRecoveredCents: result.costsRecoveredCents,
        appliedToLienCents: result.appliedToLienCents,
        surplusCents: result.surplusCents,
        deficiencyCents: result.deficiencyCents,
        buyerName: input.buyer.name,
        buyerAddressLine1: input.buyer.addressLine1,
        buyerAddressLine2: input.buyer.addressLine2 ?? null,
        buyerCity: input.buyer.city,
        buyerState: input.buyer.state,
        buyerPostalCode: input.buyer.postalCode,
        buyerGovernmentIdReference: input.buyer.governmentIdReference,
        buyerTaxExempt: Boolean(input.buyer.taxExempt),
        buyerResaleCertificateReference: input.buyer.resaleCertificateReference ?? null,
        buyerPaymentMethod: input.buyer.paymentMethod,
        buyerCleanoutDeadline: input.buyer.cleanoutDeadline,
        buyerForfeitTerms: input.buyer.forfeitTerms ?? null,
        // A surplus starts HELD, never "no surplus" — the disposition has to be
        // recorded by a person, and starting it settled is how one gets kept.
        surplusDisposition: result.surplusCents > 0 ? 'held' : 'no_surplus',
        surplusHoldUntil:
          result.surplusCents > 0 ? surplusHoldUntil(input.soldAt, facility.surplusHoldDays) : null,
      },
    })

    // "Unit released to `maintenance` for cleanout verification" — the same
    // path a move-out takes (B-040), so the unit cannot go back on sale before
    // somebody has opened the door.
    await tx.lease.update({
      where: { id: view.leaseId },
      data: { status: 'ended', endDate: input.soldAt, moveOutDate: input.soldAt },
    })
    await tx.unit.update({ where: { id: view.unitId }, data: { operationalStatus: 'maintenance' } })
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
    // B-169. Not "the tenant has paid" — their goods were just sold.
    await releaseOverlock(
      { leaseId: view.leaseId, facilityId: view.facilityId, reason: 'auction_sold' },
      tx,
    )
    await recomputeUnitStatus(view.unitId, tx)

    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: view.facilityId,
        action: 'auction.completed',
        entityType: 'AuctionCase',
        entityId: caseId,
        context: {
          soldAt: input.soldAt.toISOString(),
          grossProceedsCents: input.grossProceedsCents,
          saleCostsCents: input.saleCostsCents,
          appliedToLienCents: result.appliedToLienCents,
          surplusCents: result.surplusCents,
          deficiencyCents: result.deficiencyCents,
          buyerName: input.buyer.name,
        },
      },
      tx,
    )
  })

  return { ok: true }
}

/// "Cancelling a sale (tenant paid) at any point restores the normal lifecycle
/// and logs the reason."
export async function cancelAuction(
  actor: Actor,
  caseId: string,
  reason: string,
): Promise<ActionResult> {
  const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
  requirePermission(actor, 'auctions:approve', row.facilityId)

  if (row.status === 'sold') {
    return { ok: false, reason: 'This unit has already been sold. A completed sale cannot be cancelled.' }
  }
  if (row.status === 'cancelled') return { ok: true }
  if (!reason.trim()) return { ok: false, reason: 'Cancelling has to record why.' }

  await prisma.$transaction(async (tx) => {
    await tx.auctionCase.update({
      where: { id: caseId },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledReason: reason.trim() },
    })
    // Restores the normal lifecycle: the lease goes back to being an ordinary
    // delinquent lease rather than one pending auction. The delinquency engine
    // decides from here — if they really paid, its own cure path runs.
    await tx.lease.updateMany({
      where: { id: row.leaseId, status: 'pending_auction' },
      data: { status: 'delinquent' },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: row.facilityId,
        action: 'auction.cancelled',
        entityType: 'AuctionCase',
        entityId: caseId,
        reasonCode: reason.trim(),
        context: { leaseId: row.leaseId, previousStatus: row.status },
      },
      tx,
    )
  })
  return { ok: true }
}

/// Records that the former tenant was notified a surplus is held.
export async function recordSurplusNotified(actor: Actor, caseId: string): Promise<ActionResult> {
  const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
  requirePermission(actor, 'auctions:approve', row.facilityId)
  if ((row.surplusCents ?? 0) <= 0) return { ok: false, reason: 'This sale produced no surplus.' }

  await prisma.auctionCase.update({
    where: { id: caseId },
    data: { surplusTenantNotifiedAt: row.surplusTenantNotifiedAt ?? new Date() },
  })
  return { ok: true }
}

/// Records what happened to the surplus — claimed by the former tenant, or
/// remitted to the state.
export async function recordSurplusDisposition(
  actor: Actor,
  caseId: string,
  disposition: SurplusDisposition,
  note: string,
): Promise<ActionResult> {
  const row = await prisma.auctionCase.findUniqueOrThrow({ where: { id: caseId } })
  requirePermission(actor, 'auctions:approve', row.facilityId)

  const verdict = canRecordDisposition(row.surplusCents ?? 0, disposition)
  if (!verdict.allowed) return { ok: false, reason: verdict.reason }
  if (!note.trim()) {
    return { ok: false, reason: 'Record how the surplus was paid out or remitted, and to whom.' }
  }
  if (row.surplusDispositionedAt) {
    return { ok: false, reason: 'This surplus has already been dispositioned.' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.auctionCase.update({
      where: { id: caseId },
      data: {
        surplusDisposition: disposition,
        surplusDispositionNote: note.trim(),
        surplusDispositionedAt: new Date(),
      },
    })
    await recordAudit(
      {
        actor: toAuditActor(actor),
        facilityId: row.facilityId,
        action: 'auction.surplus_dispositioned',
        entityType: 'AuctionCase',
        entityId: caseId,
        context: { disposition, surplusCents: row.surplusCents, note: note.trim() },
      },
      tx,
    )
  })
  return { ok: true }
}

/// Every sale whose surplus is still outstanding, across the actor's
/// facilities. The list that stops a surplus being quietly retained.
export async function outstandingSurpluses(actor: Actor, facilityId: string) {
  requirePermission(actor, 'tenants:view', facilityId)
  const rows = await prisma.auctionCase.findMany({
    where: { facilityId, status: 'sold', surplusDisposition: { in: ['held'] } },
    include: { unit: { select: { number: true } }, lease: { select: { tenantId: true } } },
    orderBy: { surplusHoldUntil: 'asc' },
  })

  const now = new Date()
  return rows.map((row) => {
    const obligation = surplusObligation(
      {
        surplusCents: row.surplusCents ?? 0,
        disposition: row.surplusDisposition,
        holdUntil: row.surplusHoldUntil,
        notifiedAt: row.surplusTenantNotifiedAt,
      },
      now,
    )
    return {
      caseId: row.id,
      unitNumber: row.unit.number,
      tenantId: row.lease.tenantId,
      surplusCents: row.surplusCents ?? 0,
      surplusLabel: formatCents(row.surplusCents ?? 0),
      holdUntil: row.surplusHoldUntil,
      notifiedAt: row.surplusTenantNotifiedAt,
      ...obligation,
    }
  })
}

// PRD 02 §4.6 US-30 (B-129). The lot sheet behind `/admin/auctions/lots.csv`.
//
// Built on `auctionCasesFor`, which is the same call the auctions screen makes,
// so the export and the screen cannot disagree about which sales are live — the
// structural guarantee B-042 established for the occupancy exports rather than
// a second query shaped close enough. The refusal list is what the screen
// renders, so an operator reads "three of your five scheduled sales are not
// exportable, and here is why" instead of downloading a short file and not
// noticing.

export type ListingLot = {
  caseId: string
  unitNumber: string
  unitTypeName: string
  widthFt: number
  lengthFt: number
  squareFeet: number
  scheduledSaleDate: Date
}

export type LotSheet = {
  facility: {
    name: string
    addressLine1: string
    addressLine2: string | null
    city: string
    state: string
    postalCode: string
    /// Null when nobody has set the terms of sale. Rendered as a blank column
    /// and said out loud on screen — see the note on `Facility.auctionSaleTerms`.
    saleTerms: string | null
  }
  lots: ListingLot[]
  refused: LotRefusal[]
}

export async function auctionLotSheet(actor: Actor, facilityId: string): Promise<LotSheet | null> {
  const cases = await auctionCasesFor(actor, facilityId, { includeClosed: true })

  // `selectListableLots` decides on `auctionReadiness`, not on `status` — a
  // tenant who paid, a hold that landed, or a vehicle recorded since the sale
  // was scheduled all make the advertisement wrong, and all leave `status` at
  // `scheduled`. See the note in packages/core/auctions/listing.ts.
  const { lots: listable, refused } = selectListableLots(
    cases.map((one) => ({
      caseId: one.id,
      unitNumber: one.unitNumber,
      status: one.status as 'eligible' | 'scheduled' | 'sold' | 'cancelled',
      scheduledSaleDate: one.scheduledSaleDate,
      readiness: one.readiness,
      unitId: one.unitId,
    })),
  )

  const [facility, units] = await Promise.all([
    prisma.facility.findUnique({
      where: { id: facilityId },
      select: {
        name: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        auctionSaleTerms: true,
      },
    }),
    // The unit the goods are in NOW, which is what `unitId` on the view already
    // means (B-160 / D-91) — a lot sheet has to send a buyer to the door they
    // will actually be opening.
    listable.length
      ? prisma.unit.findMany({
          where: { id: { in: listable.map((one) => one.unitId) } },
          select: {
            id: true,
            unitType: { select: { name: true, widthFt: true, lengthFt: true } },
          },
        })
      : Promise.resolve([]),
  ])
  if (!facility) return null

  const typeByUnit = new Map(units.map((unit) => [unit.id, unit.unitType]))

  return {
    facility: {
      name: facility.name,
      addressLine1: facility.addressLine1,
      addressLine2: facility.addressLine2,
      city: facility.city,
      state: facility.state,
      postalCode: facility.postalCode,
      saleTerms: facility.auctionSaleTerms,
    },
    lots: listable.flatMap((one) => {
      const type = typeByUnit.get(one.unitId)
      // A unit with no type cannot happen through the schema, and a lot sheet
      // that silently invents "0x0" would be worse than one row short.
      if (!type) return []
      return [
        {
          caseId: one.caseId,
          unitNumber: one.unitNumber,
          unitTypeName: type.name,
          widthFt: type.widthFt,
          lengthFt: type.lengthFt,
          squareFeet: type.widthFt * type.lengthFt,
          scheduledSaleDate: one.scheduledSaleDate!,
        },
      ]
    }),
    refused,
  }
}
