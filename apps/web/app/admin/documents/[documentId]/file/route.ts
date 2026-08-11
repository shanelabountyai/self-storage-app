import { prisma } from '@storage/db'
import { getAdminActor } from '@/lib/admin/context'
import { assertFacilityAccess, can, ForbiddenError } from '@/lib/rbac/authorize'
import { downloadHeaders, readUpload } from '@/lib/documents/storage'

// PRD 02 US-16 (B-104 follow-up). Staff download for an uploaded file.
//
// Its own route rather than a shared one with the portal: the two answer
// different questions ("is this tenant a party to it" versus "does this staffer
// hold this facility"), and a single route taking either kind of actor is how
// one of the two checks eventually gets skipped.
//
// The blob URL is never redirected to — see lib/documents/storage.ts.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await params
  const actor = await getAdminActor()

  const document = await prisma.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: { facilityId: true },
  })
  if (!document) return new Response('Not found', { status: 404 })

  try {
    assertFacilityAccess(actor, document.facilityId)
    if (!can(actor, 'tenants:view', document.facilityId)) {
      throw new ForbiddenError('Missing permission to read a document', 'tenants:view', document.facilityId)
    }
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response('Not found', { status: 404 })
    throw error
  }

  const result = await readUpload(documentId)
  if (!result.ok) return new Response('Not found', { status: 404 })

  return new Response(Buffer.from(result.bytes), {
    headers: downloadHeaders(result.mimeType, result.filename),
  })
}
