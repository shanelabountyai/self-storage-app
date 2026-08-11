import { requireTenantActor } from '@/lib/rbac/session'
import { tenantOwnsDocument } from '@/lib/portal/documents'
import { downloadHeaders, readUpload } from '@/lib/documents/storage'

// PRD 02 US-16 (B-104 follow-up). The only way an uploaded file leaves the
// system for a tenant.
//
// The blob URL is never handed to the browser and this route never redirects to
// it: a redirect would put an unguessable-but-permanent URL in the address bar,
// in history and in every referrer after it, and the object behind it is
// readable by anyone holding it. The bytes are proxied instead.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await params
  const actor = await requireTenantActor()

  // Checked BEFORE anything is fetched. `readUpload` does no permission work of
  // its own, by design — one half-check plus another half-check is how bytes
  // get served to the wrong person.
  if (!(await tenantOwnsDocument(actor.tenantId, documentId))) {
    return new Response('Not found', { status: 404 })
  }

  const result = await readUpload(documentId)
  if (!result.ok) {
    // Every failure is a 404, including "the blob has gone". A tenant cannot do
    // anything with the difference, and distinguishing them would confirm that
    // a document id exists.
    return new Response('Not found', { status: 404 })
  }

  return new Response(Buffer.from(result.bytes), {
    headers: downloadHeaders(result.mimeType, result.filename),
  })
}
