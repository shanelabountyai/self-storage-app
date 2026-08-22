import { prisma } from "@storage/db";

// PRD 01 §4.7 US-705. The tenant's own paperwork.
//
// Everything here is scoped by `tenantId` from the session. A document id in
// a URL must never be enough on its own: the store (B-023) is shared with
// notices, lien evidence and inspection photos, so an unscoped read would
// reach far more than a lease.

export type PortalDocument = {
  id: string;
  title: string;
  kind: "lease" | "receipt" | "other";
  createdAt: Date;
  unitNumber: string | null;
  /// Generated documents are HTML (B-023's decision — see lib/documents/
  /// render.ts). Nothing here is a PDF yet, so the UI says "view" rather
  /// than promising a download that would arrive as a web page.
  viewable: boolean;
  /// An uploaded file (B-104 follow-up), fetched through
  /// `/portal/documents/[id]/file` after an ownership check.
  downloadable: boolean;
};

/// The leases this tenant's documents can belong to — including ended ones.
///
/// Deliberately not filtered to occupying leases: a moved-out tenant still
/// needs last year's lease and receipts, which is most of why this screen
/// exists (P5's "receipts for bookkeeping").
async function leaseIdsFor(tenantId: string): Promise<Map<string, string>> {
  const leases = await prisma.lease.findMany({
    where: { tenantId },
    select: { id: true, unit: { select: { number: true } } },
  });
  return new Map(leases.map((lease) => [lease.id, lease.unit.number]));
}

export async function portalDocuments(
  tenantId: string,
): Promise<PortalDocument[]> {
  const leases = await leaseIdsFor(tenantId);
  if (leases.size === 0) return [];

  const documents = await prisma.document.findMany({
    where: {
      deletedAt: null,
      subjectType: "Lease",
      subjectId: { in: [...leases.keys()] },
      // Only what the tenant is a party to. The same store holds lien
      // evidence and inspection photos against these very leases, and those
      // are the operator's file, not the tenant's copy.
      // B-104 follow-up adds `insurance_proof`: the tenant uploaded it, so it
      // is plainly their copy too. `lien_evidence` and `inspection_photo` stay
      // out for the reason above — same store, operator's file.
      type: { in: ["lease", "receipt", "insurance_proof"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      type: true,
      createdAt: true,
      subjectId: true,
      content: true,
      storageRef: true,
    },
  });

  return documents.map((document) => ({
    id: document.id,
    title: document.title,
    kind:
      document.type === "lease"
        ? "lease"
        : document.type === "receipt"
          ? "receipt"
          : "other",
    createdAt: document.createdAt,
    unitNumber: leases.get(document.subjectId) ?? null,
    viewable: Boolean(document.content),
    // An uploaded file, served through the authenticated download route rather
    // than rendered — its bytes are not ours and never go near the HTML path.
    downloadable: Boolean(document.storageRef),
  }));
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
    where: {
      id: documentId,
      deletedAt: null,
      subjectType: "Lease",
      type: { in: ["lease", "receipt"] },
    },
    select: { title: true, content: true, subjectId: true },
  });
  if (!document?.content) return null;

  const owns = await prisma.lease.findFirst({
    where: { id: document.subjectId, tenantId },
    select: { id: true },
  });
  if (!owns) return null;

  return { title: document.title, content: document.content };
}

export type PortalReceipt = {
  paymentId: string;
  amountCents: number;
  receivedAt: Date;
  unitNumber: string | null;
  /// B-146. The bank took this one back. Listed rather than hidden, and said
  /// out loud rather than listed silently: the tenant is holding a receipt for
  /// it and is about to be chased for the period it paid, and a payment history
  /// that quietly drops it leaves them with a dunning notice and no explanation
  /// on the one screen that is theirs.
  returned: boolean;
};

/// Payments, as the receipt list US-705 asks for.
///
/// Read from `Payment` rather than the document store because nothing
/// generates a receipt document yet (B-050 owns the receipt itself). This is
/// the honest version: every payment we actually took, listed, with the
/// generated PDF still to come.
export async function portalPayments(
  tenantId: string,
): Promise<PortalReceipt[]> {
  const payments = await prisma.payment.findMany({
    where: {
      tenantId,
      status: {
        in: ["succeeded", "partially_refunded", "refunded", "returned"],
      },
    },
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: {
      id: true,
      amountCents: true,
      receivedAt: true,
      status: true,
      ledgerEntries: { select: { leaseId: true }, take: 1 },
    },
  });

  const leases = await leaseIdsFor(tenantId);
  return payments.map((payment) => ({
    paymentId: payment.id,
    amountCents: payment.amountCents,
    receivedAt: payment.receivedAt,
    unitNumber: leases.get(payment.ledgerEntries[0]?.leaseId ?? "") ?? null,
    returned: payment.status === "returned",
  }));
}

/// Whether this tenant may download this uploaded document.
///
/// Deliberately separate from `portalDocument`, which is about GENERATED
/// documents and returns their markup. Same ownership rule, different answer:
/// this one says yes or no and hands the caller nothing, so a route cannot
/// accidentally serve bytes it never checked.
export async function tenantOwnsDocument(
  tenantId: string,
  documentId: string,
): Promise<boolean> {
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      deletedAt: null,
      subjectType: "Lease",
      type: { in: ["lease", "receipt", "insurance_proof"] },
      storageRef: { not: null },
    },
    select: { subjectId: true },
  });
  if (!document) return false;

  const owns = await prisma.lease.findFirst({
    where: { id: document.subjectId, tenantId },
    select: { id: true },
  });
  return owns !== null;
}
