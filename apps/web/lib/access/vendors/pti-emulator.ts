import { prisma } from '@storage/db'
import { hashCode } from '../secret'

// PRD 03 §8 Phase 2 (B-080): a stub vendor adapter "shaped from public
// integration behavior (no partner credentials; runs against simulator in
// 'vendor emulation' profiles)".
//
// THIS FILE IS THE FAKE VENDOR, not our driver. It deliberately speaks a shape
// that is NOT ours, because a stub that mirrored our own port would prove
// nothing — the entire learning payload D-18 kept is "does the port survive a
// differently-shaped third-party API", and a fake vendor designed to be
// convenient to call cannot answer that. So:
//
//   - It has no concept of a "command". It has `upsertKeypadUser`,
//     `setUserStatus` and `assignTimeZone`, and one of them does two of our
//     things at once.
//   - It identifies people by ITS OWN `ptiUserId`, not by our credential id.
//   - Time windows are numbered "time zones" (1 = always, 2 = site hours),
//     which is how PTI's product actually models them — not a schedule blob.
//   - It answers with HTTP-ish status codes and vendor error strings, so the
//     adapter has to decide what is retryable rather than being told.
//   - It rejects a code that is not exactly 4–8 digits, because real keypads do.
//
// It is backed by `SimulatedGateCode` so the virtual keypad, the event
// simulator and reconciliation all keep working against one controller. That is
// the "vendor emulation profile": same hardware underneath, a different API
// bolted to the front of it.
//
// No network calls, no credentials, no partner agreement — D-4 and D-18 both
// hold. This must never be pointed at a live site.

export type PtiResponse<T = undefined> =
  | { status: 200; body: T }
  | { status: 400 | 404 | 409; error: string }
  | { status: 429 | 500 | 503; error: string }

export type PtiKeypadUser = {
  ptiUserId: string
  /// The vendor's opaque handle on the tenant. We put our credential id here,
  /// which is exactly the sort of thing a driver has to decide.
  externalRef: string
  pin: string
  status: 'enabled' | 'disabled'
  /// 1 = always, 2 = site hours. A number, not a schedule.
  timeZoneId: number
}

/// PTI's numbered access windows, as a driver has to map onto them.
export const PTI_TIME_ZONE_ALWAYS = 1
export const PTI_TIME_ZONE_SITE_HOURS = 2

function badPin(pin: string): boolean {
  return !/^\d{4,8}$/.test(pin)
}

/// Creates or updates a keypad user. Note that it sets the PIN and the status
/// in ONE call — our port has `set_credential` and `suspend_access` as separate
/// commands, and reconciling that is the driver's problem, which is the point.
export async function upsertKeypadUser(input: {
  siteId: string
  externalRef: string
  pin: string
  status: 'enabled' | 'disabled'
  timeZoneId: number
}): Promise<PtiResponse<PtiKeypadUser>> {
  if (badPin(input.pin)) {
    return { status: 400, error: 'PIN must be 4-8 digits' }
  }
  if (input.timeZoneId !== PTI_TIME_ZONE_ALWAYS && input.timeZoneId !== PTI_TIME_ZONE_SITE_HOURS) {
    return { status: 400, error: `Unknown time zone ${input.timeZoneId}` }
  }

  const row = await prisma.simulatedGateCode.upsert({
    where: { credentialId: input.externalRef },
    create: {
      facilityId: input.siteId,
      credentialId: input.externalRef,
      code: input.pin,
      active: input.status === 'enabled',
      windowExempt: input.timeZoneId === PTI_TIME_ZONE_ALWAYS,
      windowSchedule: input.timeZoneId === PTI_TIME_ZONE_SITE_HOURS ? ptiSiteHours() : undefined,
    },
    update: {
      code: input.pin,
      active: input.status === 'enabled',
      windowExempt: input.timeZoneId === PTI_TIME_ZONE_ALWAYS,
      windowSchedule: input.timeZoneId === PTI_TIME_ZONE_SITE_HOURS ? ptiSiteHours() : undefined,
    },
  })

  return { status: 200, body: toUser(row) }
}

