import { type Prisma, prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import type { AuditActor } from '@storage/core/audit'
import { hashContent, renderDocument, type RenderedDocument } from './render'

// PRD 02 US-16. One document store, used by every feature that produces or
// receives a document. Storing bytes is a separate problem from recording that
// a document exists — see the note at the bottom.

export type DocumentType =
  | 'lease'
  | 'receipt'
  | 'notice'
  | 'insurance_proof'
  | 'id_copy'
  | 'inspection_photo'
  | 'lien_evidence'
  | 'other'

export type StoreGeneratedInput = {
  facilityId: string
  type: DocumentType
  subjectType: string
  subjectId: string
  title: string
  template: string
  values: Record<string, string>
  actor?: AuditActor
}

/// Renders a template and stores the result. Throws `MissingMergeFieldsError`
/// before anything is written, so a template with a hole in it never becomes a
/// stored document.
export async function storeGeneratedDocument(
  input: StoreGeneratedInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ id: string; rendered: RenderedDocument }> {
  const rendered = renderDocument({
    title: input.title,
    template: input.template,
    values: input.values,
  })

  const document = await client.document.create({
    data: {
      facilityId: input.facilityId,
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      title: rendered.title,
      content: rendered.html,
      mimeType: 'text/html; charset=utf-8',
      byteSize: Buffer.byteLength(rendered.html, 'utf8'),
      contentHash: rendered.contentHash,
    },
  })

  if (input.actor) {
    await recordAudit(
      {
        actor: input.actor,
        facilityId: input.facilityId,
        action: 'document.generated',
        entityType: 'Document',
        entityId: document.id,
        context: { type: input.type, subjectType: input.subjectType, subjectId: input.subjectId },
      },
      client,
    )
  }

  return { id: document.id, rendered }
}

/// Documents for a subject, newest first. Soft-deleted ones are excluded —
/// callers that want them ask for them explicitly, because that is an
/// admin/audit question rather than a display one.
export async function documentsFor(subjectType: string, subjectId: string) {
  return prisma.document.findMany({
    where: { subjectType, subjectId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  })
}

/// US-16: deletion is soft, admin-only and audit-logged. Evidence is not
/// something a mis-click removes, and a lien file that loses a notice is a
/// wrongful-sale claim.
///
/// The reason code is required by the audit layer (B-005), not by politeness:
/// `document.deleted` is on the list of actions that cannot be recorded without
/// one, so "why" is captured at the moment it is known rather than reconstructed
/// from a timestamp later.
export async function softDeleteDocument(
  documentId: string,
  actor: AuditActor,
  reasonCode: string,
): Promise<void> {
  const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } })
  await prisma.$transaction(async (tx) => {
    await tx.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } })
    await recordAudit(
      {
        actor,
        facilityId: document.facilityId,
        action: 'document.deleted',
        entityType: 'Document',
        entityId: documentId,
        reasonCode,
        context: { type: document.type },
      },
      tx,
    )
  })
}

/// Answers the only question an audit or a dispute actually asks: is this still
/// the document that was signed?
export async function verifyDocument(documentId: string): Promise<
  { ok: true } | { ok: false; reason: 'not_found' | 'no_content' | 'hash_mismatch' }
> {
  const document = await prisma.document.findUnique({ where: { id: documentId } })
  if (!document) return { ok: false, reason: 'not_found' }
  // An uploaded file's bytes are not in the database, so its hash cannot be
  // recomputed here. Saying so beats returning a confident "ok".
  if (document.content === null) return { ok: false, reason: 'no_content' }
  return hashContent(document.content) === document.contentHash
    ? { ok: true }
    : { ok: false, reason: 'hash_mismatch' }
}

// ── Uploaded files ───────────────────────────────────────────────────────────
//
// `storageRef` exists and nothing writes it. Uploads (US-16's ID copies and
// insurance certificates, B-022's declaration pages, B-062's auction photos)
// need somewhere to put bytes, and no blob store is configured — that is a
// vendor decision this project has not taken, and inventing a local filesystem
// path would not survive a serverless deploy. Generated documents do not need
// one: they are text, they are small, and keeping them in the row means the
// hash and the content can never drift apart.

export type LogManualDocumentInput = {
  facilityId: string
  type: Extract<DocumentType, 'id_copy' | 'insurance_proof' | 'other'>
  subjectType: string
  subjectId: string
  title: string
  /// What staff typed, not a file's bytes — see the note above. A blank note
  /// still records that the document exists (e.g. "ID copy on file at the
  /// counter"), which is real information even with nothing to view online.
  note?: string
  actor: AuditActor
}

/// Records that a document exists, without any bytes to back it (see above).
/// The honest counterpart to `storeGeneratedDocument`: that function stores
/// content this app rendered and can hash; this one stores what a staffer
/// typed about something that physically exists elsewhere, typed exactly as
/// entered rather than templated.
export async function logManualDocument(
  input: LogManualDocumentInput,
): Promise<{ id: string }> {
  const content = input.note?.trim() || null
  const document = await prisma.document.create({
    data: {
      facilityId: input.facilityId,
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      title: input.title,
      content,
      mimeType: 'text/plain; charset=utf-8',
      byteSize: content ? Buffer.byteLength(content, 'utf8') : 0,
      contentHash: hashContent(content ?? ''),
    },
  })

  await recordAudit({
    actor: input.actor,
    facilityId: input.facilityId,
    action: 'document.logged',
    entityType: 'Document',
    entityId: document.id,
    context: { type: input.type, subjectType: input.subjectType, subjectId: input.subjectId },
  })

  return { id: document.id }
}
