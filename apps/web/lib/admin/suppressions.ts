import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { suppressionIsRemovable } from '@storage/core/comms'
import { suppress } from '@/lib/comms/service'
import { requirePermission } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'

// PRD 05 CN-20 (B-054). The shared suppression list, as a screen.
//
// The list is deliberately org-wide, not per-facility: an address that hard
// bounced or told us STOP is not reachable from facility B either, and a
// per-facility list would mail it again from the next site over. `Suppression`
// has no facilityId for exactly that reason; the settings screen it lives under
// is scoped only so the audit entry has somewhere to hang.

export type SuppressionRow = {
  id: string
  channel: string
  address: string
  reason: string
  note: string | null
  createdAt: Date
  createdByName: string | null
  /// CN-20: manual and bounce entries may be lifted; STOP and complaint never.
  /// Computed here so the UI does not re-derive the rule and drift from it.
  removable: boolean
}

/// The list, optionally filtered by address. CN-20 asks for "view and search".
export async function suppressionList(
  actor: Actor,
  facilityId: string,
  query?: string,
): Promise<SuppressionRow[]> {
  requirePermission(actor, 'facility:settings', facilityId)

  const search = query?.trim()
  const rows = await prisma.suppression.findMany({
    where: search ? { address: { contains: search, mode: 'insensitive' } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { createdByStaff: { select: { firstName: true, lastName: true } } },
  })

  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    address: row.address,
    reason: row.reason,
    note: row.note,
    createdAt: row.createdAt,
    createdByName: row.createdByStaff
      ? `${row.createdByStaff.firstName} ${row.createdByStaff.lastName}`
      : null,
    removable: suppressionIsRemovable(row.reason),
  }))
}

export type SuppressionWriteResult = { ok: true } | { ok: false; problem: string }

/// CN-20's manual add. Always `manual` as the reason — a staffer adding an
/// address by hand cannot claim it was a bounce or a STOP, and letting them
/// pick would let a removable entry be laundered into a permanent one (or,
/// worse, the reverse).
export async function addSuppression(
  actor: Actor,
  facilityId: string,
  input: { channel: 'email' | 'sms'; address: string; note: string },
): Promise<SuppressionWriteResult> {
  requirePermission(actor, 'facility:settings', facilityId)

  const address = input.address.trim()
  if (!address) return { ok: false, problem: 'Enter the address or number to suppress.' }
  if (input.channel === 'email' && !address.includes('@')) {
    return { ok: false, problem: 'That does not look like an email address.' }
  }
  if (!input.note.trim()) {
    // CN-20 asks for a logged justification on removal; requiring one on the
    // way in too is the same argument — an entry with no reason is one nobody
    // will ever dare remove.
    return { ok: false, problem: 'Say why this address is being suppressed.' }
  }

  const existing = await prisma.suppression.findUnique({
    where: {
      channel_address: {
        channel: input.channel,
        address: input.channel === 'email' ? address.toLowerCase() : address,
      },
    },
    select: { reason: true },
  })
  if (existing) return { ok: false, problem: `Already suppressed (${existing.reason}).` }

  await prisma.$transaction(async (tx) => {
    await suppress(
      {
        channel: input.channel,
        address,
        reason: 'manual',
        note: input.note.trim(),
        createdByStaffId: actor.kind === 'staff' ? actor.staffUserId : undefined,
      },
      tx,
    )
    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'suppression.added',
        entityType: 'Suppression',
        entityId: `${input.channel}:${address}`,
        facilityId,
        context: { channel: input.channel, reason: 'manual', note: input.note.trim() },
      },
      tx,
    )
  })

  return { ok: true }
}

/// CN-20's removal, with its one hard rule.
///
/// STOP and complaint entries are refused outright rather than warned about. A
/// STOP is the recipient's own instruction and re-mailing after one is a TCPA
/// problem; a complaint is a deliverability black mark that undoing from an
/// admin screen is exactly how a sending domain gets blocked. Neither is a
/// judgement call a settings screen should be able to override.
export async function removeSuppression(
  actor: Actor,
  facilityId: string,
  input: { id: string; reason: string },
): Promise<SuppressionWriteResult> {
  requirePermission(actor, 'facility:settings', facilityId)

  if (!input.reason.trim()) {
    return { ok: false, problem: 'Say why this suppression is being lifted.' }
  }

  const row = await prisma.suppression.findUnique({ where: { id: input.id } })
  if (!row) return { ok: false, problem: 'That suppression no longer exists.' }
  if (!suppressionIsRemovable(row.reason)) {
    return {
      ok: false,
      problem:
        row.reason === 'complaint'
          ? 'This address reported us as spam. It cannot be removed — mailing it again risks the sending domain for every facility.'
          : 'This recipient asked us to stop. It cannot be removed from here; they have to opt back in themselves.',
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.suppression.delete({ where: { id: input.id } })

    // Lifting a bounce is the only way FR-15's tenant flag comes off — the
    // primary email is the login identity and is not editable from the admin
    // side, so there is no "they gave us a new address" path that could clear
    // it instead. Leaving the flag set would put a red banner on the profile
    // forever after the address was fixed, and a banner that is always there
    // is one nobody reads.
    if (row.reason === 'hard_bounce') {
      await tx.tenant.updateMany({
        where: { email: row.address, emailUndeliverableAt: { not: null } },
        data: { emailUndeliverableAt: null },
      })
    }
    // The row itself is gone, so this entry is the only record that the address
    // was ever suppressed and who decided it should not be. `before` carries
    // the whole row for that reason.
    await recordAudit(
      {
        actor: toAuditActor(actor),
        action: 'suppression.removed',
        entityType: 'Suppression',
        entityId: `${row.channel}:${row.address}`,
        facilityId,
        reasonCode: input.reason.trim(),
        before: { reason: row.reason, note: row.note, createdAt: row.createdAt.toISOString() },
        context: { channel: row.channel },
      },
      tx,
    )
  })

  return { ok: true }
}