/// Status only. A vendor that makes you fetch-then-write to change one field is
/// common, and it is why the driver cannot suspend somebody without already
/// knowing their PIN — the thing that shapes `PtiCloudAdapter.send`.
export async function setUserStatus(input: {
  siteId: string
  externalRef: string
  status: 'enabled' | 'disabled'
}): Promise<PtiResponse<PtiKeypadUser>> {
  const existing = await prisma.simulatedGateCode.findUnique({
    where: { credentialId: input.externalRef },
  })
  if (!existing || existing.facilityId !== input.siteId) {
    return { status: 404, error: 'No such keypad user at this site' }
  }

  const row = await prisma.simulatedGateCode.update({
    where: { credentialId: input.externalRef },
    data: { active: input.status === 'enabled' },
  })
  return { status: 200, body: toUser(row) }
}

export async function assignTimeZone(input: {
  siteId: string
  externalRef: string
  timeZoneId: number
}): Promise<PtiResponse<PtiKeypadUser>> {
  if (input.timeZoneId !== PTI_TIME_ZONE_ALWAYS && input.timeZoneId !== PTI_TIME_ZONE_SITE_HOURS) {
    return { status: 400, error: `Unknown time zone ${input.timeZoneId}` }
  }
  const existing = await prisma.simulatedGateCode.findUnique({
    where: { credentialId: input.externalRef },
  })
  if (!existing || existing.facilityId !== input.siteId) {
    return { status: 404, error: 'No such keypad user at this site' }
  }

  const row = await prisma.simulatedGateCode.update({
    where: { credentialId: input.externalRef },
    data: {
      windowExempt: input.timeZoneId === PTI_TIME_ZONE_ALWAYS,
      windowSchedule: input.timeZoneId === PTI_TIME_ZONE_SITE_HOURS ? ptiSiteHours() : undefined,
    },
  })
  return { status: 200, body: toUser(row) }
}

export async function deleteKeypadUser(input: {
  siteId: string
  externalRef: string
}): Promise<PtiResponse> {
  const existing = await prisma.simulatedGateCode.findUnique({
    where: { credentialId: input.externalRef },
  })
  // Deleting something that is already gone answers 200, not 404. Real vendor
  // APIs vary, and a driver that treats "already deleted" as a hard failure
  // dead-letters a revoke that has in fact succeeded — which is the worst way
  // to be wrong about a gate.
  if (!existing || existing.facilityId !== input.siteId) return { status: 200, body: undefined }

  await prisma.simulatedGateCode.delete({ where: { credentialId: input.externalRef } })
  return { status: 200, body: undefined }
}

/// The vendor's enumeration endpoint. Paged, because real ones are, and the
/// driver has to loop.
export async function listKeypadUsers(input: {
  siteId: string
  cursor?: string
  limit?: number
}): Promise<PtiResponse<{ users: PtiKeypadUser[]; nextCursor: string | null }>> {
  const limit = Math.min(input.limit ?? 50, 200)
  const rows = await prisma.simulatedGateCode.findMany({
    where: { facilityId: input.siteId, ...(input.cursor ? { id: { gt: input.cursor } } : {}) },
    orderBy: { id: 'asc' },
    take: limit + 1,
  })

  const page = rows.slice(0, limit)
  return {
    status: 200,
    body: {
      users: page.map(toUser),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    },
  }
}

function toUser(row: {
  id: string
  credentialId: string
  code: string
  active: boolean
  windowExempt: boolean
}): PtiKeypadUser {
  return {
    ptiUserId: row.id,
    externalRef: row.credentialId,
    pin: row.code,
    status: row.active ? 'enabled' : 'disabled',
    timeZoneId: row.windowExempt ? PTI_TIME_ZONE_ALWAYS : PTI_TIME_ZONE_SITE_HOURS,
  }
}

/// What the vendor thinks "site hours" are. Held by the CONTROLLER, exactly as
/// the simulator holds its own copy — a real PTI site has its time zones
/// configured in the vendor portal, and our schedule only reaches the gate if
/// somebody pushed it.
function ptiSiteHours(): { ptiTimeZone: number } {
  return { ptiTimeZone: PTI_TIME_ZONE_SITE_HOURS }
}

/// Exported for the adapter's snapshot, so it hashes exactly the way the
/// reconciliation diff expects.
export function pinHash(pin: string): string {
  return hashCode(pin)
}
