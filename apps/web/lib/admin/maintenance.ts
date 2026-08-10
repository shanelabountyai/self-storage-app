import { prisma } from '@storage/db'
import type { MaintenanceTicketStatus } from '@storage/db'
import { canSetManualStatus } from '@storage/core/inventory'
import { recordAudit } from '@storage/core/audit'
import { ForbiddenError, requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import { occupancyFactsForMany, recomputeUnitStatus } from './units'

// PRD 02 §4.9 US-37 (B-060). Maintenance tickets.
//
// "A unit cannot be set available while a blocking ticket is open" is enforced
// in `canSetManualStatus` (packages/core/inventory) — this file's own part of
// the AC is the other half: "tickets on a unit can set the unit to
// maintenance." That happens here, once, at creation, rather than being left
// for an operator to remember to do by hand.

export type MaintenanceTicketInput = {
  unitId: string
  title: string
  notes: string | null
  priority: 'normal' | 'high'
  blocksAvailability: boolean
  source: 'walkthrough' | 'manual'
}

export async function createMaintenanceTicket(
  actor: Actor,
  facilityId: string,
  input: MaintenanceTicketInput,
): Promise<{ id: string }> {
  requirePermission(actor, 'units:edit', facilityId)
  if (!input.title.trim()) throw new Error('A ticket needs a title.')

  const unit = await prisma.unit.findUniqueOrThrow({
    where: { id: input.unitId },
    select: { facilityId: true, operationalStatus: true },
  })
  if (unit.facilityId !== facilityId) {
    throw new ForbiddenError(`Unit ${input.unitId} does not belong to facility ${facilityId}`)
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.maintenanceTicket.create({
      data: {
        facilityId,
        unitId: input.unitId,
        title: input.title.trim(),
        notes: input.notes?.trim() || null,
        priority: input.priority,
        blocksAvailability: input.blocksAvailability,
        source: input.source,
        createdByStaffId: actor.kind === 'staff' ? actor.staffUserId : null,
      },
    })

    // Only when the unit is actually free to take: an occupied or already-held
    // unit's intent is not this ticket's to change, and `canSetManualStatus`
    // already knows why in each case.
    if (created.blocksAvailability && unit.operationalStatus !== 'maintenance') {
      const facts = (await occupancyFactsForMany([input.unitId], tx)).get(input.unitId)!
      if (canSetManualStatus('maintenance', facts).allowed) {
        await tx.unit.update({ where: { id: input.unitId }, data: { operationalStatus: 'maintenance' } })
        await recomputeUnitStatus(input.unitId, tx)
        await recordAudit(
          {
            actor: toAuditActor(actor),
            facilityId,
            action: 'unit.updated',
            entityType: 'Unit',
            entityId: input.unitId,
            context: { maintenanceTicketOpened: created.id, title: created.title },
          },
          tx,
        )
      }
    }

    return created
  })

  return { id: ticket.id }
}

export type MaintenanceTicketRow = {
  id: string
  unitId: string
  unitNumber: string
  title: string
  notes: string | null
  status: MaintenanceTicketStatus
  priority: 'normal' | 'high'
  blocksAvailability: boolean
  source: string
  assigneeName: string | null
  createdAt: Date
}

/// Open tickets first, highest priority and oldest within each group — the
/// same "what needs doing" ordering the rest of field ops uses.
export async function ticketsForFacility(
  actor: Actor,
  facilityId: string,
  options: { includeDone?: boolean } = {},
): Promise<MaintenanceTicketRow[]> {
  requirePermission(actor, 'units:edit', facilityId)

  const tickets = await prisma.maintenanceTicket.findMany({
    where: { facilityId, status: options.includeDone ? undefined : { not: 'done' } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    include: {
      unit: { select: { number: true } },
      assignee: { select: { firstName: true, lastName: true } },
    },
  })

  return tickets.map((ticket) => ({
    id: ticket.id,
    unitId: ticket.unitId,
    unitNumber: ticket.unit.number,
    title: ticket.title,
    notes: ticket.notes,
    status: ticket.status,
    priority: ticket.priority,
    blocksAvailability: ticket.blocksAvailability,
    source: ticket.source,
    assigneeName: ticket.assignee ? `${ticket.assignee.firstName} ${ticket.assignee.lastName}` : null,
    createdAt: ticket.createdAt,
  }))
}

export async function setTicketStatus(
  actor: Actor,
  ticketId: string,
  status: MaintenanceTicketStatus,
): Promise<void> {
  const ticket = await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticketId } })
  requirePermission(actor, 'units:edit', ticket.facilityId)

  await prisma.maintenanceTicket.update({
    where: { id: ticketId },
    // Reopening from `done` clears `resolvedAt` rather than leaving a stale
    // date on a ticket that is, once again, not resolved.
    data: { status, resolvedAt: status === 'done' ? new Date() : null },
  })
}

export async function assignTicket(actor: Actor, ticketId: string, staffUserId: string | null): Promise<void> {
  const ticket = await prisma.maintenanceTicket.findUniqueOrThrow({ where: { id: ticketId } })
  requirePermission(actor, 'units:edit', ticket.facilityId)

  await prisma.maintenanceTicket.update({ where: { id: ticketId }, data: { assigneeStaffId: staffUserId } })
}
