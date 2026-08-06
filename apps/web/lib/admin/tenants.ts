import { prisma } from '@storage/db'
import type { PermissionKey } from '@storage/db/rbac-catalog'
import { OCCUPYING_LEASE_STATUSES } from '@storage/core/inventory'
import { recordAudit } from '@storage/core/audit'
import { can, facilityScope, ForbiddenError, hasPermissionAnywhere } from '@/lib/rbac/authorize'
import { toAuditActor } from '@/lib/rbac/audit-actor'
import type { Actor } from '@/lib/rbac/actor'
import {
  addressHistory,
  currentAddress,
  flagReturnedMail,
  recordAddressChange,
  updateContactDetails,
  validateAddress,
  type AddressInput,
  type ContactDetails,
  type FieldProblems,
} from '@/lib/portal/contact'
import { logManualDocument, type DocumentType } from '@/lib/documents/store'
import { createTask } from '@/lib/admin/tasks'
import { activeHolds, type ActiveHold } from '@/lib/admin/holds'
import { refundablePayments } from '@/lib/billing/refunds'

// PRD 02 §4.4 US-13. "Any staffer can pick up any conversation" — search,
// then one profile: contact, address history, leases and balance, notes,
// logged documents, and a shell of what has been sent to this person.
//
// Reuses lib/portal/contact.ts wholesale for contact/address — that file's
// own comment already names this as the counter's entry point (D-21), and
// duplicating validation or the append-only write here would be the exact gap
// D-21 exists to prevent.

/// The facilities this tenant actually has a lease at. The authorization
/// boundary for everything below: `Tenant` itself carries no facilityId (a
/// person can hold leases anywhere), so "can this staffer see this tenant" is
/// answered by intersecting these with what the staffer is assigned to.
async function tenantFacilityIds(tenantId: string): Promise<string[]> {
  const rows = await prisma.lease.findMany({
    where: { tenantId },
    select: { facilityId: true },
    distinct: ['facilityId'],
  })
  return rows.map((row) => row.facilityId)
}

/// Throws unless the actor holds `permission` at some facility this tenant
/// actually has a lease at. Returns that facility id set so a caller writing
/// a new row (a note, a logged document) has a legitimate one to attribute it
/// to, rather than picking one out of thin air.
async function assertTenantAccess(
  actor: Actor,
  tenantId: string,
  permission: PermissionKey,
): Promise<string[]> {
  const facilityIds = await tenantFacilityIds(tenantId)
  const accessible = facilityIds.filter((facilityId) => can(actor, permission, facilityId))
  if (accessible.length === 0) {
    throw new ForbiddenError(`No access to tenant ${tenantId}`, permission)
  }
  return accessible
}

export type TenantSearchResult = {
  tenantId: string
  name: string
  email: string
  phone: string | null
  units: { facilityName: string; unitNumber: string }[]
}

/// Name, phone, email, or unit number, partial match. Always scoped to a
/// lease the actor can see — a tenant with no lease in scope cannot surface
/// here even for an otherwise-matching name, which is also what keeps the
/// profile page's own access check from ever rejecting a tenant this screen
/// just linked to.
export async function searchTenants(actor: Actor, query: string): Promise<TenantSearchResult[]> {
  if (!hasPermissionAnywhere(actor, ['tenants:view'])) {
    throw new ForbiddenError('Missing permission tenants:view', 'tenants:view')
  }
  const q = query.trim()
  if (!q) return []

  const scope = facilityScope(actor)

  // Split on whitespace so a natural "Ada Renter" full-name search works: a
  // single `contains` on the combined string matches nothing, because first
  // and last name live in separate columns. Every word must match SOME field
  // (AND across words), and any one field can satisfy any one word (OR within
  // a word) — which also keeps a single-token phone/email/unit search working
  // exactly as before.
  const words = q.split(/\s+/).filter(Boolean)

  const tenants = await prisma.tenant.findMany({
    where: {
      deletedAt: null,
      leases: { some: scope },
      AND: words.map((word) => ({
        OR: [
          { firstName: { contains: word, mode: 'insensitive' as const } },
          { lastName: { contains: word, mode: 'insensitive' as const } },
          { email: { contains: word, mode: 'insensitive' as const } },
          { phone: { contains: word, mode: 'insensitive' as const } },
          { leases: { some: { ...scope, unit: { number: { contains: word, mode: 'insensitive' as const } } } } },
        ],
      })),
    },
    take: 25,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      leases: {
        where: { status: { in: [...OCCUPYING_LEASE_STATUSES] } },
        select: { facility: { select: { name: true } }, unit: { select: { number: true } } },
      },
    },
  })

  return tenants.map((tenant) => ({
    tenantId: tenant.id,
    name: `${tenant.firstName} ${tenant.lastName}`,
    email: tenant.email,
    phone: tenant.phone,
    units: tenant.leases.map((lease) => ({
      facilityName: lease.facility.name,
      unitNumber: lease.unit.number,
    })),
  }))
}

