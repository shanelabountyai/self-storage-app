import { prisma } from '@storage/db'

// PRD 01 §4.7 US-705. The tenant's own paperwork.
//
// Everything here is scoped by `tenantId` from the session. A document id in
// a URL must never be enough on its own: the store (B-023) is shared with
// notices, lien evidence and inspection photos, so an unscoped read would
// reach far more than a lease.

export type PortalDocument = {
  id: string
  title: string
  kind: 'lease' | 'receipt' | 'other'
  createdAt: Date
  unitNumber: string | null
  /// Generated documents are HTML (B-023's decision — see lib/documents/
  /// render.ts). Nothing here is a PDF yet, so the UI says "view" rather
  /// than promising a download that would arrive as a web page.
  viewable: boolean
}

/// The leases this tenant's documents can belong to — including ended ones.
///
/// Deliberately not filtered to occupying leases: a moved-out tenant still
/// needs last year's lease and receipts, which is most of why this screen
/// exists (P5's "receipts for bookkeeping").
async function leaseIdsFor(tenantId: string): Promise<Map<string, string>> {
  const leases = await prisma.lease.findMany({
    where: { tenantId },
    select: { id: true, unit: { select: { number: true } } },
  })
  return new Map(leases.map((lease) => [lease.id, lease.unit.number]))
}

export async function portalDocuments(tenantId: string): Promise<PortalDocument[]> {
  const leases = await leaseIdsFor(tenantId)
  if (leases.size === 0) return []

  const documents = await prisma.document.findMany({
    where: {
      deletedAt: null,
      subjectType: 'Lease',
      subjectId: { in: [...leases.keys()] },
      // Only what the tenant is a party to. The same store holds lien
      // evidence and inspection photos against these very leases, and those
      // are the operator's file, not the tenant's copy.
      type: { in: ['lease', 'receipt'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, type: true, createdAt: true, subjectId: true, content: true },
  })

  return documents.map((document) => ({
    id: document.id,
    title: document.title,
    kind: document.type === 'lease' ? 'lease' : document.type === 'receipt' ? 'receipt' : 'other',
    createdAt: document.createdAt,
    unitNumber: leases.get(document.subjectId) ?? null,
    viewable: Boolean(document.content),
  }))
}

/// One document, only if it belongs to this tenant.
///
/// The scoping is a join back through the tenant's own leases rather than a
/// field on the document, because `Document.subjectId` is a loose string by
/// design (B-023) and cannot be constrained to a tenant any other way.
export async function portalDocument(
  tenantId: string,
  documentId: string,
): Promise<{ title: string; content: string } | null> {
  const document = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null, subjectType: 'Lease', type: { in: ['lease', 'receipt'] } },
    select: { title: true, content: true, subjectId: true },
  })
  if (!document?.content) return null

  const owns = await prisma.lease.findFirst({
    where: { id: document.subjectId, tenantId },
    select: { id: true },
  })
  if (!owns) return null

  return { title: document.title, content: document.content }
}

export type PortalReceipt = {
  paymentId: string
  amountCents: number
  receivedAt: Date
  unitNumber: string | null
}

/// Payments, as the receipt list US-705 asks for.
///
/// Read from `Payment` rather than the document store because nothing
/// generates a receipt document yet (B-050 owns the receipt itself). This is
/// the honest version: every payment we actually took, listed, with the
/// generated PDF still to come.
export async function portalPayments(tenantId: string): Promise<PortalReceipt[]> {
  const payments = await prisma.payment.findMany({
    where: { tenantId, status: { in: ['succeeded', 'partially_refunded', 'refunded'] } },
    orderBy: { receivedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      amountCents: true,
      receivedAt: true,
      ledgerEntries: { select: { leaseId: true }, take: 1 },
    },
  })

  const leases = await leaseIdsFor(tenantId)
  return payments.map((payment) => ({
    paymentId: payment.id,
    amountCents: payment.amountCents,
    receivedAt: payment.receivedAt,
    unitNumber: leases.get(payment.ledgerEntries[0]?.leaseId ?? '') ?? null,
  }))
}
