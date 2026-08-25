import { prisma, type Prisma } from '@storage/db'
import { sendDirectEmail } from './service'

// PRD 05 FR-19 (B-075). "Alert to owner if..." — the three silent-failure
// detectors' one shared output. Reuses the direct-send path (B-020's resume
// links, B-073's abandonment emails) rather than inventing a second
// notification mechanism: an alert IS a message, with the same kill-switch,
// sandbox and evidence-row guarantees every other one gets.
//
// Deduplication is `sendDirectEmail`'s own idempotency key, not a new table —
// keying on `alert:<kind>:<scope>` means a detector that runs again before
// the condition clears (the next hourly tick, the next day's job) finds the
// existing Message row and sends nothing a second time. It also means
// "already alerted today" resets naturally at the next distinct key, with no
// TTL or cleanup job of its own.

/// The owner is the one role this matters for — the same "no superuser
/// bypass" identity D-12 already treats as the single unrestricted actor.
/// Null when nobody has been bootstrapped into that role, which the caller
/// treats as "nothing to alert" rather than an error: a dev/test database
/// with no owner yet should not fail a job over it.
async function ownerEmail(extraWhere?: Prisma.StaffUserWhereInput): Promise<string | null> {
  const owner = await prisma.staffUser.findFirst({
    where: { status: 'active', assignments: { some: { role: { key: 'owner' } } }, ...extraWhere },
    select: { email: true },
  })
  return owner?.email ?? null
}

export type AlertResult = { sent: boolean }

/// One alert, deduplicated by `key`. `key` should be specific enough that a
/// DIFFERENT problem on the same day gets its own send (e.g.
/// `sms_failure_rate:{facilityId}:{businessDate}`), and stable enough that
/// the SAME problem checked again today does not repeat.
///
/// `ownerWhere` narrows which staff row counts as "the" owner. Production
/// never has more than one, so every real caller omits it. Tests running in
/// parallel against a shared schema do not have that guarantee — several DB
/// suites bootstrap their own transient owner (B-185) — so a test passes its
/// own fixture's email to prove the wiring without asserting global
/// uniqueness the test environment cannot promise.
export async function alertOwner(
  key: string,
  subject: string,
  body: string,
  ownerWhere?: Prisma.StaffUserWhereInput,
): Promise<AlertResult> {
  const to = await ownerEmail(ownerWhere)
  if (!to) return { sent: false }

  const result = await sendDirectEmail({
    idempotencyKey: `alert:${key}`,
    eventId: key,
    templateKey: 'platform_alert',
    // Operational, not marketing or transactional-to-a-tenant: this never
    // touches the suppression/consent machinery either way (the owner is
    // staff, not a Tenant), and `sendDirectEmail`'s classification exists
    // for the Message log's own record, not a gate here.
    classification: 'operational',
    to,
    fromName: 'Storage platform',
    subject,
    html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
    text: body,
  })
  return { sent: result.sent }
}
