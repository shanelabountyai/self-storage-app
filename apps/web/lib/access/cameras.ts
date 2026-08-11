import { prisma } from '@storage/db'
import { recordAudit } from '@storage/core/audit'
import { requirePermission } from '@/lib/rbac/authorize'
import type { Actor } from '@/lib/rbac/actor'
import { toAuditActor } from '@/lib/rbac/audit-actor'

// PRD 03 FR-10 (B-080). "Facility config stores labeled camera-viewer URLs
// (vendor NVR/cloud viewer); rendered as external links or sandboxed iframes in
// the facility page in admin; no credentials proxied, no video handled."
//
// Links only, no iframes — which is FR-10's own floor and OQ-8's expectation
// ("some vendor viewers forbid iframing (X-Frame-Options); links-only may be
// the floor"). An iframe that silently renders a blank box because the vendor
// sent `X-Frame-Options: DENY` is worse than a link that works: staff cannot
// tell a refused frame from a dead camera, and the one time it matters is the
// one time somebody is standing in the office trying to see the gate.

export type CameraLink = {
  id: string
  label: string
  url: string
  sortOrder: number
}

export class InvalidCameraUrlError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.name = 'InvalidCameraUrlError'
    this.reason = reason
  }
}

/// Validates a viewer URL before it is stored.
///
/// Exported and pure so the rules are testable without a database, and because
/// each one is here for a reason rather than as generic hygiene:
///
///   - **https only.** A camera viewer opened over http sends whatever session
///     the browser has in the clear, on a network shared with the gate.
///   - **no embedded credentials.** SR-1 forbids storing vendor passwords
///     anywhere "including 'temporary' admin notes fields", and
///     `https://admin:hunter2@nvr.example.com` is exactly that with the
///     password hidden in plain sight in a URL bar.
///   - **no javascript:/data:.** A stored `javascript:` URL rendered as a link
///     in the admin is stored XSS with extra steps.
export function validateCameraUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new InvalidCameraUrlError('Enter a full web address, starting with https://')
  }

  if (url.protocol !== 'https:') {
    throw new InvalidCameraUrlError(
      'Camera links must start with https:// — an http viewer sends its login over the network in the clear.',
    )
  }
  if (url.username || url.password) {
    throw new InvalidCameraUrlError(
      'Remove the username and password from the address. Credentials are never stored here — sign in to the viewer itself.',
    )
  }

  return url
}

export async function facilityCameras(facilityId: string): Promise<CameraLink[]> {
  const rows = await prisma.facilityCamera.findMany({
    where: { facilityId },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    url: row.url,
    sortOrder: row.sortOrder,
  }))
}

export async function addCamera(
  actor: Actor,
  input: { facilityId: string; label: string; url: string; sortOrder?: number },
): Promise<CameraLink> {
  requirePermission(actor, 'facility:settings', input.facilityId)

  const url = validateCameraUrl(input.url)
  const label = input.label.trim()
  if (!label) throw new InvalidCameraUrlError('Give the camera a name staff will recognise.')

  const created = await prisma.facilityCamera.create({
    data: {
      facilityId: input.facilityId,
      label,
      url: url.toString(),
      sortOrder: input.sortOrder ?? 0,
    },
  })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'gate.camera_link_changed',
    entityType: 'Facility',
    entityId: input.facilityId,
    facilityId: input.facilityId,
    // The host, not the full URL. A viewer path can carry a site or camera
    // token, and the audit log is read by more people than the settings screen.
    context: { change: 'added', label, host: url.host },
  })

  return { id: created.id, label: created.label, url: created.url, sortOrder: created.sortOrder }
}

export async function removeCamera(actor: Actor, cameraId: string): Promise<void> {
  const camera = await prisma.facilityCamera.findUniqueOrThrow({
    where: { id: cameraId },
    select: { facilityId: true, label: true, url: true },
  })
  requirePermission(actor, 'facility:settings', camera.facilityId)

  await prisma.facilityCamera.delete({ where: { id: cameraId } })

  await recordAudit({
    actor: toAuditActor(actor),
    action: 'gate.camera_link_changed',
    entityType: 'Facility',
    entityId: camera.facilityId,
    facilityId: camera.facilityId,
    context: { change: 'removed', label: camera.label, host: safeHost(camera.url) },
  })
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).host
  } catch {
    return 'unknown'
  }
}
