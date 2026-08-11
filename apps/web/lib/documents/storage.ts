import { createHash, randomUUID } from 'node:crypto'
import { prisma, type DocumentType } from '@storage/db'
import {
  checkUpload,
  safeDisplayName,
  storagePath,
  UPLOAD_PROBLEM_MESSAGES,
  type AcceptedUploadType,
  type UploadProblem,
} from '@storage/core/documents'

// PRD 02 US-16 / FR-6. Bytes somebody uploaded, kept somewhere.
//
// B-023 built the `Document` table and left `storageRef` unwritten because
// there was no blob store; the B-104 follow-up chose one. **Vercel Blob**, for
// the same reason the rest of the stack is what it is: the app deploys on
// Vercel, so this is one token rather than a second cloud account, a second
// IAM policy and a second set of credentials to rotate.
//
// Two rules shape everything below.
//
//   1. **The blob URL never reaches a browser.** Vercel Blob serves public
//      objects from its own domain to anyone holding the URL, and a declaration
//      page carries a name, an address and a policy number. The path is random
//      and is treated as a secret: reads go through our own route, which checks
//      who is asking first. A redirect would defeat that — the URL would be in
//      the address bar and in every referrer after it.
//   2. **The stored type comes from the bytes**, never from the upload. See
//      packages/core/documents/upload.ts.

/// The seam an uploader is injected through — tests pass a fake rather than
/// reaching a real bucket. Not an interface with one implementation: it is a
/// default parameter, and the real one is right below it.
export type BlobPutter = (
  path: string,
  bytes: Uint8Array,
  contentType: string,
) => Promise<{ url: string }>

export type BlobGetter = (url: string) => Promise<Uint8Array | null>

export function blobStorageConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
}

const putToVercelBlob: BlobPutter = async (path, bytes, contentType) => {
  const { put } = await import('@vercel/blob')
  const result = await put(path, Buffer.from(bytes), {
    // Vercel Blob's only general access level. The protection is that the
    // pathname is a UUID nobody can guess and that we never publish it — see
    // rule 1 above, and `readUpload` below, which is the only way out.
    access: 'public',
    contentType,
    // Off: Vercel would otherwise append a random suffix of its own, and the
    // path we computed is already unguessable and is what we store.
    addRandomSuffix: false,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })
  return { url: result.url }
}

const getFromVercelBlob: BlobGetter = async (url) => {
  const response = await fetch(url)
  if (!response.ok) return null
  return new Uint8Array(await response.arrayBuffer())
}

export type StoreResult =
  | { ok: true; documentId: string; mimeType: AcceptedUploadType; byteSize: number }
  | { ok: false; problem: UploadProblem | 'not_configured'; message: string }

/// Validates, stores the bytes, and writes the `Document` row.
///
/// The row is written AFTER the upload succeeds, deliberately — the opposite of
/// the payment path's order. A `Document` row whose `storageRef` points at
/// nothing is a broken link in an evidence chain, and unlike a payment there is
/// no external party who might have acted on it in between. A blob with no row
/// is merely litter.
export async function storeUpload(
  input: {
    facilityId: string
    type: DocumentType
    subjectType: string
    subjectId: string
    bytes: Uint8Array
    declaredType?: string | null
    filename?: string | null
    fallbackTitle: string
  },
  put: BlobPutter = putToVercelBlob,
): Promise<StoreResult> {
  const verdict = checkUpload({ bytes: input.bytes, declaredType: input.declaredType })
  if (!verdict.ok) {
    return { ok: false, problem: verdict.problem, message: UPLOAD_PROBLEM_MESSAGES[verdict.problem] }
  }

  if (!blobStorageConfigured() && put === putToVercelBlob) {
    // Degrades honestly, the same posture an unconfigured Stripe key or
    // encryption key takes: the caller keeps whatever it can record without
    // bytes rather than pretending the file was kept.
    return {
      ok: false,
      problem: 'not_configured',
      message: 'File uploads are not switched on here yet. Your details were saved — email or bring in the document and we will attach it.',
    }
  }

  const path = storagePath({
    facilityId: input.facilityId,
    documentType: input.type,
    random: randomUUID(),
    mimeType: verdict.mimeType,
  })

  const stored = await put(path, input.bytes, verdict.mimeType)

  const document = await prisma.document.create({
    data: {
      facilityId: input.facilityId,
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      title: safeDisplayName(input.filename, input.fallbackTitle),
      // Uploaded documents have no `content`. That is what keeps them off the
      // HTML-rendering path the portal document viewer uses — its own comment
      // warns that anything storing tenant-authored markup there has to
      // sanitise first, and the answer here is that nothing tenant-authored
      // ever goes in that column.
      content: null,
      storageRef: stored.url,
      mimeType: verdict.mimeType,
      byteSize: verdict.byteSize,
      // The same evidence hash generated documents carry: a file whose hash no
      // longer matches is a file that changed after it was accepted.
      contentHash: createHash('sha256').update(input.bytes).digest('hex'),
    },
  })

  return {
    ok: true,
    documentId: document.id,
    mimeType: verdict.mimeType,
    byteSize: verdict.byteSize,
  }
}

export type ReadResult =
  | { ok: true; bytes: Uint8Array; mimeType: string; filename: string }
  | { ok: false; reason: 'not_found' | 'not_a_file' | 'gone' }

/// Fetches the bytes for a document the CALLER HAS ALREADY AUTHORISED.
///
/// This function does no permission checking of its own and must never be
/// called before one has been made — every caller is a route that has already
/// established who is asking. Kept deliberately dumb so there is no chance of
/// two half-checks that each assume the other did it.
export async function readUpload(
  documentId: string,
  get: BlobGetter = getFromVercelBlob,
): Promise<ReadResult> {
  const document = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { storageRef: true, mimeType: true, title: true },
  })
  if (!document) return { ok: false, reason: 'not_found' }
  if (!document.storageRef) return { ok: false, reason: 'not_a_file' }

  const bytes = await get(document.storageRef)
  if (!bytes) return { ok: false, reason: 'gone' }

  return { ok: true, bytes, mimeType: document.mimeType, filename: document.title }
}

/// The headers a downloaded upload is served with.
///
/// All three matter. `nosniff` stops a browser deciding a file is HTML despite
/// what we say; `attachment` means even a type we got wrong is downloaded
/// rather than rendered in our origin; and the strict CSP is the third belt,
/// so a PDF viewer cannot fetch or script anything if one is ever rendered
/// inline by an extension.
export function downloadHeaders(mimeType: string, filename: string): HeadersInit {
  return {
    'Content-Type': mimeType,
    'Content-Disposition': `attachment; filename="${safeDisplayName(filename, 'document')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    // Never cached by a shared cache: this is somebody's insurance paperwork.
    'Cache-Control': 'private, no-store',
  }
}