export type TenantLeaseSummary = {
  leaseId: string
  facilityId: string
  facilityName: string
  unitNumber: string
  status: string
  monthlyRateCents: number
  balanceCents: number
  startDate: Date
  endDate: Date | null
}

export type TenantNoteRow = {
  id: string
  body: string
  pinned: boolean
  createdAt: Date
  authorName: string
}

export type TenantDocumentRow = {
  id: string
  type: string
  title: string
  createdAt: Date
  hasContent: boolean
}

export type TenantMessageRow = {
  id: string
  channel: string
  status: string
  templateKey: string
  subjectSnapshot: string | null
  createdAt: Date
}

export type TenantProfile = {
  tenantId: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  altContactName: string | null
  altContactPhone: string | null
  altContactEmail: string | null
  address: Awaited<ReturnType<typeof currentAddress>>
  addressHistory: Awaited<ReturnType<typeof addressHistory>>
  leases: TenantLeaseSummary[]
  totalBalanceCents: number
  notes: TenantNoteRow[]
  documents: TenantDocumentRow[]
  messages: TenantMessageRow[]
  /// Late fees still outstanding on this tenant's leases (B-047), so a manager
  /// can waive one from the profile rather than from a database client.
  waivableFees: WaivableFee[]
  /// US-42's banner data: every hold in force on any of this tenant's leases.
  /// On the profile rather than only the lease row because a staffer opening
  /// the tenant must see it before they do anything at all.
  holds: (ActiveHold & { leaseId: string; unitNumber: string })[]
  /// US-45's plain-English line: "Access suspended, 12 days past due,
  /// 2026-07-18". Read from the audit entry the rule wrote rather than
  /// recomputed, so the screen says what actually happened and when.
  accessState: { facilityName: string; suspended: boolean; summary: string }[]
  /// US-23. Payments with something left to give back.
  refundable: Awaited<ReturnType<typeof refundablePayments>>
  /// Facilities the viewing actor may act through for this tenant — what a
  /// mutation form needs to attribute a new note or document to.
  editableFacilityIds: string[]
}

export type WaivableFee = {
  invoiceId: string
  number: string
  facilityId: string
  unitNumber: string
  outstandingCents: number
  issuedOn: Date
  description: string
}

