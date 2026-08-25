import { prisma } from "@storage/db";
import { OCCUPYING_LEASE_STATUSES } from "@storage/core/inventory";

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
  /// B-179. What a tenant can DO about a returned payment, present only when
  /// this row is one. Absent on every ordinary payment, and the queries behind
  /// it do not run when the list has no returns.
  return: ReturnedPaymentContext | null;
};

/// B-179. The screen used to tell the tenant to ring the office to do something
/// the pay route does in three taps. This is what turns that instruction into
/// an action.
export type ReturnedPaymentContext = {
  /// The lease the reversed payment was posted against, for `/portal/pay`.
  leaseId: string;
  /// What is now owed on that lease — the reversal and any returned-payment fee
  /// are both in it, because `payableLease` sums the same ledger. Null when the
  /// lease can no longer take an online payment (moved out, or nothing owed),
  /// in which case the screen offers the facility's phone instead of a link to
  /// a page that would say "we couldn't find that unit".
  payableCents: number | null;
  /// The facility's own line, so `phoneFor` can prefer it over the org number.
  facilityPhone: string | null;
  /// The returned-payment fee actually charged on THIS return, or 0 when it was
  /// waived or the facility has priced none.
  ///
  /// Read from the `payment.returned` audit entry, which is the only record
  /// tying the fee to the payment: `assessNsfFee` raises an ordinary fee
  /// invoice and nothing on `Invoice` points back at the payment that caused
  /// it. Matching on the line description instead would be guesswork, and this
  /// figure decides whether the tenant understands their own balance.
  feeCents: number;
};

/// Gathers the three facts a returned row needs, in one pass over the returns.
///
/// Runs only when there is at least one — a payment list with no returns, which
/// is nearly all of them, costs nothing.
async function returnedPaymentContexts(
  tenantId: string,
  returns: { paymentId: string; leaseId: string | null }[],
): Promise<Map<string, ReturnedPaymentContext>> {
  const leaseIds = [
    ...new Set(returns.map((r) => r.leaseId).filter((id) => id !== null)),
  ];
  if (leaseIds.length === 0) return new Map();

  const [leases, balances, audits] = await Promise.all([
    // Scoped by `tenantId` as well as by id: these ids came from ledger entries
    // on this tenant's payments, but the rule on this file is that a read never
    // relies on an earlier one having been scoped.
    prisma.lease.findMany({
      where: { id: { in: leaseIds }, tenantId },
      select: { id: true, status: true, facility: { select: { phone: true } } },
    }),
    prisma.ledgerEntry.groupBy({
      by: ["leaseId"],
      where: { leaseId: { in: leaseIds } },
      _sum: { amountCents: true },
    }),
    prisma.auditLog.findMany({
      where: {
        entityType: "Payment",
        action: "payment.returned",
        entityId: { in: returns.map((r) => r.paymentId) },
      },
      select: { entityId: true, after: true },
      orderBy: { occurredAt: "desc" },
    }),
  ]);

  const byLease = new Map(leases.map((lease) => [lease.id, lease]));
  const balanceFor = new Map(
    balances.map((row) => [row.leaseId, row._sum.amountCents ?? 0]),
  );
  // Newest first above, so the first entry per payment wins — a payment can
  // only be returned once, but the log is append-only and a correction would
  // arrive as a second row rather than an edit.
  const feeFor = new Map<string, number>();
  for (const entry of audits) {
    if (feeFor.has(entry.entityId)) continue;
    const after = entry.after as Record<string, unknown> | null;
    const cents = after?.feeCents;
    feeFor.set(entry.entityId, typeof cents === "number" ? cents : 0);
  }

  const contexts = new Map<string, ReturnedPaymentContext>();
  for (const item of returns) {
    if (item.leaseId === null) continue;
    const lease = byLease.get(item.leaseId);
    if (!lease) continue;
    const balance = balanceFor.get(item.leaseId) ?? 0;
    const payable =
      (OCCUPYING_LEASE_STATUSES as readonly string[]).includes(lease.status) &&
      balance > 0;
    contexts.set(item.paymentId, {
      leaseId: item.leaseId,
      payableCents: payable ? balance : null,
      facilityPhone: lease.facility.phone,
      feeCents: feeFor.get(item.paymentId) ?? 0,
    });
  }
  return contexts;
}

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
  const contexts = await returnedPaymentContexts(
    tenantId,
    payments
      .filter((payment) => payment.status === "returned")
      .map((payment) => ({
        paymentId: payment.id,
        leaseId: payment.ledgerEntries[0]?.leaseId ?? null,
      })),
  );

  return payments.map((payment) => ({
    paymentId: payment.id,
    amountCents: payment.amountCents,
    receivedAt: payment.receivedAt,
    unitNumber: leases.get(payment.ledgerEntries[0]?.leaseId ?? "") ?? null,
    returned: payment.status === "returned",
    return: contexts.get(payment.id) ?? null,
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