export async function tenantProfile(actor: Actor, tenantId: string): Promise<TenantProfile> {
  const editableFacilityIds = await assertTenantAccess(actor, tenantId, 'tenants:view')

  const [tenant, leases, address, history, notes, messages] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        altContactName: true,
        altContactPhone: true,
        altContactEmail: true,
      },
    }),
    prisma.lease.findMany({
      where: { tenantId },
      orderBy: { startDate: 'desc' },
      select: {
        id: true,
        facilityId: true,
        status: true,
        monthlyRateCents: true,
        startDate: true,
        endDate: true,
        facility: { select: { name: true } },
        unit: { select: { number: true } },
      },
    }),
    currentAddress(tenantId),
    addressHistory(tenantId),
    prisma.tenantNote.findMany({
      where: { tenantId },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        body: true,
        pinned: true,
        createdAt: true,
        staffUser: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.message.findMany({
      where: { recipientTenantId: tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        channel: true,
        status: true,
        templateKey: true,
        subjectSnapshot: true,
        createdAt: true,
      },
    }),
  ])

  const leaseBalances = await Promise.all(
    leases.map((lease) =>
      prisma.ledgerEntry.aggregate({ where: { leaseId: lease.id }, _sum: { amountCents: true } }),
    ),
  )

  const leaseSummaries: TenantLeaseSummary[] = leases.map((lease, index) => ({
    leaseId: lease.id,
    facilityId: lease.facilityId,
    facilityName: lease.facility.name,
    unitNumber: lease.unit.number,
    status: lease.status,
    monthlyRateCents: lease.monthlyRateCents,
    balanceCents: leaseBalances[index]._sum.amountCents ?? 0,
    startDate: lease.startDate,
    endDate: lease.endDate,
  }))

  const documents = await prisma.document.findMany({
    where: {
      deletedAt: null,
      OR: [
        { subjectType: 'Tenant', subjectId: tenantId },
        { subjectType: 'Lease', subjectId: { in: leases.map((l) => l.id) } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, title: true, createdAt: true, content: true },
  })

  const feeInvoices = await prisma.invoice.findMany({
    where: {
      kind: 'fee',
      leaseId: { in: leases.map((lease) => lease.id) },
      status: { in: ['open', 'partially_paid'] },
    },
    orderBy: { issueDate: 'desc' },
    select: {
      id: true,
      number: true,
      facilityId: true,
      leaseId: true,
      issueDate: true,
      totalCents: true,
      amountPaidCents: true,
      lineItems: { select: { description: true }, take: 1 },
    },
  })
  const unitByLease = new Map(leases.map((lease) => [lease.id, lease.unit.number]))

  const holdsByLease = await Promise.all(
    leases.map(async (lease) =>
      (await activeHolds(lease.id)).map((hold) => ({
        ...hold,
        leaseId: lease.id,
        unitNumber: lease.unit.number,
      })),
    ),
  )

  const grants = await prisma.accessGrant.findMany({
    where: { tenantId, facilityId: { in: [...new Set(leases.map((lease) => lease.facilityId))] } },
    select: { id: true, state: true, facility: { select: { name: true } } },
  })
  const accessAudits = await prisma.auditLog.findMany({
    where: {
      entityType: 'AccessGrant',
      entityId: { in: grants.map((grant) => grant.id) },
      action: { in: ['access.suspended', 'access.restored'] },
    },
    orderBy: { occurredAt: 'desc' },
    select: { entityId: true, action: true, after: true },
  })
  const latestByGrant = new Map<string, (typeof accessAudits)[number]>()
  for (const entry of accessAudits) {
    if (!latestByGrant.has(entry.entityId)) latestByGrant.set(entry.entityId, entry)
  }

  return {
    tenantId,
    firstName: tenant.firstName,
    lastName: tenant.lastName,
    email: tenant.email,
    phone: tenant.phone,
    altContactName: tenant.altContactName,
    altContactPhone: tenant.altContactPhone,
    altContactEmail: tenant.altContactEmail,
    address,
    addressHistory: history,
    leases: leaseSummaries,
    // A tenant with leases at two facilities sums both — the profile is one
    // person's picture, and a partial total would understate what they owe.
    totalBalanceCents: leaseSummaries.reduce((sum, lease) => sum + lease.balanceCents, 0),
    waivableFees: feeInvoices
      .map((invoice) => ({
        invoiceId: invoice.id,
        number: invoice.number,
        facilityId: invoice.facilityId,
        unitNumber: unitByLease.get(invoice.leaseId) ?? '—',
        outstandingCents: invoice.totalCents - invoice.amountPaidCents,
        issuedOn: invoice.issueDate,
        description: invoice.lineItems[0]?.description ?? 'Fee',
      }))
      .filter((fee) => fee.outstandingCents > 0),
    holds: holdsByLease.flat(),
    refundable: await refundablePayments(tenantId),
    accessState: grants
      .map((grant) => {
        const latest = latestByGrant.get(grant.id)
        const summary = (latest?.after as { summary?: string } | null)?.summary
        return {
          facilityName: grant.facility.name,
          suspended: grant.state === 'suspended',
          // No audit entry means nothing automatic has ever touched this grant,
          // which is the ordinary case and reads as nothing rather than as a
          // reassuring sentence nobody asked for.
          summary: summary ?? '',
        }
      })
      .filter((row) => row.suspended || row.summary !== ''),
    notes: notes.map((note) => ({
      id: note.id,
      body: note.body,
      pinned: note.pinned,
      createdAt: note.createdAt,
      authorName: `${note.staffUser.firstName} ${note.staffUser.lastName}`,
    })),
    documents: documents.map((document) => ({
      id: document.id,
      type: document.type,
      title: document.title,
      createdAt: document.createdAt,
      hasContent: document.content !== null,
    })),
    messages,
    editableFacilityIds,
  }
}

// ── Mutations ────────────────────────────────────────────────────────────

export async function updateTenantContact(
  actor: Actor,
  tenantId: string,
  details: ContactDetails,
): Promise<FieldProblems> {
  const [facilityId] = await assertTenantAccess(actor, tenantId, 'tenants:edit')
  const problems = await updateContactDetails(tenantId, details)
  if (Object.keys(problems).length > 0) return problems

  await recordAudit({
    actor: toAuditActor(actor),
    facilityId,
    action: 'tenant.contact_updated',
    entityType: 'Tenant',
    entityId: tenantId,
  })
  return {}
}

export type AddressChangeResult = { ok: true } | { ok: false; problems: FieldProblems }

export async function updateTenantAddress(
  actor: Actor,
  tenantId: string,
  input: AddressInput,
): Promise<AddressChangeResult> {
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff access required')
  await assertTenantAccess(actor, tenantId, 'tenants:edit')

  const problems = validateAddress(input)
  if (Object.keys(problems).length > 0) return { ok: false, problems }

  // TenantAddress is its own append-only evidence trail (D-21) — source and
  // actor travel with the row itself, so nothing further is written to
  // AuditLog for this one.
  await recordAddressChange(tenantId, input, 'counter', { kind: 'staff', staffUserId: actor.staffUserId })
  return { ok: true }
}

export async function flagTenantAddressReturned(actor: Actor, tenantId: string, addressId: string): Promise<void> {
  const [facilityId] = await assertTenantAccess(actor, tenantId, 'tenants:edit')
  await flagReturnedMail(addressId)
  // PRD 02 US-13's own AC: this "creates a task... rather than sitting in a
  // folder." Attributed to whichever facility the flagging staffer reached
  // this tenant through — TenantAddress itself carries no facility (D-21),
  // so this is the only context that has one to hand.
  await createTask({
    facilityId,
    type: 'returned_mail_review',
    entityType: 'Tenant',
    entityId: tenantId,
  })
}

export async function addTenantNote(actor: Actor, tenantId: string, body: string): Promise<FieldProblems> {
  const trimmed = body.trim()
  if (!trimmed) return { body: 'Enter a note.' }
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff access required')

  const [facilityId] = await assertTenantAccess(actor, tenantId, 'tenants:edit')
  const note = await prisma.tenantNote.create({
    data: { tenantId, facilityId, staffUserId: actor.staffUserId, body: trimmed },
  })
  await recordAudit({
    actor: toAuditActor(actor),
    facilityId,
    action: 'tenant.note_added',
    entityType: 'TenantNote',
    entityId: note.id,
  })
  return {}
}

/// Pinning is display order, not content — the one field on an otherwise
/// immutable row that is allowed to change (see the model's own comment).
export async function setTenantNotePinned(actor: Actor, tenantId: string, noteId: string, pinned: boolean): Promise<void> {
  await assertTenantAccess(actor, tenantId, 'tenants:edit')
  const note = await prisma.tenantNote.findFirst({ where: { id: noteId, tenantId }, select: { id: true } })
  if (!note) throw new ForbiddenError(`Note ${noteId} does not belong to tenant ${tenantId}`)
  await prisma.tenantNote.update({ where: { id: noteId }, data: { pinned } })
}

export type LoggableDocumentType = Extract<DocumentType, 'id_copy' | 'insurance_proof' | 'other'>

export async function logTenantDocument(
  actor: Actor,
  tenantId: string,
  input: { type: LoggableDocumentType; title: string; note: string },
): Promise<FieldProblems> {
  const title = input.title.trim()
  if (!title) return { title: 'Enter a title.' }
  if (actor.kind !== 'staff') throw new ForbiddenError('Staff access required')

  const [facilityId] = await assertTenantAccess(actor, tenantId, 'tenants:edit')
  await logManualDocument({
    facilityId,
    type: input.type,
    subjectType: 'Tenant',
    subjectId: tenantId,
    title,
    note: input.note,
    actor: toAuditActor(actor),
  })
  return {}
}
